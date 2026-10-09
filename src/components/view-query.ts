"use client";

/** View-only filters use Next's native-history integration without a server navigation. */
export function currentViewQuery() {
  return new URLSearchParams(window.location.search);
}

export function replaceViewQuery(query: URLSearchParams) {
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query.size ? `?${query}` : ""}`,
  );
}
