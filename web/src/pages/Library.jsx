import React, { useEffect, useMemo, useState } from "react";
import { supabase, openDocument } from "../supabase.js";

export const ext = (d) => {
  const m = (d.file_name || "").match(/\.([a-z0-9]+)$/i);
  return m ? m[1].slice(0, 4).toUpperCase() : "FILE";
};

export default function Library() {
  const [docs, setDocs] = useState(null);
  const [filter, setFilter] = useState("");
  const [cat, setCat] = useState("All");

  useEffect(() => {
    supabase.from("documents").select("*").eq("status", "ready").order("title")
      .then(({ data }) => setDocs(data ?? []));
  }, []);

  const categories = useMemo(() => ["All", ...new Set((docs ?? []).map((d) => d.category).sort())], [docs]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (docs ?? []).filter((d) =>
      (cat === "All" || d.category === cat) &&
      (!f || `${d.title} ${d.description ?? ""} ${d.file_name}`.toLowerCase().includes(f)));
  }, [docs, filter, cat]);

  const grouped = useMemo(() => {
    const g = new Map();
    for (const d of shown) { if (!g.has(d.category)) g.set(d.category, []); g.get(d.category).push(d); }
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [shown]);

  if (docs === null) return <div className="thinking"><span className="spinner" />Loading documents…</div>;

  if (docs.length === 0) {
    return (
      <div className="empty">
        <h3>No documents yet</h3>
        <p>Once an admin uploads labels, SDS sheets and manuals, they'll be listed here.</p>
      </div>
    );
  }

  return (
    <>
      <h1 style={{ marginBottom: 12 }}>Library</h1>
      <input className="search" type="search" placeholder="Filter by name" value={filter}
        onChange={(e) => setFilter(e.target.value)} aria-label="Filter documents by name" />
      {categories.length > 2 && (
        <div className="filters" role="group" aria-label="Category">
          {categories.map((c) => (
            <button key={c} className="filter" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      )}
      {grouped.length === 0 && <p className="empty">No documents match “{filter}”.</p>}
      {grouped.map(([category, list]) => (
        <section key={category}>
          <h2 className="group-label">{category}</h2>
          <div className="list">
            {list.map((d) => (
              <button key={d.id} className="doc-row" onClick={() => openDocument(d)}>
                <span className="doc-icon">{ext(d)}</span>
                <span className="doc-main">
                  <span className="doc-title" style={{ display: "block" }}>{d.title}</span>
                  <span className="doc-sub">
                    {d.page_count ? `${d.page_count} page${d.page_count > 1 ? "s" : ""}` : d.file_name}
                    {d.description ? `. ${d.description}` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
