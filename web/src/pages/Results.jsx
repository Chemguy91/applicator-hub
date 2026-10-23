import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase.js";
import CHECKLISTS from "../data/checklist.json";
import { Field, YesNo, StepFields, FIELD_KEYS } from "./Setup.jsx";

const PANEL = CHECKLISTS.setup.steps[1].fields;

const fmtDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "No date");
const fmtTime = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const LIST_NAME = { setup: "Machine setup", post: "Departure check" };

function ListDetail({ list, doneIds }) {
  const done = new Set(doneIds);
  const steps = CHECKLISTS[list].steps;
  const missed = steps.filter((s) => !done.has(s.n));
  return (
    <div className="rs-list">
      <h4>{LIST_NAME[list]}: {steps.length - missed.length} of {steps.length}</h4>
      {missed.length === 0 ? (
        <p className="rs-all">All checked</p>
      ) : (
        <>
          <p className="rs-missed-label">Not checked</p>
          <ul className="rs-missed">
            {missed.map((s) => <li key={s.n}>{list === "setup" ? `${s.n}. ` : ""}{s.title}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

// Admin editor: every field and checkmark from the submitted checklist.
function Editor({ r, onCancel, onSaved }) {
  const [f, setF] = useState({ customer: r.customer, storage: r.storage, applicator: r.applicator, date: r.job_date ?? "", ...(r.fields || {}) });
  const [done, setDone] = useState({ setup: new Set(r.setup_done), post: new Set(r.post_done) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (list, n) => setDone((d) => {
    const s = new Set(d[list]); s.has(n) ? s.delete(n) : s.add(n); return { ...d, [list]: s };
  });

  const save = async () => {
    if (!f.customer?.trim() || !f.storage?.trim() || !f.applicator?.trim()) {
      setErr("Customer, storage and applicator can't be empty."); return;
    }
    setBusy(true); setErr(null);
    const { error } = await supabase.from("checklist_submissions").update({
      customer: f.customer.trim(), storage: f.storage.trim(), applicator: f.applicator.trim(), job_date: f.date || null,
      fields: Object.fromEntries(FIELD_KEYS.map((k) => [k, f[k]])),
      setup_done: [...done.setup].sort((a, b) => a - b), post_done: [...done.post].sort((a, b) => a - b),
    }).eq("id", r.id);
    setBusy(false);
    if (error) setErr("Couldn't save. Check your signal and try again."); else onSaved();
  };

  return (
    <div className="rs-editor">
      <div className="ck-job-fields">
        <Field id="customer" label="Customer name" value={f.customer} onChange={set} />
        <Field id="storage" label="Storage name" value={f.storage} onChange={set} />
        <Field id="applicator" label="Applicator" value={f.applicator} onChange={set} />
        <Field id="date" label="Date" type="date" value={f.date} onChange={set} />
      </div>
      <h4 className="rs-edit-h">Panel and VFD settings</h4>
      <StepFields defs={PANEL} values={f} onChange={set} />
      <h4 className="rs-edit-h">Top of the pile</h4>
      {CHECKLISTS.setup.steps[13].questions.map((q) => <YesNo key={q.id} {...q} fields={f} onChange={set} />)}
      {["setup", "post"].map((list) => (
        <fieldset key={list} className="rs-edit-list">
          <legend>{LIST_NAME[list]}</legend>
          {CHECKLISTS[list].steps.map((s) => (
            <label key={s.n} className="rs-edit-item">
              <input type="checkbox" checked={done[list].has(s.n)} onChange={() => toggle(list, s.n)} />
              <span>{list === "setup" ? `${s.n}. ` : ""}{s.title}</span>
            </label>
          ))}
        </fieldset>
      ))}
      {err && <p className="notice warn" role="alert" style={{ marginBottom: 12 }}>{err}</p>}
      <div className="btn-row">
        <button className="btn" onClick={save} disabled={busy}>{busy ? <><span className="spinner" />Saving…</> : "Save changes"}</button>
        <button className="btn secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

function Row({ r, isAdmin, onDelete, onSaved }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const f = r.fields || {};
  const setupOk = r.setup_done.length === r.setup_total;
  const postOk = r.post_done.length === r.post_total;
  const yn = (k) => (f[k] === "Y" ? `Yes${f[`${k}_where`] ? `: ${f[`${k}_where`]}` : ""}` : f[k] === "N" ? "No" : "Not answered");
  return (
    <li className={`rs-row ${open ? "open" : ""}`}>
      <button className="rs-summary" onClick={() => { setOpen((v) => !v); setEditing(false); }} aria-expanded={open}>
        <span className="rs-main">
          <span className="rs-customer">{r.customer}</span>
          <span className="rs-storage">{r.storage}</span>
          <span className="rs-meta">{r.applicator}, {fmtDate(r.job_date)}</span>
        </span>
        <span className="rs-badges">
          {r.status === "in_progress" && <span className="rs-badge progress">In progress</span>}
          <span className={`rs-badge ${setupOk ? "ok" : "warn"}`}>Setup {r.setup_done.length}/{r.setup_total}</span>
          <span className={`rs-badge ${postOk ? "ok" : "warn"}`}>Departure {r.post_done.length}/{r.post_total}</span>
        </span>
      </button>
      {open && !editing && (
        <div className="rs-detail">
          <dl className="rs-fields">
            {PANEL.map((x) => x.type === "textarea" ? (
              <div key={x.id} className="full"><dt>{x.label}</dt><dd className="rs-long">{f[x.id] || "—"}</dd></div>
            ) : (
              <div key={x.id}><dt>{x.group ? `${x.group}: ${x.label}` : x.label}</dt><dd>{f[x.id] || "—"}</dd></div>
            ))}
            <div className="wide"><dt>Fans on top of pile</dt><dd>{yn("fans_on")}</dd></div>
            <div className="wide"><dt>Heaters on top of pile</dt><dd>{yn("heaters_on")}</dd></div>
          </dl>
          <ListDetail list="setup" doneIds={r.setup_done} />
          <ListDetail list="post" doneIds={r.post_done} />
          <p className="rs-submitted">
            {r.status === "in_progress" ? `Started ${fmtTime(r.submitted_at)}. Last saved ${fmtTime(r.saved_at)}. Finish it from the Checklists tab` : `Submitted ${fmtTime(r.submitted_at)}`}{r.edited_at ? `. Edited by admin ${fmtTime(r.edited_at)}` : ""}
          </p>
          {isAdmin && (
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn secondary" onClick={() => setEditing(true)}>Edit</button>
              <button className="link-btn rs-delete" onClick={() => onDelete(r)}>Delete</button>
            </div>
          )}
        </div>
      )}
      {open && editing && (
        <div className="rs-detail">
          <Editor r={r} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onSaved(); }} />
        </div>
      )}
    </li>
  );
}

export default function Results({ isAdmin, place }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");

  const load = async () => {
    const { data, error: e } = await supabase.from("checklist_submissions").select("*").order("submitted_at", { ascending: false }).limit(500);
    if (e) setError("Couldn't load results. Check your signal and try again.");
    else { setRows(data); setError(null); }
  };
  useEffect(() => { load(); }, []);

  const remove = async (r) => {
    if (!confirm(`Delete the checklist for ${r.customer}, ${r.storage}? This can't be undone.`)) return;
    const { error: e } = await supabase.from("checklist_submissions").delete().eq("id", r.id);
    if (e) alert("Couldn't delete it. Try again."); else load();
  };

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !s || `${r.customer} ${r.storage} ${r.applicator}`.toLowerCase().includes(s));
  }, [rows, q]);

  return (
    <div className="results">
      <h1 className="page-title">{place} results</h1>
      <p className="setup-sub">
        Checklists submitted with {place} codes. {isAdmin ? "As admin you can edit or delete them." : "Only an admin can change or delete them."}
      </p>
      <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer, storage or applicator" aria-label="Search results" />
      {error && <p className="notice warn" style={{ marginTop: 14 }}>{error}</p>}
      {rows === null && !error && <div className="thinking"><span className="spinner" />Loading…</div>}
      {rows && rows.length === 0 && (
        <div className="empty"><h3>No checklists yet</h3><p>Checklists submitted from the Checklists tab show up here.</p></div>
      )}
      {rows && rows.length > 0 && (
        <>
          <p className="muted small" style={{ margin: "12px 0 8px" }}>{shown.length} of {rows.length} shown. Tap one to see details.</p>
          <ul className="rs">{shown.map((r) => <Row key={r.id} r={r} isAdmin={isAdmin} onDelete={remove} onSaved={load} />)}</ul>
        </>
      )}
    </div>
  );
}
