import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { supabase, configured } from "./supabase.js";
import Login from "./pages/Login.jsx";
import Reference from "./pages/Reference.jsx";
import Checklists from "./pages/Setup.jsx";
const TeamPage = lazy(() => import("./pages/Team.jsx"));

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
    <form className="panel pw-panel" onSubmit={save}>
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
  return fullScreen ? <div className="center-screen"><div className="auth">{form}</div></div> : form;
}

function viewFromHash() {
  const h = location.hash;
  if (h === "#/team") return "team";
  if (h === "#/setup") return "setup";
  if (h === "#/post") return "post";
  return "ref";
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [view, setView] = useState(viewFromHash);
  const [recovering, setRecovering] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [toast, setToast] = useState(null);
  const menuRef = useRef(null);

  // Close the account menu when tapping anywhere else.
  useEffect(() => {
    const close = (e) => { if (menuRef.current?.open && !menuRef.current.contains(e.target)) menuRef.current.open = false; };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Jump to the top when switching sections (product cards handle their own scroll).
  useEffect(() => { window.scrollTo(0, 0); }, [view]);

  const loadProfile = async () => {
    if (!session) return setProfile(null);
    const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    setProfile(data ?? { role: "pending", email: session.user.email });
  };
  useEffect(() => { loadProfile(); }, [session?.user?.id]);

  if (!configured) {
    return (
      <div className="center-screen"><div className="auth panel">
        <h2>Almost there</h2>
        <p className="muted" style={{ marginTop: 8 }}>This copy of the hub isn't connected to its database yet.</p>
      </div></div>
    );
  }
  if (session === undefined) return <div className="center-screen"><div className="spinner" /></div>;
  if (!session) return <Login />;
  if (recovering) return <ChangePassword fullScreen onDone={() => setRecovering(false)} />;
  if (!profile) return <div className="center-screen"><div className="spinner" /></div>;

  if (profile.role === "pending") {
    return (
      <div className="center-screen"><div className="auth panel">
        <h2>No access right now</h2>
        <p style={{ marginTop: 8 }}><strong>{profile.email}</strong> doesn't have access to the hub at the moment. Ask your manager to turn it back on.</p>
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn" onClick={loadProfile}>Check again</button>
          <button className="btn secondary" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div></div>
    );
  }

  const isAdmin = profile.role === "admin";

  return (
    <>
      <header className="appbar">
        <div className="appbar-inner">
          <a className="brand" href="#/" aria-label="Applicator Hub, all products">
            <img src="/agri-stor-logo.png" alt="" width="64" height="39" />
            <span className="brand-text">
              <span className="brand-name">Applicator Hub</span>
              <span className="brand-sub">Agri-Stor Companies</span>
            </span>
          </a>
          <nav className="appbar-links">
            {isAdmin && <a className="link-btn" href="#/team" aria-current={view === "team" ? "page" : undefined}>Team</a>}
            <details className="account" ref={menuRef}>
              <summary className="link-btn">Account</summary>
              <div className="account-menu">
                <span className="who">{profile.email}</span>
                <button className="link-btn" onClick={() => { menuRef.current.open = false; setChangingPw(true); window.scrollTo(0, 0); }}>Change password</button>
                <button className="link-btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
              </div>
            </details>
          </nav>
        </div>
      </header>
      <nav className="sections" aria-label="Sections">
        <div className="sections-inner">
          <a href="#/" aria-current={view === "ref" ? "page" : undefined}>Products</a>
          <a href="#/setup" aria-current={view === "setup" || view === "post" ? "page" : undefined}>Checklists</a>
        </div>
      </nav>
      <main className="shell">
        {changingPw && (
          <ChangePassword onDone={(saved) => { setChangingPw(false); if (saved) { setToast("Password changed."); setTimeout(() => setToast(null), 3000); } }} />
        )}
        {toast && <p className="notice" role="status" style={{ marginBottom: 16 }}>{toast}</p>}
        {view === "team" && isAdmin ? (
          <Suspense fallback={<div className="thinking"><span className="spinner" />Loading…</div>}>
            <TeamPage me={profile} onBack={() => { location.hash = "#/"; }} />
          </Suspense>
        ) : view === "setup" || view === "post" ? (
          <Checklists list={view} />
        ) : (
          <Reference />
        )}
      </main>
    </>
  );
}
