// Turns an uploaded file into searchable passages, in the browser.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const TARGET = 900; // characters per passage
const OVERLAP = 150;

export function fileKind(file) {
  const name = (file.name || "").toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (/\.(txt|md|csv)$/.test(name) || file.type.startsWith("text/")) return "text";
  return "other";
}

async function pdfPages(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let text = "";
    for (const item of tc.items) {
      if (!("str" in item)) continue;
      text += item.str + (item.hasEOL ? "\n" : " ");
    }
    pages.push({ page: i, text });
  }
  return { pages, pageCount: doc.numPages };
}

export async function extractPages(file) {
  const kind = fileKind(file);
  const buf = await file.arrayBuffer();
  if (kind === "pdf") return pdfPages(buf);
  if (kind === "docx") {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
    return { pages: [{ page: null, text: value }], pageCount: null };
  }
  if (kind === "text") {
    return { pages: [{ page: null, text: new TextDecoder().decode(buf) }], pageCount: null };
  }
  return { pages: [], pageCount: null };
}

const clean = (s) =>
  s
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Split text into ~900-character passages on paragraph/sentence boundaries,
// keeping a little overlap so a fact split across passages is still found.
export function toChunks(pages, title, description) {
  const out = [];
  let idx = 0;
  const header = `[${title}]`;
  if (description?.trim()) {
    out.push({ page: null, chunk_index: idx++, content: `${header}\n${description.trim()}` });
  }
  for (const { page, text } of pages) {
    const body = clean(text);
    if (!body) continue;
    const parts = body.split(/\n\n+|(?<=[.!?:;])\s+(?=[A-Z0-9•\-(])/);
    let buf = "";
    const flush = () => {
      const t = buf.trim();
      if (t.length > 40) out.push({ page, chunk_index: idx++, content: `${header}\n${t}` });
      buf = t.length > OVERLAP ? t.slice(-OVERLAP).replace(/^\S*\s/, "") : "";
    };
    for (let part of parts) {
      while (part.length > TARGET * 1.5) {
        buf += (buf ? " " : "") + part.slice(0, TARGET);
        part = part.slice(TARGET);
        flush();
      }
      if (buf.length + part.length > TARGET && buf.length > OVERLAP) flush();
      buf += (buf ? "\n" : "") + part;
    }
    if (buf.trim().length > OVERLAP || (buf.trim() && !out.some((c) => c.page === page))) {
      const t = buf.trim();
      if (t.length > 40) out.push({ page, chunk_index: idx++, content: `${header}\n${t}` });
    }
  }
  return out;
}

