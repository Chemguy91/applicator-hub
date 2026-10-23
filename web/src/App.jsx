import React, { Suspense, lazy, useEffect, useState } from "react";
import { supabase, configured } from "./supabase.js";
import Login from "./pages/Login.jsx";
import Reference from "./pages/Reference.jsx";
import Checklists from "./pages/Setup.jsx";
const Results = lazy(() => import("./pages/Results.jsx"));

function viewFromHash() {
  const h = location.hash;
  if (h === "#/results") return "results";
  if (h === "#/setup") return "setup";
  if (h === "#/post") return "post";
  return "ref";
}

export const LOCATIONS = { WA: "Washington", ID: "Idaho", CO: "Colorado" };

// Everyone on a code shares one account, so sign out only this phone, never the others.
const signOut = () => supabase.auth.signOut({ scope: "local" });

export default function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [view, setView] = useState(viewFromHash);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Jump to the top when switching sections (product cards handle their own scroll).
  useEffect(() => { window.scrollTo(0, 0); }, [view]);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    supabase.from("profiles").select("role, location").eq("id", session.user.id).maybeSingle()
      .then(({ data }) => setProfile(data ?? { role: "pending" }));
  }, [session?.user?.id]);

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
  if (!profile) return <div className="center-screen"><div className="spinner" /></div>;
  if ((profile.role !== "applicator" && profile.role !== "admin") || !LOCATIONS[profile.location]) {
    return (
      <div className="center-screen"><div className="auth panel">
        <h2>Sign in again</h2>
        <p style={{ marginTop: 8 }}>This sign-in no longer works. Enter the current code to get back in.</p>
        <button className="btn" style={{ marginTop: 16 }} onClick={signOut}>Enter code</button>
      </div></div>
    );
  }

  const isAdmin = profile.role === "admin";
  const current = view;
  const place = LOCATIONS[profile.location];

  return (
    <>
      <header className="appbar">
        <div className="appbar-inner">
          <a className="brand" href="#/" aria-label="Applicator Hub, all products">
            <img src="/agri-stor-logo.png" alt="" width="64" height="40" />
            <span className="brand-text">
              <span className="brand-name">Applicator Hub</span>
              <span className="brand-sub">{place}{isAdmin ? ", admin" : ""}</span>
            </span>
          </a>
          <nav className="appbar-links">
            <button className="link-btn" onClick={signOut}>Sign out</button>
          </nav>
        </div>
      </header>
      <nav className="sections" aria-label="Sections">
        <div className="sections-inner">
          <a href="#/" aria-current={current === "ref" ? "page" : undefined}>Products</a>
          <a href="#/setup" aria-current={current === "setup" || current === "post" ? "page" : undefined}>Checklists</a>
          <a href="#/results" aria-current={current === "results" ? "page" : undefined}>Results</a>
        </div>
      </nav>
      <main className="shell">
        {current === "results" ? (
          <Suspense fallback={<div className="thinking"><span className="spinner" />Loading…</div>}>
            <Results isAdmin={isAdmin} place={place} />
          </Suspense>
        ) : current === "setup" || current === "post" ? (
          <Checklists list={current} place={place} />
        ) : (
          <Reference />
        )}
      </main>
    </>
  );
}
