"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}
const readSearch = () => window.location.search.slice(1);

/** Native-history edits must reach controls before the next input event. */
export function useViewQuery() {
  // Next supplies the server snapshot and rerenders after router navigation.
  // The live URL remains authoritative when an older Next transition completes.
  const routeSearch = useSearchParams().toString();
  const search = useSyncExternalStore(subscribe, readSearch, () => routeSearch);
  // Next commits browser history after rendering, including navigations whose
  // query snapshot is unchanged. Recheck the live URL after every commit.
  useEffect(() => {
    if (search !== readSearch()) for (const listener of listeners) listener();
  });
  return useMemo(() => new URLSearchParams(search), [search]);
}

/** View-only filters use Next's native-history integration without a server navigation. */
export function currentViewQuery() {
  return new URLSearchParams(window.location.search);
}

function writeViewQuery(
  query: URLSearchParams,
  method: "replaceState" | "pushState",
) {
  window.history[method](
    null,
    "",
    `${window.location.pathname}${query.size ? `?${query}` : ""}`,
  );
  for (const listener of listeners) listener();
}

export function replaceViewQuery(query: URLSearchParams) {
  writeViewQuery(query, "replaceState");
}

export function pushViewQuery(query: URLSearchParams) {
  writeViewQuery(query, "pushState");
}
