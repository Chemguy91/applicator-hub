import React, { useEffect, useState } from "react";
import CHECKLISTS from "../data/checklist.json";

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

function Field({ id, label, value, onChange, type = "text" }) {
  return (
    <label className="ck-field">
      <span>{label}</span>
      <input className="input" type={type} value={value ?? ""} onChange={(e) => onChange(id, e.target.value)} />
    </label>
  );
}

function YesNo({ id, label, fields, onChange }) {
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

export default function Checklists({ list }) {
  const [state, setState] = useState(load);
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
    if (confirm("Start a new job? This clears both checklists and every note on this phone.")) setState(EMPTY);
  };

  const countFor = (id) => CHECKLISTS[id].steps.filter((s) => done[id][s.n]).length;
  const count = countFor(meta.id);
  const next = steps.find((s) => !marks[s.n]);

  return (
    <div className="setup">
      <h1 className="page-title">Checklists</h1>

      <div className="group-tabs" role="tablist" aria-label="Checklist">
        {LISTS.map((l) => (
          <a key={l.id} role="tab" href={`#/${l.id}`} aria-selected={l.id === meta.id} className="group-tab">
            {l.label} <span className="count">{countFor(l.id)}/{CHECKLISTS[l.id].steps.length}</span>
          </a>
        ))}
      </div>

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
                  {s.fields.map((f) => <Field key={f.id} id={f.id} label={f.label} value={fields[f.id]} onChange={setField} />)}
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
        <p className="muted small" style={{ marginTop: 4 }}>
          Checkmarks and notes are saved on this phone only, so a reload won't lose them. Nothing is sent anywhere.
        </p>
        <button className="btn secondary" style={{ marginTop: 12 }} onClick={reset}>Start a new job</button>
      </section>
    </div>
  );
}
