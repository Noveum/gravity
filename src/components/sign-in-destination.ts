export function signInDestination(query: URLSearchParams, origin: string) {
  try {
    const target = new URL(query.get("callbackURL") ?? "/", origin);
    const isSignIn =
      decodeURIComponent(target.pathname).replace(/\/+$/, "") === "/sign-in";
    return target.origin === origin && !isSignIn
      ? `${target.pathname}${target.search}`
      : "/";
  } catch {
    return "/";
  }
}

export function authenticatedSignInDestination(
  query: URLSearchParams,
  origin: string,
) {
  const signed = query.toString();
  if (signed.length <= 10000 && query.get("sig") && query.get("client_id"))
    return `/authorize?${signed}`;
  return signInDestination(query, origin);
}
