import React, { useState } from "react";
import { supabase } from "../supabase.js";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setMsg(/invalid login/i.test(error.message)
        ? "That email and password don't match. Check them, or ask your manager to reset your password."
        : error.message);
    }
  };

  return (
    <div className="center-screen">
      <form className="auth" onSubmit={submit}>
        <div className="login-brand">
          <img src="/agri-stor-logo.png" alt="Agri-Stor Company" width="120" height="73" />
          <h1>Applicator Hub</h1>
          <p>Product reference cards and processing settings.</p>
        </div>
        <div className="panel">
          <h2 style={{ marginBottom: 14 }}>Sign in</h2>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" inputMode="email" />
          </div>
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          {msg && <p className="notice warn" style={{ marginBottom: 14 }} role="alert">{msg}</p>}
          <button className="btn block" disabled={busy}>{busy ? <span className="spinner" /> : "Sign in"}</button>
          <p className="muted small" style={{ marginTop: 14 }}>
            No account, or forgot your password? Ask your manager — they can set you up or reset it from the hub.
          </p>
        </div>
      </form>
    </div>
  );
}
