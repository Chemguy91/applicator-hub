import React, { useEffect, useRef, useState } from "react";
import { supabase, openDocument, fetchDocument } from "../supabase.js";
import { stripHeader } from "../util.js";

const STARTERS = [
  "What PPE do I need for fogging?",
  "Re-entry time after application?",
  "How do I calibrate the applicator?",
];

// Minimal, safe formatter: paragraphs, "- " bullets, **bold**, and [n] citations.
function Formatted({ text, onCite, max }) {
  const inline = (line, key) => {
    const parts = line.split(/(\*\*[^*]+\*\*|\[\d+(?:,\s*\d+)*\])/g);
    return parts.map((p, i) => {
      if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong>;
      const m = p.match(/^\[(\d+(?:,\s*\d+)*)\]$/);
      if (m) {
        return m[1].split(/,\s*/).map(Number).filter((n) => n >= 1 && n <= max).map((n) => (
          <button key={`${key}-${i}-${n}`} className="cite" onClick={() => onCite(n)} aria-label={`Source ${n}`}>{n}</button>
        ));
      }
      return <React.Fragment key={`${key}-${i}`}>{p}</React.Fragment>;
    });
  };
  const blocks = [];
  let bullets = [];
  const lines = text.split("\n");
  const flushBullets = (k) => {
    if (bullets.length) blocks.push(<ul key={`ul-${k}`}>{bullets.map((b, i) => <li key={i}>{inline(b, `li-${k}-${i}`)}</li>)}</ul>);
    bullets = [];
  };
  lines.forEach((raw, k) => {
    const line = raw.trim();
    if (/^[-•*]\s+/.test(line)) { bullets.push(line.replace(/^[-•*]\s+/, "")); return; }
    flushBullets(k);
    if (line) blocks.push(<p key={`p-${k}`}>{inline(line.replace(/^#+\s*/, ""), `p-${k}`)}</p>);
  });
  flushBullets("end");
  return <div className="answer-body">{blocks}</div>;
}

export default function Ask({ profile, initialQuestion, onConsumed }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [recent, setRecent] = useState([]);
  const [helpful, setHelpful] = useState(null);
  const [flash, setFlash] = useState(null);
  const [titleHits, setTitleHits] = useState([]);
  const sourceRefs = useRef({});

  useEffect(() => {
    supabase.from("questions").select("question").eq("user_id", profile.id).order("created_at", { ascending: false }).limit(20)
      .then(({ data }) => {
        const seen = new Set();
        setRecent((data ?? []).map((r) => r.question).filter((x) => !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase())).slice(0, 4));
      });
  }, [profile.id, result]);

  useEffect(() => {
    if (initialQuestion) { setQ(initialQuestion); ask(initialQuestion); onConsumed?.(); }
  }, [initialQuestion]);

  const ask = async (question) => {
    const text = (question ?? q).trim();
    if (text.length < 2 || busy) return;
    setBusy(true); setError(null); setResult(null); setHelpful(null); setTitleHits([]);
    const words = text.replace(/[%,()]/g, " ").split(/\s+/).filter((w) => w.length > 3).slice(0, 5);
    const titleQuery = words.length
      ? supabase.from("documents").select("*").eq("status", "ready").or(words.map((w) => `title.ilike.%${w}%`).join(",")).limit(5)
      : Promise.resolve({ data: [] });
    const [{ data, error: fnError }, { data: titles }] = await Promise.all([
      supabase.functions.invoke("ask", { body: { question: text } }),
      titleQuery,
    ]);
    setBusy(false);
    if (fnError) {
      let message = "Something went wrong reaching the hub. Check your signal and try again.";
      try { const body = await fnError.context?.json?.(); if (body?.error) message = body.error; } catch {}
      setError(message);
      return;
    }
    setResult(data);
    setTitleHits(titles ?? []);
  };

  const cite = (n) => {
    const el = sourceRefs.current[n];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(n);
    setTimeout(() => setFlash(null), 1400);
  };

  const open = async (s) => {
    const doc = await fetchDocument(s.document_id);
    if (doc) openDocument(doc, s.page);
  };

  const rate = async (v) => {
    setHelpful(v);
    if (result?.question_id) await supabase.from("questions").update({ helpful: v }).eq("id", result.question_id);
  };

  // Documents related to this question: cited ones first, then title matches.
  const relatedDocs = (() => {
    if (!result) return [];
    const map = new Map();
    for (const s of result.sources) if (!map.has(s.document_id)) map.set(s.document_id, { id: s.document_id, title: s.title, category: s.category, page: s.page });
    for (const d of titleHits) if (!map.has(d.id)) map.set(d.id, { id: d.id, title: d.title, category: d.category, page: null });
    return [...map.values()].slice(0, 6);
  })();

  const firstName = (profile.full_name || "").split(" ")[0];
  const suggestions = recent.length ? recent : STARTERS;

  return (
    <>
      <form className="ask-tag" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <h1>{firstName ? `What do you need, ${firstName}?` : "What do you need to know?"}</h1>
        <div className="ask-row">
          <textarea
            className="ask-input" rows={2} value={q} maxLength={500}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
            placeholder="Ask about a product, rate, label or machine"
            aria-label="Your question" enterKeyHint="search"
          />
          <button className="ask-btn" disabled={busy || q.trim().length < 2}>{busy ? <span className="spinner" /> : "Ask"}</button>
        </div>
        {!result && !busy && (
          <div className="chips">
            {suggestions.map((s) => (
              <button type="button" key={s} className="chip" onClick={() => { setQ(s); ask(s); }}>{s}</button>
            ))}
          </div>
        )}
      </form>

      {busy && <div className="thinking" role="status"><span className="spinner" />Searching your documents…</div>}
      {error && <p className="notice warn section" role="alert">{error}</p>}

      {result && (
        <>
          <section className="section" aria-live="polite">
            <div className="answer">
              <p className="answer-q">{result.question}</p>
              {result.answer && result.found && (
                <Formatted text={result.answer} onCite={cite} max={result.sources.length} />
              )}
              {!result.found && (
                <>
                  <h3>Not in the documents yet</h3>
                  <p className="muted" style={{ marginTop: 6 }}>
                    Nothing uploaded answers that. Try different words, or ask your manager — this question has been logged so the right document can be added.
                  </p>
                  {result.answer && <div style={{ marginTop: 10 }}><Formatted text={result.answer} onCite={cite} max={result.sources.length} /></div>}
                </>
              )}
              {result.found && !result.answer && (
                <p>{result.note ?? "Here are the passages that best match your question."}</p>
              )}
              {result.note && result.answer && <p className="notice" style={{ marginTop: 12 }}>{result.note}</p>}
              {result.mode === "answer" && result.found && (
                <div className="feedback">
                  Did this answer it?
                  <button aria-pressed={helpful === true} onClick={() => rate(true)}>Yes</button>
                  <button aria-pressed={helpful === false} onClick={() => rate(false)}>No</button>
                </div>
              )}
            </div>
          </section>

          {relatedDocs.length > 0 && (
            <section className="section">
              <h2>Documents</h2>
              <div className="list">
                {relatedDocs.map((d) => (
                  <button key={d.id} className="doc-row" onClick={async () => { const doc = await fetchDocument(d.id); if (doc) openDocument(doc, d.page); }}>
                    <span className="doc-icon">DOC</span>
                    <span className="doc-main">
                      <span className="doc-title">{d.title}</span>
                      <span className="doc-sub" style={{ display: "block" }}>{d.category}{d.page ? `, opens at page ${d.page}` : ""}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {result.sources.length > 0 && (
            <section className="section">
              <h2>Where this comes from</h2>
              <div className="list">
                {result.sources.map((s) => (
                  <button key={s.n} ref={(el) => (sourceRefs.current[s.n] = el)} className={`source ${flash === s.n ? "flash" : ""}`} onClick={() => open(s)}>
                    <span className="source-n">{s.n}</span>
                    <span className="source-title">{s.title}</span>
                    <span className="source-meta">{s.page ? `Page ${s.page}` : s.category}. Tap to open</span>
                    <span className="source-snippet">{stripHeader(s.snippet)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
