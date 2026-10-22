import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase, openDocument } from "../supabase.js";
import { extractPages, toChunks, fileKind } from "../extract.js";
import { ext } from "./Library.jsx";

const DEFAULT_CATEGORIES = ["Product labels", "SDS sheets", "SOPs", "Equipment manuals", "Training", "General"];
const BATCH = 12;

const titleFromName = (name) =>
  name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
const safeName = (name) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-120);

async function callIngest(body) {
  const { data, error } = await supabase.functions.invoke("ingest", { body });
  if (error) {
    let msg = error.message;
    try { const b = await error.context?.json?.(); if (b?.error) msg = b.error; } catch {}
    throw new Error(msg);
  }
  return data;
}

// Extracts text from the file, splits it into passages and sends them to be indexed.
async function indexFile(doc, file, onProgress) {
  onProgress(0.05, "Reading");
  let chunks, pageCount = null;
  const kind = fileKind(file);
  if (kind === "other") {
    chunks = [{ page: null, chunk_index: 0, content: `[${doc.title}]\n${doc.title}. ${doc.description ?? ""} File: ${doc.file_name}` }];
  } else {
    const { pages, pageCount: pc } = await extractPages(file);
    pageCount = pc;
    chunks = toChunks(pages, doc.title, doc.description);
  }
  if (!chunks.length) {
    await callIngest({ document_id: doc.id, reset: true, finish: { page_count: pageCount } });
    return { status: "error" };
  }
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const last = i + BATCH >= chunks.length;
    const res = await callIngest({
      document_id: doc.id,
      reset: i === 0,
      chunks: batch,
      ...(last ? { finish: { page_count: pageCount } } : {}),
    });
    onProgress(0.1 + 0.9 * Math.min(1, (i + batch.length) / chunks.length), "Indexing");
    if (last) return res;
  }
}

function Uploader({ categories, onDone }) {
  const [items, setItems] = useState([]);
  const [category, setCategory] = useState(categories[0] ?? "General");
  const [newCat, setNewCat] = useState("");
  const [description, setDescription] = useState("");
  const [over, setOver] = useState(false);
  const [running, setRunning] = useState(false);
  const input = useRef(null);

  const add = (files) => {
    const list = [...files].filter((f) => f.size > 0);
    setItems((prev) => [...prev, ...list.map((file) => ({ file, title: titleFromName(file.name), progress: 0, state: "queued", note: "" }))]);
  };
  const update = (i, patch) => setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  const run = async () => {
    const cat = (category === "__new" ? newCat : category).trim() || "General";
    setRunning(true);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.state === "done") continue;
      const { file } = it;
      const id = crypto.randomUUID();
      const path = `${id}/${safeName(file.name)}`;
      try {
        if (file.size > 50 * 1024 * 1024) throw new Error("Files must be under 50 MB.");
        update(i, { state: "working", progress: 0.02, note: "Uploading" });
        const { error: upErr } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined });
        if (upErr) throw upErr;
        const doc = {
          id, title: it.title.trim() || titleFromName(file.name), category: cat,
          description: description.trim() || null, file_path: path, file_name: file.name,
          file_type: file.type || fileKind(file), file_size: file.size,
        };
        const { error: insErr } = await supabase.from("documents").insert(doc);
        if (insErr) throw insErr;
        try {
          const res = await indexFile(doc, file, (p, note) => update(i, { progress: p, note }));
          update(i, res?.status === "error"
            ? { state: "error", note: "Uploaded, but no readable text was found. If it's a scanned PDF, run OCR on it and upload again." }
            : { state: "done", progress: 1, note: `Ready — ${res?.passages ?? ""} passages indexed` });
        } catch (err) {
          await callIngest({ document_id: id, fail: String(err.message || err) }).catch(() => {});
          throw err;
        }
      } catch (err) {
        update(i, { state: "error", note: String(err.message || err) });
      }
    }
    setRunning(false);
    onDone();
  };

  const pending = items.filter((i) => i.state !== "done").length;

  return (
    <div className="panel">
      <h2 style={{ marginBottom: 12 }}>Add documents</h2>
      <div
        className={`drop ${over ? "over" : ""}`} role="button" tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
      >
        <strong>Choose files</strong> or drop them here
        <p className="muted small">PDF and Word documents are fully searchable. Other files are found by their title.</p>
        <input ref={input} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }}
          accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.xls,.jpg,.jpeg,.png,.heic,.pptx,application/pdf" />
      </div>

      {items.length > 0 && (
        <>
          <div className="list" style={{ marginTop: 14 }}>
            {items.map((it, i) => (
              <div key={i} className="panel" style={{ padding: 12 }}>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label htmlFor={`t-${i}`}>Title</label>
                  <input id={`t-${i}`} className="input" value={it.title} disabled={it.state !== "queued"}
                    onChange={(e) => update(i, { title: e.target.value })} />
                </div>
                <p className="muted small">{it.file.name}, {(it.file.size / 1024 / 1024).toFixed(1)} MB</p>
                {it.state !== "queued" && (
                  <>
                    <div className="progress" style={{ marginTop: 8 }}><span style={{ width: `${Math.round(it.progress * 100)}%` }} /></div>
                    <p className={`small ${it.state === "error" ? "" : "muted"}`} style={{ marginTop: 6, color: it.state === "error" ? "var(--alert)" : undefined }}>{it.note}</p>
                  </>
                )}
                {it.state === "queued" && !running && (
                  <button className="link-btn" onClick={() => setItems((p) => p.filter((_, j) => j !== i))}>Remove</button>
                )}
              </div>
            ))}
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="cat">Category</label>
            <select id="cat" className="select" value={category} onChange={(e) => setCategory(e.target.value)} disabled={running}>
              {categories.map((c) => <option key={c}>{c}</option>)}
              <option value="__new">New category…</option>
            </select>
          </div>
          {category === "__new" && (
            <div className="field">
              <label htmlFor="newcat">New category name</label>
              <input id="newcat" className="input" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="desc">Notes (optional)</label>
            <textarea id="desc" className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. 2026 label, replaces the 2024 version" disabled={running} />
          </div>
          <div className="btn-row">
            <button className="btn" onClick={run} disabled={running || pending === 0}>
              {running ? <><span className="spinner" />Adding…</> : `Add ${pending} document${pending === 1 ? "" : "s"}`}
            </button>
            {!running && <button className="btn secondary" onClick={() => setItems([])}>Clear</button>}
          </div>
        </>
      )}
    </div>
  );
}

function Documents() {
  const [docs, setDocs] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const load = () => supabase.from("documents").select("*").order("created_at", { ascending: false }).then(({ data }) => setDocs(data ?? []));
  useEffect(() => { load(); }, []);
  useEffect(() => { // refresh while anything is still processing
    if (!docs?.some((d) => d.status === "processing")) return;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [docs]);

  const categories = useMemo(() => [...new Set([...(docs ?? []).map((d) => d.category), ...DEFAULT_CATEGORIES])], [docs]);

  const reindex = async (d) => {
    setBusyId(d.id);
    try {
      const { data: blob, error } = await supabase.storage.from("documents").download(d.file_path);
      if (error) throw error;
      const file = new File([blob], d.file_name, { type: d.file_type?.includes("/") ? d.file_type : blob.type });
      await indexFile(d, file, () => {});
    } catch (e) {
      alert(`Re-index failed: ${e.message}`);
    }
    setBusyId(null); load();
  };

  const rename = async (d) => {
    const title = prompt("Document title", d.title);
    if (!title || title.trim() === d.title) return;
    await supabase.from("documents").update({ title: title.trim(), updated_at: new Date().toISOString() }).eq("id", d.id);
    await reindex({ ...d, title: title.trim() }); // titles are part of the search index
  };

  const recategorize = async (d, category) => {
    await supabase.from("documents").update({ category, updated_at: new Date().toISOString() }).eq("id", d.id);
    load();
  };

  const remove = async (d) => {
    if (!confirm(`Delete “${d.title}”? Applicators will no longer find it.`)) return;
    setBusyId(d.id);
    await supabase.storage.from("documents").remove([d.file_path]);
    await supabase.from("documents").delete().eq("id", d.id);
    setBusyId(null); load();
  };

  return (
    <>
      <Uploader categories={categories} onDone={load} />
      <section className="section">
        <h2>All documents{docs ? ` (${docs.length})` : ""}</h2>
        {docs === null && <div className="thinking"><span className="spinner" />Loading…</div>}
        {docs?.length === 0 && <p className="muted" style={{ marginTop: 8 }}>Nothing uploaded yet. Start with your most-asked-about product labels.</p>}
        <div className="list" style={{ marginTop: 10 }}>
          {docs?.map((d) => (
            <div key={d.id} className="panel" style={{ padding: 12 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span className="doc-icon">{ext(d)}</span>
                <div className="doc-main">
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", justifyContent: "space-between" }}>
                    <button className="link-btn" style={{ color: "var(--ink)", fontWeight: 600, padding: 0, textAlign: "left", fontSize: 17 }} onClick={() => openDocument(d)}>{d.title}</button>
                    <span className={`status ${d.status}`}>{d.status === "ready" ? "Searchable" : d.status === "processing" ? "Indexing" : "Needs attention"}</span>
                  </div>
                  <p className="doc-sub">{d.file_name}{d.page_count ? `, ${d.page_count} pages` : ""}</p>
                  {d.error && <p className="small" style={{ color: "var(--alert)", marginTop: 4 }}>{d.error}</p>}
                </div>
              </div>
              <div className="btn-row" style={{ marginTop: 10, alignItems: "center" }}>
                <select className="select" style={{ width: "auto", padding: "8px 10px", fontSize: 15 }} value={d.category}
                  onChange={(e) => recategorize(d, e.target.value)} aria-label="Category">
                  {categories.map((c) => <option key={c}>{c}</option>)}
                </select>
                <button className="link-btn" onClick={() => rename(d)} disabled={busyId === d.id}>Rename</button>
                <button className="link-btn" onClick={() => reindex(d)} disabled={busyId === d.id}>{busyId === d.id ? "Working…" : "Re-index"}</button>
                <button className="link-btn" style={{ color: "var(--alert)" }} onClick={() => remove(d)} disabled={busyId === d.id}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// Starting passwords: two simple words and a number, easy to read out or text.
const WORDS = ["potato", "cellar", "russet", "harvest", "tractor", "spud", "field", "storage", "valley", "canyon", "river", "barn"];
const suggestPassword = () => {
  const r = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const w = () => WORDS[r(WORDS.length)];
  return `${w()}-${w()}-${100 + r(900)}`;
};

async function callAdminUsers(body) {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    let msg = error.message;
    try { const b = await error.context?.json?.(); if (b?.error) msg = b.error; } catch {}
    throw new Error(msg);
  }
  return data;
}

function AddPerson({ onAdded }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(suggestPassword);
  const [role, setRole] = useState("applicator");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await callAdminUsers({ action: "create", full_name: name.trim(), email: email.trim(), password, role });
      setDone({ name: name.trim() || email.trim(), email: email.trim(), password });
      setName(""); setEmail(""); setPassword(suggestPassword()); setRole("applicator");
      onAdded();
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  };

  return (
    <form className="panel" onSubmit={submit}>
      <h2 style={{ marginBottom: 12 }}>Add a person</h2>
      {done && (
        <div className="notice" role="status" style={{ marginBottom: 14 }}>
          <strong>{done.name}</strong> can sign in now. Send them:
          <div style={{ marginTop: 6 }}>Site: {location.origin}<br />Email: {done.email}<br />Password: {done.password}</div>
          <p className="small muted" style={{ marginTop: 6 }}>They can change the password after signing in.</p>
        </div>
      )}
      <div className="field">
        <label htmlFor="ap-name">Name</label>
        <input id="ap-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="ap-email">Email</label>
        <input id="ap-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="ap-pw">Starting password</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input id="ap-pw" className="input" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="off" />
          <button type="button" className="btn secondary" onClick={() => setPassword(suggestPassword())}>New</button>
        </div>
      </div>
      <div className="field">
        <label htmlFor="ap-role">Access</label>
        <select id="ap-role" className="select" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="applicator">Applicator — search and read</option>
          <option value="admin">Admin — also uploads documents and manages people</option>
        </select>
      </div>
      {err && <p className="notice warn" style={{ marginBottom: 12 }} role="alert">{err}</p>}
      <button className="btn" disabled={busy}>{busy ? <span className="spinner" /> : "Add person"}</button>
    </form>
  );
}

function Team({ me }) {
  const [people, setPeople] = useState(null);
  const [resetFor, setResetFor] = useState(null);
  const [notice, setNotice] = useState(null);
  const load = () => supabase.from("profiles").select("*").order("full_name").then(({ data }) => setPeople(data ?? []));
  useEffect(() => { load(); }, []);

  const setRole = async (p, role) => {
    const { error } = await supabase.from("profiles").update({ role }).eq("id", p.id);
    if (error) alert(error.message);
    load();
  };

  const resetPassword = async (p) => {
    const password = suggestPassword();
    if (!confirm(`Give ${p.full_name || p.email} a new password? Their current one will stop working.`)) return;
    try {
      await callAdminUsers({ action: "set_password", user_id: p.id, password });
      setResetFor({ name: p.full_name || p.email, email: p.email, password });
    } catch (e) { alert(e.message); }
  };

  const remove = async (p) => {
    if (!confirm(`Remove ${p.full_name || p.email}? Their account is deleted and they can no longer sign in.`)) return;
    try { await callAdminUsers({ action: "delete", user_id: p.id }); setNotice(`${p.full_name || p.email} was removed.`); load(); }
    catch (e) { alert(e.message); }
  };

  const label = { applicator: "Applicator", admin: "Admin", pending: "No access" };

  return (
    <>
      <AddPerson onAdded={load} />
      <div className="panel section">
        <h2>People{people ? ` (${people.length})` : ""}</h2>
        {notice && <p className="notice" style={{ marginTop: 10 }} role="status">{notice}</p>}
        {resetFor && (
          <div className="notice" style={{ marginTop: 10 }} role="status">
            New password for <strong>{resetFor.name}</strong>: {resetFor.password}
            <p className="small muted" style={{ marginTop: 4 }}>Send it to them; they can change it after signing in.</p>
          </div>
        )}
        {people === null && <div className="thinking"><span className="spinner" /></div>}
        {people?.map((p) => (
          <div key={p.id} className="person" style={{ flexWrap: "wrap" }}>
            <div className="grow"><strong>{p.full_name || p.email}{p.id === me.id ? " (you)" : ""}</strong><div className="doc-sub">{p.email}</div></div>
            {p.id === me.id ? <span className="muted small">{label[p.role]}</span> : (
              <>
                <select className="select" value={p.role} onChange={(e) => setRole(p, e.target.value)} aria-label={`Access for ${p.email}`}>
                  <option value="applicator">Applicator</option>
                  <option value="admin">Admin</option>
                  <option value="pending">No access</option>
                </select>
                <div style={{ width: "100%", display: "flex", gap: 4 }}>
                  <button className="link-btn" style={{ paddingLeft: 0 }} onClick={() => resetPassword(p)}>Reset password</button>
                  <button className="link-btn" style={{ color: "var(--alert)" }} onClick={() => remove(p)}>Remove</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function Questions({ onAsk }) {
  const [rows, setRows] = useState(null);
  const [only, setOnly] = useState("gaps");
  useEffect(() => {
    supabase.from("questions").select("*, profiles(full_name, email)").order("created_at", { ascending: false }).limit(200)
      .then(({ data }) => setRows(data ?? []));
  }, []);
  const shown = (rows ?? []).filter((r) => only === "all" || r.found === false || r.helpful === false);
  return (
    <div className="panel">
      <h2 style={{ marginBottom: 4 }}>What applicators are asking</h2>
      <p className="muted small" style={{ marginBottom: 12 }}>Unanswered questions show which documents to add next.</p>
      <div className="segmented" role="group" aria-label="Show">
        <button aria-pressed={only === "gaps"} onClick={() => setOnly("gaps")}>Unanswered</button>
        <button aria-pressed={only === "all"} onClick={() => setOnly("all")}>All</button>
      </div>
      {rows === null && <div className="thinking"><span className="spinner" /></div>}
      {rows && shown.length === 0 && <p className="muted">{only === "gaps" ? "No gaps so far." : "No questions yet."}</p>}
      {shown.map((r) => (
        <div key={r.id} className="q-row">
          <p><strong>{r.question}</strong></p>
          <p className="doc-sub">
            {r.profiles?.full_name || r.profiles?.email || "Former user"}, {new Date(r.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {r.found === false ? ". Not found" : r.helpful === false ? ". Marked not helpful" : r.helpful ? ". Marked helpful" : ""}
          </p>
          <button className="link-btn" style={{ paddingLeft: 0 }} onClick={() => onAsk(r.question)}>Ask it again</button>
        </div>
      ))}
    </div>
  );
}

export default function Manage({ profile, onAsk }) {
  const [view, setView] = useState("docs");
  return (
    <>
      <h1 style={{ marginBottom: 12 }}>Manage</h1>
      <div className="segmented" role="group" aria-label="Manage">
        <button aria-pressed={view === "docs"} onClick={() => setView("docs")}>Documents</button>
        <button aria-pressed={view === "team"} onClick={() => setView("team")}>Team</button>
        <button aria-pressed={view === "questions"} onClick={() => setView("questions")}>Questions</button>
      </div>
      {view === "docs" && <Documents />}
      {view === "team" && <Team me={profile} />}
      {view === "questions" && <Questions onAsk={onAsk} />}
    </>
  );
}
