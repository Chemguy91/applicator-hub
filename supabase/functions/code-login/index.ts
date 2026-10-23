// Signs a phone in with a shared access code. Each location (WA / ID / CO) has a
// general code and an admin code, each tied to its own shared account.
// The code is checked in the database against bcrypt hashes, with lockouts after
// repeated wrong codes. On success this signs in as that code's shared account
// (created the first time it's used) and returns a session to the browser.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function pick(jsonVar: string, legacyVar: string) {
  try {
    const parsed = JSON.parse(Deno.env.get(jsonVar) ?? "{}");
    if (parsed?.default) return parsed.default as string;
  } catch { /* fall through */ }
  return Deno.env.get(legacyVar)!;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let code = "";
  try { code = String((await req.json())?.code ?? "").trim(); } catch { /* handled below */ }
  if (!/^\d{4,8}$/.test(code)) return json({ error: "Enter the 4-digit code." }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = pick("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const service = pick("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
  const { data: rows, error: checkErr } = await admin.rpc("check_access_code", { p_code: code, p_ip: ip });
  if (checkErr) { console.error(checkErr); return json({ error: "Couldn't check the code. Try again." }, 500); }
  const hit = rows?.[0];
  if (hit?.locked) return json({ error: "Too many wrong codes. Wait 15 minutes and try again." }, 429);
  if (!hit?.role) return json({ error: "That code isn't right." }, 401);

  // Make sure the shared account exists (first sign-in creates it).
  const created = await admin.auth.admin.createUser({
    email: hit.account_email,
    email_confirm: true,
    user_metadata: { full_name: `${hit.location} ${hit.role === "admin" ? "Admin" : "Applicator"}` },
  });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) {
    console.error(created.error);
    return json({ error: "Couldn't sign in. Try again." }, 500);
  }

  // Sign in as that account without a password: make a one-time link token and redeem it here.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: hit.account_email });
  if (linkErr || !link?.properties?.hashed_token) { console.error(linkErr); return json({ error: "Couldn't sign in. Try again." }, 500); }
  const pub = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  let verified = await pub.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "email" });
  if (verified.error) verified = await pub.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  const session = verified.data?.session;
  if (!session) { console.error(verified.error); return json({ error: "Couldn't sign in. Try again." }, 500); }

  // Keep the account's access level and location in line with its code.
  const { error: profErr } = await admin.from("profiles")
    .update({ role: hit.role, location: hit.location, full_name: `${hit.location} ${hit.role === "admin" ? "Admin" : "Applicator"}` })
    .eq("id", session.user.id);
  if (profErr) { console.error(profErr); return json({ error: "Couldn't sign in. Try again." }, 500); }

  return json({ role: hit.role, location: hit.location, access_token: session.access_token, refresh_token: session.refresh_token });
});
