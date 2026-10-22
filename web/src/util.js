export function stripHeader(content) {
  return content.replace(/^\[[^\]]*\]\n/, "");
}

const STOP = new Set(
  "the a an and or of to in on for with at by from is are was were be been it its this that these those what which who whom how when where why do does did can could should would will shall may might must i me my we our you your they them their there here about into than then so if not no any all some much many more most per after before during over under up down out off need use using get".split(" ")
);

// Words that suggest the person wants a number (rate, time, temperature...).
const WANTS_NUMBER = /\b(how (much|many|long|often|far|hot|cold|soon)|rate|dose|dosage|rei|interval|temp|temperature|degrees|amount|volume|gallons?|ounces?|oz|lbs?|pounds?|ppm|hours?|days?|minutes?|psi|setting|calibrat\w*)\b/i;

// Common field shorthand -> words the documents actually use.
const SYNONYMS = {
  ppe: ["respir", "glove", "goggl", "protec", "coverall"],
  rei: ["re-en", "reent", "entry"],
  "re-entry": ["reent", "entry"],
  sds: ["safet", "hazar"],
  msds: ["safet", "hazar"],
  temp: ["tempe"],
  cipc: ["chlor"],
  calibrate: ["calib"],
  dose: ["rate", "dosag"],
};

// Turn a question into short search stems ("calibrating" -> "calib") so word forms still match.
export function questionTerms(question) {
  const words = question.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? [];
  const terms = new Set();
  for (const w of words) {
    if (STOP.has(w)) continue;
    if (w.length < 3 && !/\d/.test(w)) continue;
    terms.add(w.length > 5 ? w.slice(0, 5) : w);
    for (const extra of SYNONYMS[w] ?? []) terms.add(extra);
  }
  return [...terms];
}

const splitSentences = (text) =>
  text
    .replace(/\s*\n\s*/g, "\n")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9•(])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);

const hits = (sentence, terms) => {
  const lower = sentence.toLowerCase();
  return terms.filter((t) => lower.includes(t)).length;
};

// Picks the sentences that best answer the question from the top-ranked passages.
// Returns { source, sentences, score, strong } or null when there are no passages.
export function bestAnswer(question, sources) {
  if (!sources?.length) return null;
  const terms = questionTerms(question);
  const wantsNumber = WANTS_NUMBER.test(question);
  let best = null;

  sources.slice(0, 5).forEach((src, rank) => {
    const sentences = splitSentences(src.content ?? src.snippet ?? "");
    sentences.forEach((sent, i) => {
      let score = hits(sent, terms);
      if (score === 0) return;
      if (wantsNumber && /\d/.test(sent)) score += 0.75;
      if (sent.length > 400) score -= 0.5; // run-on table text reads badly as an answer
      score *= 1 - rank * 0.08; // trust the search ranking a little
      if (!best || score > best.score) best = { source: src, index: i, sentences, score };
    });
  });

  if (!best) {
    const src = sources[0];
    const sentences = splitSentences(src.content ?? src.snippet ?? "");
    return { source: src, sentences: sentences.slice(0, 2), score: 0, strong: false, terms };
  }

  // Include the next sentence when it continues the thought (short, or also on topic),
  // and the previous one when the best sentence is very short.
  const out = [best.sentences[best.index]];
  const next = best.sentences[best.index + 1];
  if (next && (hits(next, terms) > 0 || next.length < 140) && out[0].length < 260) out.push(next);
  const prev = best.sentences[best.index - 1];
  if (prev && out.join(" ").length < 90 && hits(prev, terms) > 0) out.unshift(prev);

  const coverage = terms.length ? hits(out.join(" "), terms) / terms.length : 1;
  return { source: best.source, sentences: out, score: best.score, strong: coverage >= 0.5 || best.score >= 2, terms };
}

// Splits text into plain and highlighted pieces for rendering.
export function highlightParts(text, terms) {
  if (!terms?.length) return [{ text, mark: false }];
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Highlight the whole word that starts with the stem, e.g. "calib" -> "calibrate".
  const re = new RegExp(`\\b(${escaped.join("|")})[a-z0-9-]*`, "gi");
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), mark: false });
    parts.push({ text: m[0], mark: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), mark: false });
  return parts;
}
