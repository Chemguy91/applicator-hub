import React, { useEffect, useState } from "react";
import CHECKLISTS from "../data/checklist.json";
import { supabase } from "../supabase.js";

const STORE_KEY = "job-checklists-v1";
const EMPTY = { done: { setup: {}, post: {} }, fields: {} };
const LISTS = [
  { id: "setup", label: "Machine setup", numbered: true },
  { id: "post", label: "Post treatment", numbered: false },
];

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (saved?.done?.setup && saved?.done?.post && saved?.fields) return saved;
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
  const { done, fields } = state;
  const meta = LISTS.find((l) => l.id === list) ?? LISTS[0];
  const data = CHECKLISTS[meta.id];
  const steps = data.steps;
  const marks = done[meta.id];

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* not saved, still usable */ }
  }, [state]);

  const toggle = (n) => setState((s) => ({ ...s, done: { ...s.done, [meta.id]: { ...s.done[meta.id], [n]: !s.done[meta.id][n] } } }));
  const setField = (id, v) => setState((s) => ({ ...s, fields: { ...s.fields, [id]: v } }));
  const reset = () => {
    if (confirm("Clear both checklists and every note on this phone without submitting?")) setState(EMPTY);
  };

  const submit = async () => {
    setSendMsg(null);
    const need = [["customer", "customer name"], ["storage", "storage name"], ["applicator", "applicator name"]].filter(([k]) => !(fields[k] || "").trim());
    if (need.length) {
      setSendMsg({ ok: false, text: `Fill in the ${need.map(([, l]) => l).join(", ")} before submitting.` });
      return;
    }
    const setupLeft = CHECKLISTS.setup.steps.length - countFor("setup");
    const postLeft = CHECKLISTS.post.steps.length - countFor("post");
    if ((setupLeft || postLeft) && !confirm(
      `Not everything is checked (${setupLeft} setup step${setupLeft === 1 ? "" : "s"}, ${postLeft} post-treatment item${postLeft === 1 ? "" : "s"}). Submit anyway?`)) return;
    setSending(true);
    const ids = (id) => Object.entries(done[id]).filter(([, v]) => v).map(([k]) => Number(k)).sort((a, b) => a - b);
    const { fans, refer, heat, doors, panel_other, fans_on, fans_on_where, heaters_on, heaters_on_where } = fields;
    const { error } = await supabase.from("checklist_submissions").insert({
      customer: fields.customer.trim(), storage: fields.storage.trim(), applicator: fields.applicator.trim(),
      job_date: fields.date || null,
      fields: { fans, refer, heat, doors, panel_other, fans_on, fans_on_where, heaters_on, heaters_on_where },
      setup_done: ids("setup"), post_done: ids("post"),
      setup_total: CHECKLISTS.setup.steps.length, post_total: CHECKLISTS.post.steps.length,
    });
    setSending(false);
    if (error) {
      setSendMsg({ ok: false, text: "Couldn't submit. Your checklist is still saved on this phone. Check your signal and try again." });
      return;
    }
    setSendMsg({ ok: true, text: `Submitted the checklist for ${fields.customer.trim()}, ${fields.storage.trim()} to ${place} results. Ready for the next job.` });
    setState(EMPTY);
    window.scrollTo(0, 0);
  };

  const countFor = (id) => CHECKLISTS[id].steps.filter((s) => done[id][s.n]).length;
  const count = countFor(meta.id);
  const next = steps.find((s) => !marks[s.n]);

  return (
    <div className="setup">
      <h1 className="page-title">Checklists</h1>
      <p className="setup-sub">Submitted checklists are saved to {place} results.</p>

      <div className="group-tabs" role="tablist" aria-label="Checklist">
        {LISTS.map((l) => (
          <a key={l.id} role="tab" href={`#/${l.id}`} aria-selected={l.id === meta.id} className="group-tab">
            {l.label} <span className="count">{countFor(l.id)}/{CHECKLISTS[l.id].steps.length}</span>
          </a>
        ))}
      </div>

      {sendMsg?.ok && <p className="notice" role="status" style={{ marginBottom: 14 }}>{sendMsg.text}</p>}

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
              {s.fields && (
                <div className="ck-grid">
                  {s.fields.map((f) => <Field key={f.id} id={f.id} label={f.label} type={f.type} value={fields[f.id]} onChange={setField} />)}
                </div>
              )}
              {s.questions?.map((q) => <YesNo key={q.id} {...q} fields={fields} onChange={setField} />)}
            </div>
          </li>
        ))}
      </ol>

      {meta.id === "setup" && countFor("setup") === steps.length && (
        <a className="btn block" style={{ marginBottom: 16 }} href="#/post">Go to post treatment checklist</a>
      )}

      <section className="panel ck-sign">
        <div className="ck-job-fields">
          <Field id="applicator" label="Applicator" value={fields.applicator} onChange={setField} />
          <Field id="date" label="Date" type="date" value={fields.date} onChange={setField} />
        </div>
        {sendMsg && !sendMsg.ok && <p className="notice warn" role="alert" style={{ marginBottom: 12 }}>{sendMsg.text}</p>}
        <div className="btn-row">
          <button className="btn" onClick={submit} disabled={sending}>
            {sending ? <><span className="spinner" />Submitting…</> : "Submit checklist"}
          </button>
          <button className="btn secondary" onClick={reset} disabled={sending}>Clear without submitting</button>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          Submitting saves both checklists to your location's results. Until then, checkmarks and notes are kept on this phone.
        </p>
      </section>
    </div>
  );
}
