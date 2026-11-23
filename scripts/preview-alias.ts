// A preview URL is <alias>-<worker>.<subdomain>.workers.dev. Cloudflare takes
// an alias of lowercase letters, digits and dashes that starts with a letter,
// and the alias with the Worker name must fit one 63-character DNS label.
export function previewAlias(branch: string, worker: string) {
  const words = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!words) throw new Error("PREVIEW_BRANCH_REQUIRED");
  return (/^[a-z]/.test(words) ? words : `branch-${words}`)
    .slice(0, 63 - worker.length - 1)
    .replace(/-+$/, "");
}
