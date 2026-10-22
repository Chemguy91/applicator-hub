// Indexes a batch of text passages for one document.
// Called by the admin upload screen: the browser extracts and splits the text,
// this function turns each passage into a search embedding and stores it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// @ts-ignore Supabase global is provided by the edge runtime
const model = new Supabase.ai.Session("gte-small");

type Chunk = { page: number | null; chunk_index: number; content: string };

function pick(jsonVar: string, legacyVar: string) {
  try {
    const parsed = JSON.parse(Deno.env.get(jsonVar) ?? "{}");
    if (parsed?.default) return parsed.default as string;
  } catch { /* fall through */ }
  return Deno.env.get(legacyVar)!;
}

function keys() {
  return {
    url: Deno.env.get("SUPABASE_URL")!,
    anon: pick("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"),
    service: pick("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const { url, anon, service } = keys();
  const authHeader = req.headers.get("Authorization") ?? "";

  // Who is calling? Must be an admin.
  const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: isAdmin, error: roleErr } = await asUser.rpc("is_admin");
  if (roleErr || !isAdmin) return json({ error: "Only admins can add documents." }, 403);

  let body: { document_id?: string; chunks?: Chunk[]; reset?: boolean; finish?: { page_count?: number } ; fail?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request body" }, 400);
  }
  const docId = body.document_id;
  if (!docId) return json({ error: "document_id is required" }, 400);

  const admin = createClient(url, service);

  const { data: doc, error: docErr } = await admin.from("documents").select("id").eq("id", docId).maybeSingle();
  if (docErr || !doc) return json({ error: "Document not found" }, 404);

  if (body.reset) {
    await admin.from("chunks").delete().eq("document_id", docId);
    await admin.from("documents").update({ status: "processing", error: null, updated_at: new Date().toISOString() }).eq("id", docId);
  }

  if (body.fail) {
    await admin.from("documents").update({ status: "error", error: body.fail.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", docId);
    return json({ ok: true });
  }

  const chunks = (body.chunks ?? []).filter((c) => c && typeof c.content === "string" && c.content.trim().length > 0);
  if (chunks.length > 40) return json({ error: "Send at most 40 passages per call" }, 400);

  if (chunks.length) {
    const rows = [];
    for (const c of chunks) {
      const content = c.content.trim().slice(0, 4000);
      const embedding = await model.run(content, { mean_pool: true, normalize: true });
      rows.push({
        document_id: docId,
        page: c.page ?? null,
        chunk_index: c.chunk_index,
        content,
        embedding: JSON.stringify(embedding),
      });
    }
    const { error: insErr } = await admin.from("chunks").insert(rows);
    if (insErr) return json({ error: insErr.message }, 500);
  }

  if (body.finish) {
    const { count } = await admin.from("chunks").select("id", { count: "exact", head: true }).eq("document_id", docId);
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (!count) {
      update.status = "error";
      update.error = "No readable text was found. If this is a scanned PDF, run it through OCR (e.g. Adobe 'Recognize Text') and upload again.";
    } else {
      update.status = "ready";
      update.error = null;
    }
    if (body.finish.page_count) update.page_count = body.finish.page_count;
    await admin.from("documents").update(update).eq("id", docId);
    return json({ ok: true, passages: count ?? 0, status: update.status });
  }

  return json({ ok: true, added: chunks.length });
});
