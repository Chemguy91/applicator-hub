import React, { Suspense, lazy, useEffect, useState } from "react";
import { supabase, configured } from "./supabase.js";
import Login from "./pages/Login.jsx";
import Ask from "./pages/Ask.jsx";
import Library from "./pages/Library.jsx";
const Manage = lazy(() => import("./pages/Manage.jsx"));

const Icon = {
  ask: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  ),
  library: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4M9 12h7M9 16h7" />
    </svg>
  ),
  manage: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
    </svg>
  ),
};

function ChangePassword({ onDone, fullScreen }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setErr(null);
    if (pw !== pw2) return setErr("The two passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setErr(/different from the old/i.test(error.message) ? "Choose a password that's different from your current one." : error.message);
    else onDone(true);
  };
  const form = (
    <form className="auth panel" onSubmit={save} style={fullScreen ? undefined : { maxWidth: "none", marginBottom: 20 }}>
      <h2 style={{ marginBottom: 12 }}>Change your password</h2>
      <div className="field">
        <label htmlFor="npw">New password</label>
        <input id="npw" className="input" type="password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      </div>
      <div className="field">
        <label htmlFor="npw2">Type it again</label>
        <input id="npw2" className="input" type="password" minLength={8} required value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
      </div>
      {err && <p className="notice warn" style={{ marginBottom: 12 }}>{err}</p>}
      <div className="btn-row">
        <button className="btn" disabled={busy}>Save password</button>
        <button type="button" className="btn secondary" onClick={() => onDone(false)}>Cancel</button>
      </div>
    </form>
  );
  return fullScreen ? <div className="center-screen">{form}</div> : form;
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState(() => (location.hash.slice(1) || "ask"));
  const [pendingQuestion, setPendingQuestion] = useState(null);
  const [recovering, setRecovering] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadProfile = async () => {
    if (!session) return setProfile(null);
    const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    setProfile(data ?? { role: "pending", email: session.user.email });
  };
  useEffect(() => { loadProfile(); }, [session?.user?.id]);

  useEffect(() => { history.replaceState(null, "", `#${tab}`); window.scrollTo(0, 0); }, [tab]);

  if (!configured) {
    return (
      <div className="center-screen"><div className="auth panel">
        <h2>Almost there</h2>
        <p className="muted" style={{ marginTop: 8 }}>This copy of Applicator Hub isn't connected to its database yet.</p>
      </div></div>
    );
  }
  if (session === undefined) return <div className="center-screen"><div className="spinner" /></div>;
  if (!session) return <Login />;
  if (recovering) return <ChangePassword fullScreen onDone={() => setRecovering(false)} />;
  if (!profile) return <div className="center-screen"><div className="spinner" /></div>;

  if (profile.role === "pending") {
    return (
      <div className="center-screen"><div className="auth">
        <div className="ask-tag"><h1>No access right now</h1></div>
        <div className="panel">
          <p><strong>{profile.email}</strong> doesn't have access to the hub at the moment. Ask your manager to turn it back on.</p>
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn" onClick={loadProfile}>Check again</button>
            <button className="btn secondary" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
      </div></div>
    );
  }

  const isAdmin = profile.role === "admin";
  const tabs = [
    { id: "ask", label: "Ask" },
    { id: "library", label: "Library" },
    ...(isAdmin ? [{ id: "manage", label: "Manage" }] : []),
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : "ask";

  return (
    <>
      <div className="shell">
        <header className="topbar">
          <div className="brand"><img src="/icon.svg" alt="" />Applicator Hub</div>
          <div>
            <button className="link-btn" onClick={() => setChangingPw((v) => !v)}>Password</button>
            <button className="link-btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </header>
        {changingPw && (
          <ChangePassword onDone={(saved) => { setChangingPw(false); if (saved) { setToast("Password changed."); setTimeout(() => setToast(null), 3000); } }} />
        )}
        {toast && <p className="notice" role="status" style={{ marginBottom: 16 }}>{toast}</p>}
        {current === "ask" && (
          <Ask profile={profile} initialQuestion={pendingQuestion} onConsumed={() => setPendingQuestion(null)} />
        )}
        {current === "library" && <Library />}
        {current === "manage" && isAdmin && (
          <Suspense fallback={<div className="thinking"><span className="spinner" />Loading…</div>}>
            <Manage profile={profile} onAsk={(q) => { setPendingQuestion(q); setTab("ask"); }} />
          </Suspense>
        )}
      </div>
      <nav className="tabbar" aria-label="Main">
        <div className="tabbar-inner">
          {tabs.map((t) => (
            <button key={t.id} className="tab" aria-current={current === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
              {Icon[t.id]}{t.label}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
