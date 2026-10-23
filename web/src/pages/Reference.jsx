import React, { useEffect, useMemo, useRef, useState } from "react";
import CARDS from "../data/cards.json";

const GROUPS = [
  { id: "all", label: "All" },
  { id: "sprout", label: "Sprout inhibitors" },
  { id: "sanitizer", label: "Sanitizers" },
];

// Heat bar scale for tip temperatures on the processing sheet (150–650°F today).
const TEMP_MIN = 100;
const TEMP_MAX = 700;
const heatPct = (t) => Math.max(6, Math.min(100, ((t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * 100));

const SHUTDOWN = {
  "standby-4": { short: "Humidity off 24 hr before", detail: "4-hr standby after" },
  "standby-24": { short: "Humidity off 24 hr before", detail: "24-hr standby after" },
  "no-shutdown": { short: "No shutdown", detail: "Fans and heat back on right after" },
  ventilate: { short: "Fans run during and after", detail: "Ventilate 3–7 days" },
  other: { short: "See procedure", detail: "" },
};

const searchText = (c) =>
  [c.name, c.ingredient, c.what, c.does, ...c.tags, ...c.treats.flatMap((t) => t.items)].join(" ").toLowerCase();

function getHashId() {
  const m = location.hash.match(/^#\/card\/([a-z0-9-]+)/);
  return m ? m[1] : null;
}

function HeatBar({ temp }) {
  return (
    <span className="heat" aria-hidden="true">
      <span className="heat-fill" style={{ width: `${heatPct(temp)}%`, "--fill": heatPct(temp) }} />
    </span>
  );
}

function Tile({ card, onOpen }) {
  const p = card.processing;
  const sd = SHUTDOWN[card.shutdown];
  return (
    <button className={`tile tile-${card.group}`} onClick={() => onOpen(card.id)}>
      <span className="tile-group">{card.group === "sprout" ? "Sprout inhibitor" : "Sanitizer"}</span>
      <span className="tile-name">{card.name}</span>
      <span className="tile-ingredient">{card.ingredient}</span>
      <span className="tile-foot">
        {p ? (
          <>
            <span className="tile-temp">
              {p.tip_temp_f}<span className="deg">°F</span>
            </span>
            <HeatBar temp={p.tip_temp_f} />
            <span className="tile-specs">
              <span>{p.volume}</span>
              <span>{p.airflow}</span>
            </span>
            {p.combos?.length > 0 && <span className="tile-combos">+ {p.combos.length} CIPC combos</span>}
          </>
        ) : (
          <>
            <span className="tile-rule">{sd.short}</span>
            <span className="tile-specs"><span>{sd.detail}</span></span>
          </>
        )}
      </span>
    </button>
  );
}

// "60-70 LBS/Hour" -> ["60-70", "lbs per hour"]; "200-300 CFM" -> ["200-300", "CFM"]; "50% Air" -> ["50%", "air"]
function splitVolume(v) {
  const m = v.match(/^\s*([\d.\-–]+)\s*(LBS|GALS)/i);
  return m ? [m[1], /LBS/i.test(m[2]) ? "lbs per hour" : "gal per hour"] : [v, ""];
}
function splitAirflow(a) {
  const m = a.match(/^\s*([\d.\-–%]+)\s*(.*)$/);
  return m ? [m[1], /cfm/i.test(m[2]) ? "CFM" : m[2].toLowerCase()] : [a, ""];
}

function Settings({ s, compact }) {
  const [vol, volHint] = splitVolume(s.volume);
  const [air, airHint] = splitAirflow(s.airflow);
  return (
    <>
      <div className={`stats ${compact ? "stats-compact" : ""}`}>
        <Stat label="Tip temp" value={s.tip_temp_f} unit="°F" />
        <Stat label="Volume" value={vol} hint={volHint} />
        <Stat label="Airflow" value={air} hint={airHint} />
      </div>
      <HeatBar temp={s.tip_temp_f} />
    </>
  );
}

function Stat({ label, value, unit, hint }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}{unit && <span className="stat-unit">{unit}</span>}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

function Detail({ card, onSelect, onBack }) {
  const tabsRef = useRef(null);
  const idx = CARDS.findIndex((c) => c.id === card.id);
  const prev = CARDS[idx - 1];
  const next = CARDS[idx + 1];
  const p = card.processing;

  useEffect(() => {
    window.scrollTo(0, 0);
    const el = tabsRef.current?.querySelector('[aria-current="page"]');
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [card.id]);

  return (
    <article className={`detail detail-${card.group}`}>
      <nav className="ref-tabs" ref={tabsRef} aria-label="Products">
        {CARDS.map((c) => (
          <button key={c.id} className="ref-tab" aria-current={c.id === card.id ? "page" : undefined} onClick={() => onSelect(c.id)}>
            {c.name}
          </button>
        ))}
      </nav>

      <button className="back-link" onClick={onBack}>← All products</button>

      <header className="detail-head">
        <h1>{card.name}</h1>
        <p className="detail-ingredient">{card.ingredient}</p>
        <div className="pills">{card.tags.map((t) => <span key={t} className="pill">{t}</span>)}</div>
      </header>

      <section className="processing" aria-labelledby="proc-h">
        <h2 id="proc-h">Processing settings</h2>
        {p ? (
          <>
            <Settings s={p} />
            <p className="processing-note">
              At the tip of the Sprout-Nip machine.{" "}
              {p.same_as
                ? <>Uses the same settings as “{p.same_as}” on the processing sheet.</>
                : <>Listed on the processing sheet as “{p.sheet_name}”.</>}
            </p>
            {p.combos?.length > 0 && (
              <div className="combos">
                <h3>CIPC combos</h3>
                {p.combos.map((c) => (
                  <div key={c.sheet_name} className="combo">
                    <p className="combo-name">{c.sheet_name}</p>
                    <Settings s={c} compact />
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="processing-none">Not on the processing temperature sheet yet. Check the label or ask your manager before setting the machine.</p>
        )}
      </section>

      <section className="procedure">
        <h2>Thermal application procedure</h2>
        <p>{card.procedure}</p>
      </section>

      <section className="detail-section">
        <h2>What it is</h2>
        <p>{card.what}</p>
      </section>

      <section className="detail-section">
        <h2>What it does</h2>
        <p>{card.does}</p>
      </section>

      <section className="detail-section">
        <h2>Diseases and conditions controlled</h2>
        {card.treats.map((t) => (
          <div key={t.where} className="treats">
            <h3>Treats in {t.where.toLowerCase()}</h3>
            <div className="pills">{t.items.map((d) => <span key={d} className="pill pill-plain">{d}</span>)}</div>
          </div>
        ))}
      </section>

      <p className="disclaimer">Reference summary only. Always follow the official product label.</p>

      <nav className="prev-next" aria-label="Next and previous product">
        {prev ? <button className="btn secondary" onClick={() => onSelect(prev.id)}>← {prev.name}</button> : <span />}
        {next ? <button className="btn secondary" onClick={() => onSelect(next.id)}>{next.name} →</button> : <span />}
      </nav>
    </article>
  );
}

export default function Reference() {
  const [openId, setOpenId] = useState(getHashId);
  const [group, setGroup] = useState(() => {
    try { return sessionStorage.getItem("ref-group") || "all"; } catch { return "all"; }
  });
  const [query, setQuery] = useState("");
  const scrollY = useRef(0);

  useEffect(() => {
    const onHash = () => setOpenId(getHashId());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem("ref-group", group); } catch { /* storage unavailable */ }
  }, [group]);

  const open = (id) => {
    if (!openId) scrollY.current = window.scrollY;
    location.hash = `#/card/${id}`;
  };
  const back = () => {
    if (history.length > 1 && openId) history.back();
    else location.hash = "#/";
    requestAnimationFrame(() => window.scrollTo(0, scrollY.current));
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CARDS.filter((c) => (group === "all" || c.group === group) && (!q || searchText(c).includes(q)));
  }, [group, query]);

  const counts = useMemo(() => ({
    all: CARDS.length,
    sprout: CARDS.filter((c) => c.group === "sprout").length,
    sanitizer: CARDS.filter((c) => c.group === "sanitizer").length,
  }), []);

  const card = openId && CARDS.find((c) => c.id === openId);
  if (card) return <Detail card={card} onSelect={open} onBack={back} />;

  return (
    <>
      <div className="ref-top">
        <h1 className="page-title">Product reference</h1>
        <input
          className="search" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products, ingredients or diseases" aria-label="Search products"
        />
        <div className="group-tabs" role="tablist" aria-label="Product type">
          {GROUPS.map((g) => (
            <button key={g.id} role="tab" aria-selected={group === g.id} className="group-tab" onClick={() => setGroup(g.id)}>
              {g.label} <span className="count">{counts[g.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <h3>No products match “{query}”</h3>
          <p>Try a product name, an active ingredient, or a disease like late blight.</p>
        </div>
      ) : (
        <div className="tiles">
          {shown.map((c) => <Tile key={c.id} card={c} onOpen={open} />)}
        </div>
      )}
    </>
  );
}
