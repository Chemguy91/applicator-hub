import React, { useEffect, useState } from "react";
import CHECKLISTS from "../data/checklist.json";
import { supabase } from "../supabase.js";

const STORE_KEY = "job-checklists-v1";
const EMPTY = { done: { setup: {}, post: {} }, fields: {}, draftId: null, dirty: false };
// Every write-in on the checklist (step 2 boxes, step 14 questions), taken from checklist.json.
export const FIELD_KEYS = CHECKLISTS.setup.steps.flatMap((s) => [
  ...(s.fields || []).map((f) => f.id),
  ...(s.questions || []).flatMap((q) => [q.id, `${q.id}_where`]),
]);
const fmtSaved = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const toMarks = (arr) => Object.fromEntries((arr || []).map((n) => [n, true]));
const LISTS = [
  { id: "setup", label: "Machine setup", numbered: true },
  { id: "post", label: "Departure check", numbered: false },
];

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (saved?.done?.setup && saved?.done?.post && saved?.fields) return { ...EMPTY, ...saved };
  } catch { /* storage unavailable or bad data */ }
  return EMPTY;
}

export function Field({ id, label, value, onChange, type = "text" }) {
  return (
    <label className={`ck-field ${type === "textarea" ? "ck-field-wide" : ""}`}>
      <span>{label}</span>
      {type === "textarea" ? (
        <textarea className="textarea" rows={4} maxLength={4000} value={value ?? ""} onChange={(e) => onChange(id, e.target.value)}
          placeholder="Anything else about the panel, VFDs or settings" />
      ) : (
        <input className="input" type={type} value={value ?? ""} onChange={(e) => onChange(id, e.target.value)} />
      )}
    </label>
  );
}

// Boxes for a step, under a small heading per group (e.g. Switches, Settings).
export function StepFields({ defs, values, onChange }) {
  const groups = [];
  for (const f of defs) {
    const g = f.type === "textarea" ? null : f.group ?? null;
    const last = groups[groups.length - 1];
    if (last && last.name === g && g !== null) last.items.push(f); else groups.push({ name: g, items: [f] });
  }
  return groups.map((g, i) => (
    <div key={i} className="ck-group">
      {g.name && <h4 className="ck-group-h">{g.name}</h4>}
      <div className="ck-grid">
        {g.items.map((f) => <Field key={f.id} id={f.id} label={f.label} type={f.type} value={values[f.id]} onChange={onChange} />)}
      </div>
    </div>
  ));
}

export function YesNo({ id, label, fields, onChange }) {
  const val = fields[id];
  return (
    <div className="ck-question">
      <span className="ck-q-label">{label}</span>
      <div className="yn" role="group" aria-label={label}>
        {["Y", "N"].map((v) => (
          <button key={v} type="button" aria-pressed={val === v} onClick={() => onChange(id, val === v ? "" : v)}>{v === "Y" ? "Yes" : "No"}</button>
        ))}
      </div>
      {val === "Y" && <Field id={`${id}_where`} label="Where and how many?" value={fields[`${id}_where`]} onChange={onChange} />}
    </div>
  );
}

export default function Checklists({ list, place }) {
  const [state, setState] = useState(load);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const { done, fields, draftId, dirty } = state;
  const meta = LISTS.find((l) => l.id === list) ?? LISTS[0];
  const data = CHECKLISTS[meta.id];
  const steps = data.steps;
  const marks = done[meta.id];

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* not saved, still usable */ }
  }, [state]);

  const loadDrafts = async () => {
    const { data, error } = await supabase.from("checklist_submissions")
      .select("id, customer, storage, applicator, job_date, fields, setup_done, post_done, saved_at")
      .eq("status", "in_progress").order("saved_at", { ascending: false }).limit(50);
    setDrafts(error ? [] : data);
  };
  useEffect(() => { loadDrafts(); }, []);

  const toggle = (n) => setState((s) => ({ ...s, dirty: true, done: { ...s.done, [meta.id]: { ...s.done[meta.id], [n]: !s.done[meta.id][n] } } }));
  const setField = (id, v) => setState((s) => ({ ...s, dirty: true, fields: { ...s.fields, [id]: v } }));
  const reset = () => {
    const q = draftId
      ? "Close this job on this phone? Its saved progress stays under In progress. Changes since the last save are lost."
      : "Clear both checklists and every note on this phone without submitting?";
    if (confirm(q)) { setState(EMPTY); setSendMsg(null); }
  };

  const open = (d) => {
    if (d.id === draftId) return;
    if ((dirty || (!draftId && (countFor("setup") || countFor("post") || fields.customer))) &&
      !confirm("Open this job? The checklist on this phone hasn't been saved and will be replaced.")) return;
    setState({
      done: { setup: toMarks(d.setup_done), post: toMarks(d.post_done) },
      fields: { ...(d.fields || {}), customer: d.customer, storage: d.storage, applicator: d.applicator, date: d.job_date ?? "" },
      draftId: d.id, dirty: false,
    });
    setSendMsg({ ok: true, text: `Opened ${d.customer}, ${d.storage}. Pick up where it was left.` });
    window.scrollTo(0, 0);
  };

  const missingNames = () => {
    const need = [["customer", "customer name"], ["storage", "storage name"], ["applicator", "applicator name"]].filter(([k]) => !(fields[k] || "").trim());
    return need.length ? need.map(([, l]) => l).join(", ") : null;
  };

  const payload = (status) => {
    const ids = (id) => Object.entries(done[id]).filter(([, v]) => v).map(([k]) => Number(k)).sort((a, b) => a - b);
    return {
      customer: fields.customer.trim(), storage: fields.storage.trim(), applicator: fields.applicator.trim(),
      job_date: fields.date || null,
      fields: Object.fromEntries(FIELD_KEYS.map((k) => [k, fields[k]])),
      setup_done: ids("setup"), post_done: ids("post"),
      setup_total: CHECKLISTS.setup.steps.length, post_total: CHECKLISTS.post.steps.length,
      status,
    };
  };

  // Writes to the database. An open job is updated; a new one is inserted.
  // Returns "ok", "gone" (finished or deleted from another phone) or "error".
  const write = async (status) => {
    const table = supabase.from("checklist_submissions");
    if (draftId) {
      const { data, error } = await table.update(payload(status)).eq("id", draftId).eq("status", "in_progress").select("id");
      if (error) return { result: "error" };
      return data.length ? { result: "ok", id: draftId } : { result: "gone" };
    }
    const { data, error } = await table.insert(payload(status)).select("id").single();
    return error ? { result: "error" } : { result: "ok", id: data.id };
  };

  const goneMsg = "This job was already submitted or deleted from another phone. Your checkmarks are still here. Tap Save progress or Submit again to save them as a new job.";

  const save = async () => {
    setSendMsg(null);
    const miss = missingNames();
    if (miss) { setSendMsg({ ok: false, text: `Fill in the ${miss} before saving.` }); return; }
    setSending("save");
    const r = await write("in_progress");
    setSending(false);
    if (r.result === "gone") { setState((s) => ({ ...s, draftId: null, dirty: true })); setSendMsg({ ok: false, text: goneMsg }); loadDrafts(); return; }
    if (r.result === "error") { setSendMsg({ ok: false, text: "Couldn't save. Your checklist is still on this phone. Check your signal and try again." }); return; }
    setState((s) => ({ ...s, draftId: r.id, dirty: false }));
    setSendMsg({ ok: true, at: "bottom", text: `Progress saved. Finish it later from any ${place} phone under In progress.` });
    loadDrafts();
  };

  const submit = async () => {
    setSendMsg(null);
    const miss = missingNames();
    if (miss) { setSendMsg({ ok: false, text: `Fill in the ${miss} before submitting.` }); return; }
    const setupLeft = CHECKLISTS.setup.steps.length - countFor("setup");
    const postLeft = CHECKLISTS.post.steps.length - countFor("post");
    if ((setupLeft || postLeft) && !confirm(
      `Not everything is checked (${setupLeft} setup step${setupLeft === 1 ? "" : "s"}, ${postLeft} departure check item${postLeft === 1 ? "" : "s"}). Submit anyway? To finish later instead, tap Cancel, then Save progress.`)) return;
    setSending("submit");
    const r = await write("submitted");
    setSending(false);
    if (r.result === "gone") { setState((s) => ({ ...s, draftId: null, dirty: true })); setSendMsg({ ok: false, text: goneMsg }); loadDrafts(); return; }
    if (r.result === "error") {
      setSendMsg({ ok: false, text: "Couldn't submit. Your checklist is still saved on this phone. Check your signal and try again." });
      return;
    }
    setSendMsg({ ok: true, text: `Submitted the checklist for ${fields.customer.trim()}, ${fields.storage.trim()} to ${place} results. Ready for the next job.` });
    setState(EMPTY);
    loadDrafts();
    window.scrollTo(0, 0);
  };

  const countFor = (id) => CHECKLISTS[id].steps.filter((s) => done[id][s.n]).length;
  const count = countFor(meta.id);
  const next = steps.find((s) => !marks[s.n]);

  return (
    <div className="setup">
      <h1 className="page-title">Checklists</h1>
      <p className="setup-sub">Save progress before treatment and finish after. Submitted checklists go to {place} results.</p>

      {drafts?.length > 0 && (
        <section className="ck-drafts" aria-label="In progress">
          <h2>In progress <span className="count">{drafts.length}</span></h2>
          <ul>
            {drafts.map((d) => (
              <li key={d.id} className={d.id === draftId ? "is-open" : ""}>
                <span className="ck-draft-main">
                  <strong>{d.customer}</strong>
                  <span>{d.storage}, {d.applicator}</span>
                  <span className="muted small">Saved {fmtSaved(d.saved_at)}. Setup {d.setup_done.length}/{CHECKLISTS.setup.steps.length}, departure {d.post_done.length}/{CHECKLISTS.post.steps.length}</span>
                </span>
                {d.id === draftId
                  ? <span className="ck-draft-here">Open</span>
                  : <button className="btn secondary small" onClick={() => open(d)}>Continue</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="group-tabs" role="tablist" aria-label="Checklist">
        {LISTS.map((l) => (
          <a key={l.id} role="tab" href={`#/${l.id}`} aria-selected={l.id === meta.id} className="group-tab">
            {l.label} <span className="count">{countFor(l.id)}/{CHECKLISTS[l.id].steps.length}</span>
          </a>
        ))}
      </div>

      {sendMsg?.ok && sendMsg.at !== "bottom" && <p className="notice" role="status" style={{ marginBottom: 14 }}>{sendMsg.text}</p>}

      <section className="panel ck-job">
        <div className="ck-job-fields">
          <Field id="customer" label="Customer name" value={fields.customer} onChange={setField} />
          <Field id="storage" label="Storage name" value={fields.storage} onChange={setField} />
        </div>
        <div className="ck-progress" aria-live="polite">
          <div className="ck-progress-text">
            <span><strong>{count} of {steps.length}</strong> {meta.numbered ? "steps" : "items"} done</span>
            {next && count > 0 && <a href={`#/${meta.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`${meta.id}-${next.n}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>Next: {next.title}</a>}
            {!next && <span className="ck-complete">Complete</span>}
          </div>
          <div className="ck-bar"><span style={{ width: `${(count / steps.length) * 100}%` }} /></div>
        </div>
      </section>

      <h2 className="ck-list-title">{data.title}</h2>
      <ol className={`ck-steps ${meta.numbered ? "" : "ck-unnumbered"}`}>
        {steps.map((s) => (
          <li key={s.n} id={`${meta.id}-${s.n}`} className={`ck-step ${marks[s.n] ? "is-done" : ""}`}>
            <button className="ck-check" type="button" role="checkbox" aria-checked={!!marks[s.n]} onClick={() => toggle(s.n)}
              aria-label={meta.numbered ? `Step ${s.n}: ${s.title}` : s.title}>
              <span className="ck-box" aria-hidden="true">{marks[s.n] ? "✓" : meta.numbered ? s.n : ""}</span>
            </button>
            <div className="ck-body">
              <h3>{s.title}</h3>
              {s.text && <p>{s.text}</p>}
              {s.warning && <p className="ck-warning">{s.warning}</p>}
              {s.fields && <StepFields defs={s.fields} values={fields} onChange={setField} />}
              {s.questions?.map((q) => <YesNo key={q.id} {...q} fields={fields} onChange={setField} />)}
            </div>
          </li>
        ))}
      </ol>

      {meta.id === "setup" && countFor("setup") === steps.length && (
        <a className="btn block" style={{ marginBottom: 16 }} href="#/post">Go to departure check</a>
      )}

      <section className="panel ck-sign">
        <div className="ck-job-fields">
          <Field id="applicator" label="Applicator" value={fields.applicator} onChange={setField} />
          <Field id="date" label="Date" type="date" value={fields.date} onChange={setField} />
        </div>
        {sendMsg && !sendMsg.ok && <p className="notice warn" role="alert" style={{ marginBottom: 12 }}>{sendMsg.text}</p>}
        {sendMsg?.ok && sendMsg.at === "bottom" && <p className="notice" role="status" style={{ marginBottom: 12 }}>{sendMsg.text}</p>}
        <div className="btn-row">
          <button className="btn" onClick={submit} disabled={!!sending}>
            {sending === "submit" ? <><span className="spinner" />Submitting…</> : "Submit checklist"}
          </button>
          <button className="btn secondary" onClick={save} disabled={!!sending}>
            {sending === "save" ? <><span className="spinner" />Saving…</> : "Save progress"}
          </button>
          <button className="link-btn" onClick={reset} disabled={!!sending}>{draftId ? "Close this job" : "Clear without submitting"}</button>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          {draftId
            ? (dirty ? "You have changes that aren't saved yet. " : "Progress is saved. ") + "Anyone at " + place + " can continue this job from their phone."
            : "Save progress to finish later from any " + place + " phone. Submitting sends both checklists to " + place + " results."}
        </p>
      </section>
    </div>
  );
}
