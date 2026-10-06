import { z } from "zod";
import { DomainError } from "../core/policy";
import type { ProviderFetch } from "./providers";
import type { ProviderCredentials } from "./types";
import { unipileV1Json } from "./unipile-v1";

const webhook = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  request_url: z.string(),
  enabled: z.boolean(),
  format: z.string(),
  account_ids: z.array(z.object({ id: z.string() })),
  headers: z.array(z.object({ key: z.string(), value: z.string() })),
  events: z.array(z.string()).optional(),
});
export async function registerUnipileV1Webhooks(
  credentials: ProviderCredentials,
  configurationId: string,
  accountId: string,
  requestUrl: string,
  secret: string,
  transport: ProviderFetch,
  enabled = true,
) {
  const target = new URL(requestUrl);
  if (target.protocol !== "https:" || target.username || target.password)
    throw new DomainError("CONNECTOR_NOT_CONFIGURED", 503);
  const existing: z.infer<typeof webhook>[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 4; page++) {
    const query = new URLSearchParams({ limit: "250" });
    if (cursor) query.set("cursor", cursor);
    const list = z
      .object({ items: z.array(webhook), cursor: z.string().nullish() })
      .parse(
        await unipileV1Json(credentials, `/webhooks?${query}`, {}, transport),
      );
    existing.push(...list.items);
    cursor = list.cursor ?? undefined;
    if (!cursor) break;
  }
  if (cursor) throw new DomainError("PROVIDER_RESPONSE_INVALID", 502);
  const result: Record<string, string> = {};
  const sources = {
    messaging: ["message_received"],
    account_status: [
      "ok",
      "credentials",
      "error",
      "stopped",
      "deleted",
      "reconnected",
      "permissions",
    ],
  };
  for (const [source, events] of Object.entries(sources)) {
    const name = `Gravity:${configurationId}:${accountId}:${source}`;
    const match = existing.find(
      (value) =>
        value.name === name &&
        value.request_url === requestUrl &&
        value.enabled === enabled &&
        value.format === "json" &&
        value.account_ids.length === 1 &&
        value.account_ids[0]?.id === accountId &&
        value.headers.some(
          (header) =>
            header.key.toLowerCase() === "authorization" &&
            header.value === `Bearer ${secret}`,
        ) &&
        events.every((event) => value.events?.includes(event)),
    );
    if (match) {
      result[source] = match.id;
      continue;
    }
    const created = z.object({ webhook_id: z.string().min(1) }).parse(
      await unipileV1Json(
        credentials,
        "/webhooks",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            request_url: requestUrl,
            source,
            events,
            format: "json",
            enabled,
            account_ids: [accountId],
            headers: [{ key: "Authorization", value: `Bearer ${secret}` }],
          }),
        },
        transport,
      ),
    );
    result[source] = created.webhook_id;
  }
  return z
    .object({ messaging: z.string(), account_status: z.string() })
    .parse(result);
}

export async function removeUnipileV1Webhooks(
  credentials: ProviderCredentials,
  configurationId: string,
  secret: string,
  knownIds: string[],
  transport: ProviderFetch,
) {
  const ids = new Set(knownIds);
  let pending = false;
  let cursor: string | undefined;
  try {
    for (let page = 0; page < 4; page++) {
      const query = new URLSearchParams({ limit: "250" });
      if (cursor) query.set("cursor", cursor);
      const list = z
        .object({ items: z.array(webhook), cursor: z.string().nullish() })
        .parse(
          await unipileV1Json(credentials, `/webhooks?${query}`, {}, transport),
        );
      for (const hook of list.items) {
        if (
          hook.name?.startsWith(`Gravity:${configurationId}:`) &&
          hook.headers.some(
            (header) =>
              header.key.toLowerCase() === "authorization" &&
              header.value === `Bearer ${secret}`,
          )
        )
          ids.add(hook.id);
      }
      cursor = list.cursor ?? undefined;
      if (!cursor) break;
    }
    pending ||= !!cursor;
  } catch {
    pending = true;
  }
  const values = [...ids];
  for (let start = 0; start < Math.min(values.length, 20); start += 4) {
    const deleted = await Promise.allSettled(
      values.slice(start, start + 4).map(async (id) => {
        try {
          await unipileV1Json(
            credentials,
            `/webhooks/${encodeURIComponent(id)}`,
            { method: "DELETE" },
            transport,
          );
        } catch (error) {
          if ((error as { providerStatus?: number }).providerStatus !== 404)
            throw error;
        }
      }),
    );
    pending ||= deleted.some((result) => result.status === "rejected");
  }
  return pending || values.length > 20;
}
