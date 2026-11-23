import { AsyncLocalStorage } from "node:async_hooks";

const origins = new AsyncLocalStorage<string>();
export const requestAppUrl = () => origins.getStore();
export function runWithAppUrl<T>(origin: string | undefined, run: () => T): T {
  return origin ? origins.run(origin, run) : run();
}
// A Worker version's preview URL is <alias>-<worker>.<subdomain>.workers.dev,
// next to the Worker's own <worker>.<subdomain>.workers.dev in APP_URL. Only
// such a host serves as its own origin; any other request keeps APP_URL.
export function previewAppUrl(requestUrl: string, configured?: string) {
  let app: URL;
  let request: URL;
  try {
    app = new URL(configured ?? "");
    request = new URL(requestUrl);
  } catch {
    return undefined;
  }
  if (
    app.protocol !== "https:" ||
    request.protocol !== "https:" ||
    app.port ||
    request.port ||
    !app.hostname.endsWith(".workers.dev")
  )
    return undefined;
  const suffix = `-${app.hostname}`;
  if (!request.hostname.endsWith(suffix)) return undefined;
  const alias = request.hostname.slice(0, -suffix.length);
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(alias)
    ? request.origin
    : undefined;
}
