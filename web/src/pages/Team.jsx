import React, { useEffect, useState } from "react";
import { supabase } from "../supabase.js";

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


export default function TeamPage({ me, onBack }) {
  return (
    <>
      <button className="back-link" onClick={onBack}>← All products</button>
      <h1 className="page-title">Team</h1>
      <Team me={me} />
    </>
  );
}
