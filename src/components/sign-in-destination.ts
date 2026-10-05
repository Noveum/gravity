export function signInDestination(query: URLSearchParams, origin: string) {
  try {
    const target = new URL(query.get("callbackURL") ?? "/", origin);
    return target.origin === origin
      ? `${target.pathname}${target.search}`
      : "/";
  } catch {
    return "/";
  }
}
