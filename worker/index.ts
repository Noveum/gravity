import { previewAppUrl, runWithAppUrl } from "@crm/auth/origin";
import { runWithInvocationDatabase } from "@crm/database/client";
import handler from "vinext/server/fetch-handler";
import { selfRoutingFetch } from "./self-fetch";

interface Environment {
  APP_URL?: string;
  CRON_SECRET?: string;
  HYPERDRIVE?: { connectionString: string };
  PREVIEW_ALIASES?: string;
  SELF?: { fetch: typeof fetch };
}
interface Invocation {
  waitUntil(promise: Promise<unknown>): void;
}

let self: Environment["SELF"];
const appOrigins = new Set<string>();
globalThis.fetch = selfRoutingFetch(
  globalThis.fetch.bind(globalThis),
  () => self,
  appOrigins,
);
function bind(env: Environment, url?: string) {
  self = env.SELF;
  for (const value of [env.APP_URL, url])
    if (value && URL.canParse(value)) appOrigins.add(new URL(value).origin);
}

export default {
  fetch(request: Request, env: Environment, invocation: Invocation) {
    bind(env, request.url);
    const origin =
      env.PREVIEW_ALIASES === "true"
        ? previewAppUrl(request.url, env.APP_URL)
        : undefined;
    const response = runWithAppUrl(origin, () =>
      runWithInvocationDatabase(
        () => handler.fetch(request, env, invocation),
        env.HYPERDRIVE?.connectionString,
      ),
    );
    // Workers cancels a request when its caller disconnects. Let a write that
    // already started reach its result instead of stopping halfway.
    invocation.waitUntil(response.catch(() => {}));
    return response;
  },
  // The Cron Trigger runs the same authenticated route an external scheduler calls.
  async scheduled(_event: unknown, env: Environment, invocation: Invocation) {
    bind(env);
    const response = await runWithInvocationDatabase(
      () =>
        handler.fetch(
          new Request(new URL("/api/integrations/cron", env.APP_URL), {
            headers: { authorization: `Bearer ${env.CRON_SECRET}` },
          }),
          env,
          invocation,
        ),
      env.HYPERDRIVE?.connectionString,
    );
    if (!response.ok) throw new Error(`INTEGRATION_CRON_${response.status}`);
  },
};
