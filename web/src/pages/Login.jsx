import React, { useState } from "react";
import { supabase } from "../supabase.js";

export default function Login() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password, options: { data: { full_name: name.trim() } },
        });
        if (error) throw error;
        if (!data.session) setMsg({ ok: true, text: "Check your email to confirm your address, then sign in." });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
        if (error) throw error;
        setMsg({ ok: true, text: "If that email has an account, a reset link is on its way." });
      }
    } catch (err) {
      const text = /invalid login/i.test(err.message)
        ? "That email and password don't match. Check them, or reset your password."
        : err.message;
      setMsg({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="auth" onSubmit={submit}>
        <div className="ask-tag">
          <h1>Applicator Hub</h1>
          <p>Labels, SOPs and equipment manuals, answered on your phone.</p>
        </div>
        <div className="panel">
          <div className="segmented" role="group" aria-label="Account">
            <button type="button" aria-pressed={mode === "signin"} onClick={() => setMode("signin")}>Sign in</button>
            <button type="button" aria-pressed={mode === "signup"} onClick={() => setMode("signup")}>Create account</button>
          </div>
          {mode === "signup" && (
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" inputMode="email" />
          </div>
          {mode !== "reset" && (
            <div className="field">
              <label htmlFor="pw">Password</label>
              <input id="pw" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
                autoComplete={mode === "signup" ? "new-password" : "current-password"} />
            </div>
          )}
          {msg && <p className={`notice ${msg.ok ? "" : "warn"}`} style={{ marginBottom: 14 }} role="status">{msg.text}</p>}
          <button className="btn block" disabled={busy}>
            {busy ? <span className="spinner" /> : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
          </button>
          {mode === "signin" && (
            <button type="button" className="link-btn" style={{ marginTop: 8 }} onClick={() => setMode("reset")}>Forgot password?</button>
          )}
          {mode === "signup" && (
            <p className="muted small" style={{ marginTop: 12 }}>New accounts are approved by an admin before they can search.</p>
          )}
          {mode === "reset" && (
            <button type="button" className="link-btn" style={{ marginTop: 8 }} onClick={() => setMode("signin")}>Back to sign in</button>
          )}
        </div>
      </form>
    </div>
  );
}
