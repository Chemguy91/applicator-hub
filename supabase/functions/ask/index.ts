// Answers an applicator's question from the uploaded documents.
// 1. Finds the most relevant passages (keyword + meaning search).
// 2. If an ANTHROPIC_API_KEY secret is set, has Claude write a short answer
//    using only those passages, with [n] citations back to the source pages.
// 3. Logs the question so admins can see what people ask and what's missing.
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

function pick(jsonVar: string, legacyVar: string) {
  try {
    const parsed = JSON.parse(Deno.env.get(jsonVar) ?? "{}");
    if (parsed?.default) return parsed.default as string;
  } catch { /* fall through */ }
  return Deno.env.get(legacyVar)!;
}

type Hit = {
  chunk_id: number;
  document_id: string;
  title: string;
  category: string;
  page: number | null;
  content: string;
  score: number;
};

const SYSTEM = `You are the answer engine for an internal hub used by field applicators at Agri-Stor Companies, who treat stored potatoes and other crops (sprout inhibitors, disinfectants, fogging and application equipment, storage management).

You will be given numbered excerpts from the company's own documents (product labels, SDS sheets, SOPs, equipment manuals, training material). Answer the applicator's question using ONLY those excerpts.

Rules:
- Lead with the direct answer in one or two sentences. Applicators are reading on a phone in the field.
- Follow with only the supporting details they need (rates, intervals, temperatures, PPE, steps), as short bullet points if there are several.
- Cite every fact with the excerpt number in square brackets, like [2]. Use only numbers you were given.
- Copy numbers, units, rates, re-entry intervals and warnings exactly as written. Never convert units or round unless asked, and never estimate a value that isn't in the excerpts.
- If excerpts disagree, say so and cite both.
- For any rate, restriction or safety question that comes from a pesticide label, end with: "Always confirm against the current product label."
- If the excerpts do not contain the answer, reply with exactly NOT_FOUND on the first line, then one sentence saying what the documents do cover that might help (with citations), or nothing else if nothing is close. Do not answer from general knowledge.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = pick("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const service = pick("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization") ?? "";

  const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await asUser.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  const user = userData?.user;
  if (!user) return json({ error: "Please sign in again." }, 401);
  const { data: isMember } = await asUser.rpc("is_member");
  if (!isMember) return json({ error: "Your account is waiting for approval." }, 403);

  let question = "";
  try {
    const body = await req.json();
    question = String(body?.question ?? "").trim().slice(0, 500);
  } catch { /* handled below */ }
  if (question.length < 2) return json({ error: "Type a question first." }, 400);

  const embedding = await model.run(question, { mean_pool: true, normalize: true });
  const { data: hits, error: searchErr } = await asUser.rpc("hybrid_search", {
    query_text: question,
    query_embedding: JSON.stringify(embedding),
    match_count: 8,
  });
  if (searchErr) return json({ error: searchErr.message }, 500);

  const results = (hits ?? []) as Hit[];
  const sources = results.map((h, i) => ({
    n: i + 1,
    document_id: h.document_id,
    title: h.title,
    category: h.category,
    page: h.page,
    snippet: h.content.slice(0, 280),
  }));

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  let answer: string | null = null;
  let found = results.length > 0;
  let mode: "answer" | "search" = "search";
  let note: string | undefined;

  if (results.length && apiKey) {
    const excerpts = results
      .map((h, i) => `[${i + 1}] ${h.title}${h.page ? ` — page ${h.page}` : ""}\n${h.content}`)
      .join("\n\n---\n\n");
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: Deno.env.get("ANSWER_MODEL") ?? "claude-sonnet-5-5",
          max_tokens: 800,
          system: SYSTEM,
          messages: [
            { role: "user", content: `Excerpts:\n\n${excerpts}\n\nQuestion: ${question}` },
          ],
        }),
      });
      if (!resp.ok) {
        note = `Answer service error (${resp.status}). Showing matching passages instead.`;
        console.error("anthropic", resp.status, await resp.text());
      } else {
        const data = await resp.json();
        const text: string = (data.content ?? [])
          .filter((b: { type: string }) => b.type === "text")
          .map((b: { text: string }) => b.text)
          .join("")
          .trim();
        mode = "answer";
        if (text.startsWith("NOT_FOUND")) {
          found = false;
          answer = text.replace(/^NOT_FOUND\s*/, "").trim() || null;
        } else {
          answer = text;
        }
      }
    } catch (e) {
      note = "Couldn't reach the answer service. Showing matching passages instead.";
      console.error(e);
    }
  } else if (results.length && !apiKey) {
    note = "AI answers aren't switched on yet, so here are the best-matching passages.";
  }

  const admin = createClient(url, service);
  const { data: logged } = await admin
    .from("questions")
    .insert({ user_id: user.id, question, answer, found })
    .select("id")
    .single();

  return json({ question, answer, found, mode, note, sources, question_id: logged?.id ?? null });
});
