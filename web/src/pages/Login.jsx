import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../supabase.js";

const LENGTH = 4;

export default function Login() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const input = useRef(null);

  useEffect(() => { input.current?.focus(); }, []);

  const submit = async (value) => {
    if (busy || value.length !== LENGTH) return;
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.functions.invoke("code-login", { body: { code: value } });
    if (error) {
      let text = "Couldn't reach the hub. Check your signal and try again.";
      try { const b = await error.context?.json?.(); if (b?.error) text = b.error; } catch { /* keep default */ }
      setMsg(text); setCode(""); setBusy(false);
      input.current?.focus();
      return;
    }
    const { error: sessErr } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
    if (sessErr) { setMsg("Couldn't sign in. Try again."); setCode(""); setBusy(false); }
    // On success the app switches screens on its own.
  };

  const onChange = (e) => {
    const v = e.target.value.replace(/\D/g, "").slice(0, LENGTH);
    setCode(v);
    if (v.length === LENGTH) submit(v);
  };

  return (
    <div className="center-screen">
      <form className="auth" onSubmit={(e) => { e.preventDefault(); submit(code); }}>
        <div className="login-brand">
          <img src="/agri-stor-logo.png" alt="Agri-Stor Company" width="120" height="75" />
          <h1>Applicator Hub</h1>
          <p>Product reference cards, processing settings and checklists.</p>
        </div>
        <div className="panel code-panel">
          <label htmlFor="code" className="code-label">Enter your code</label>
          <div className="code-wrap" onClick={() => input.current?.focus()}>
            <input
              id="code" ref={input} className="code-input" value={code} onChange={onChange}
              inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={LENGTH}
              type="password" disabled={busy} aria-describedby={msg ? "code-msg" : undefined}
            />
            <div className="code-boxes" aria-hidden="true">
              {Array.from({ length: LENGTH }, (_, i) => (
                <span key={i} className={`code-box ${i < code.length ? "filled" : ""} ${i === code.length && !busy ? "active" : ""}`}>
                  {i < code.length ? "•" : ""}
                </span>
              ))}
            </div>
          </div>
          {busy && <p className="code-status" role="status"><span className="spinner" /> Checking…</p>}
          {msg && <p id="code-msg" className="notice warn" role="alert" style={{ marginTop: 14 }}>{msg}</p>}
          <p className="muted small" style={{ marginTop: 14 }}>Don't have the code? Ask your manager.</p>
        </div>
      </form>
    </div>
  );
}
