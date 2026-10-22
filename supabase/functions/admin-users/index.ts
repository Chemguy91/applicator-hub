// Lets admins manage accounts from inside the app (self sign-up is turned off).
// Actions: create (name, email, password, role), set_password, delete.
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

const ROLES = ["applicator", "admin"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = pick("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const service = pick("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization") ?? "";

  const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: me } = await asUser.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  const { data: isAdmin } = await asUser.rpc("is_admin");
  if (!me?.user || !isAdmin) return json({ error: "Only admins can manage accounts." }, 403);

  let body: Record<string, string> = {};
  try { body = await req.json(); } catch { return json({ error: "Bad request body" }, 400); }
  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

  if (body.action === "create") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.full_name ?? "").trim();
    const password = String(body.password ?? "");
    const role = ROLES.includes(body.role) ? body.role : "applicator";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
    if (password.length < 8) return json({ error: "The starting password needs at least 8 characters." }, 400);

    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: name },
    });
    if (error) {
      const msg = /already/i.test(error.message) ? "Someone with that email already has an account." : error.message;
      return json({ error: msg }, 400);
    }
    // The sign-up trigger creates the profile as 'pending'; set the chosen role.
    await admin.from("profiles").update({ role, full_name: name }).eq("id", data.user.id);
    return json({ ok: true, id: data.user.id });
  }

  if (body.action === "set_password") {
    if (!body.user_id) return json({ error: "user_id is required" }, 400);
    if (String(body.password ?? "").length < 8) return json({ error: "The new password needs at least 8 characters." }, 400);
    const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (body.action === "delete") {
    if (!body.user_id) return json({ error: "user_id is required" }, 400);
    if (body.user_id === me.user.id) return json({ error: "You can't remove your own account." }, 400);
    const { error } = await admin.auth.admin.deleteUser(body.user_id);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
