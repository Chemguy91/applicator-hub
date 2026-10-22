export function stripHeader(content) {
  return content.replace(/^\[[^\]]*\]\n/, "");
}
