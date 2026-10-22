import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY;

export const configured = Boolean(url && key);
export const supabase = configured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

// Open a stored file in a new tab, jumping to a page for PDFs.
// The tab is opened before the await so phones don't treat it as a popup.
export async function openDocument(doc, page) {
  const tab = window.open("", "_blank");
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.file_path, 60 * 60);
  if (error || !data?.signedUrl) {
    if (tab) tab.close();
    alert("Couldn't open that file. Try again, or ask an admin to re-upload it.");
    return;
  }
  const isPdf = (doc.file_type || "").includes("pdf") || /\.pdf$/i.test(doc.file_name || doc.file_path);
  const target = isPdf && page ? `${data.signedUrl}#page=${page}` : data.signedUrl;
  if (tab) tab.location.href = target;
  else window.location.href = target;
}

export async function fetchDocument(id) {
  const { data } = await supabase.from("documents").select("*").eq("id", id).maybeSingle();
  return data;
}
