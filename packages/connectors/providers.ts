import { z } from "zod";
import { DomainError } from "../core/policy";
import t from "../i18n/translations/en.json";
import type {
  ImportRecord,
  IntegrationProvider,
  ProviderCredentials,
  ProviderPage,
} from "./types";

export type ProviderFetch = typeof fetch;
export async function providerJson(
  url: string,
  init: RequestInit = {},
  transport: ProviderFetch = fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await transport(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new DomainError("PROVIDER_UNAVAILABLE", 502);
  }
  if (!response.ok)
    throw Object.assign(
      new DomainError(
        response.status === 401 || response.status === 400
          ? "RECONNECT_REQUIRED"
          : response.status === 403
            ? "PROVIDER_PERMISSION"
            : response.status === 429
              ? "PROVIDER_RATE_LIMITED"
              : "PROVIDER_UNAVAILABLE",
        response.status === 429 ? 429 : 502,
      ),
      { providerStatus: response.status },
    );
  // Never pass a provider's raw error or credentials into logs or HTTP responses.
  const reader = response.body?.getReader();
  if (!reader) throw new DomainError("PROVIDER_RESPONSE_INVALID", 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4000000) {
        await reader.cancel();
        throw new DomainError("PROVIDER_RESPONSE_INVALID", 502);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("PROVIDER_UNAVAILABLE", 502);
  } finally {
    reader.releaseLock();
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new DomainError("PROVIDER_RESPONSE_INVALID", 502);
  }
}
export function googleConfig() {
  const clientId =
    process.env.GOOGLE_INTEGRATION_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    process.env.GOOGLE_INTEGRATION_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new DomainError("CONNECTOR_NOT_CONFIGURED", 503);
  return { clientId, clientSecret };
}
export const googleScopes = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  calendar: "https://www.googleapis.com/auth/calendar.events.readonly",
};
const googleToken = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});
export async function exchangeGoogle(
  code: string,
  verifier: string,
  redirectUri: string,
  transport: ProviderFetch = fetch,
) {
  const config = googleConfig();
  const token = googleToken.parse(
    await providerJson(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
        }),
      },
      transport,
    ),
  );
  const identity = z
    .object({ sub: z.string(), email: z.email(), email_verified: z.boolean() })
    .parse(
      await providerJson(
        "https://openidconnect.googleapis.com/v1/userinfo",
        { headers: { Authorization: `Bearer ${token.access_token}` } },
        transport,
      ),
    );
  if (!identity.email_verified || !token.refresh_token)
    throw new DomainError("RECONNECT_REQUIRED", 422);
  return {
    identity,
    scopes: (token.scope ?? "").split(" "),
    credentials: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    },
  };
}
export async function refreshGoogle(
  credentials: ProviderCredentials,
  transport: ProviderFetch = fetch,
) {
  if (
    credentials.accessToken &&
    (credentials.expiresAt ?? 0) > Date.now() + 60000
  )
    return credentials;
  if (!credentials.refreshToken)
    throw new DomainError("RECONNECT_REQUIRED", 422);
  const config = googleConfig();
  const token = googleToken.parse(
    await providerJson(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
        }),
      },
      transport,
    ),
  );
  return {
    ...credentials,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? credentials.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
}
export const unipileJson = (
  apiKey: string,
  path: string,
  init: RequestInit = {},
  transport: ProviderFetch = fetch,
) => {
  if (!apiKey) throw new DomainError("CONNECTOR_NOT_CONFIGURED", 503);
  return providerJson(
    `https://api.unipile.com/v2${path}`,
    {
      ...init,
      headers: {
        ...init.headers,
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
    },
    transport,
  );
};
export async function hostedLinkedIn(
  apiKey: string,
  state: string,
  redirectUri: string,
  accountId?: string,
  transport: ProviderFetch = fetch,
) {
  const result = z.object({ link: z.url() }).parse(
    await unipileJson(
      apiKey,
      "/auth/link",
      {
        method: "POST",
        body: JSON.stringify({
          ...(accountId
            ? { account_id: accountId }
            : { providers: ["linkedin"] }),
          redirect_uri: redirectUri,
          state,
          expires_on: new Date(Date.now() + 600000).toISOString(),
        }),
      },
      transport,
    ),
  );
  const url = new URL(result.link);
  if (url.protocol !== "https:" || url.hostname !== "auth.unipile.com")
    throw new DomainError("PROVIDER_RESPONSE_INVALID", 502);
  return result.link;
}
export async function firefliesQuery(
  apiKey: string,
  query: string,
  variables: Record<string, unknown> = {},
  transport: ProviderFetch = fetch,
) {
  const result = z
    .object({
      data: z.record(z.string(), z.unknown()).nullish(),
      errors: z.array(z.unknown()).optional(),
    })
    .parse(
      await providerJson(
        "https://api.fireflies.ai/graphql",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query, variables }),
        },
        transport,
      ),
    );
  if (result.errors?.length || !result.data)
    throw new DomainError("PROVIDER_PERMISSION", 422);
  return result.data;
}
export async function firefliesIdentity(
  apiKey: string,
  transport: ProviderFetch = fetch,
) {
  const data = await firefliesQuery(
    apiKey,
    "query { user { user_id email name } }",
    {},
    transport,
  );
  return z
    .object({ user_id: z.string(), email: z.email(), name: z.string() })
    .parse(data.user);
}
const addresses = (value: string) =>
  [
    ...value.matchAll(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi),
  ].map((m) => m[0].toLowerCase());
const clip = (value: unknown, limit = 100000) =>
  typeof value === "string" ? value.slice(0, limit) : "";
interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
}
const gmailText = (part: GmailPart): string =>
  part.mimeType === "text/plain" && part.body?.data
    ? Buffer.from(part.body.data, "base64url").toString("utf8")
    : (part.parts ?? []).map(gmailText).filter(Boolean).join("\n");
export function normalizeGmail(
  value: unknown,
  selfEmail: string,
): ImportRecord | null {
  const mail = z
    .object({
      id: z.string(),
      threadId: z.string(),
      internalDate: z.string(),
      labelIds: z.array(z.string()).optional(),
      snippet: z.string().optional(),
      payload: z.custom<GmailPart>((v) => typeof v === "object" && v !== null),
    })
    .parse(value);
  if (
    mail.labelIds?.some((label) => ["TRASH", "SPAM", "DRAFT"].includes(label))
  )
    return null;
  const header = (name: string) =>
    mail.payload.headers?.find((h) => h.name.toLowerCase() === name)?.value ??
    "";
  const from = addresses(header("from"));
  const outgoing =
    mail.labelIds?.includes("SENT") || from.includes(selfEmail.toLowerCase());
  return {
    externalId: mail.id,
    threadId: mail.threadId,
    kind: "message",
    title: clip(header("subject"), 1000),
    body: clip(gmailText(mail.payload) || mail.snippet),
    occurredAt: new Date(Number(mail.internalDate)).toISOString(),
    direction: outgoing ? "outbound" : "inbound",
    participants: [
      ...new Set([
        ...from,
        ...addresses(header("to")),
        ...addresses(header("cc")),
      ]),
    ]
      .filter((email) => email !== selfEmail.toLowerCase())
      .slice(0, 100),
  };
}
export function normalizeCalendar(value: unknown): ImportRecord {
  const event = z
    .object({
      id: z.string(),
      summary: z.string().optional(),
      description: z.string().optional(),
      status: z.string().optional(),
      start: z
        .object({
          dateTime: z.string().optional(),
          date: z.string().optional(),
        })
        .optional(),
      updated: z.string().optional(),
      attendees: z
        .array(
          z.object({
            email: z.string().optional(),
            self: z.boolean().optional(),
          }),
        )
        .optional(),
    })
    .parse(value);
  return {
    externalId: event.id,
    kind: "meeting",
    title: clip(event.summary || t.importCalendarTitle, 1000),
    body: clip(event.description),
    occurredAt: new Date(
      event.start?.dateTime ?? event.start?.date ?? event.updated ?? Date.now(),
    ).toISOString(),
    canceled: event.status === "cancelled",
    participants: (event.attendees ?? [])
      .filter((a) => !a.self)
      .flatMap((a) => (a.email ? [a.email.toLowerCase()] : []))
      .slice(0, 100),
  };
}
export function normalizeFireflies(value: unknown): ImportRecord {
  const note = z
    .object({
      id: z.string(),
      title: z.string().nullish(),
      date: z.number(),
      participants: z.array(z.string()).nullish(),
      summary: z
        .object({
          overview: z.string().nullish(),
          action_items: z.string().nullish(),
        })
        .nullish(),
    })
    .parse(value);
  return {
    externalId: note.id,
    kind: "meeting",
    title: clip(note.title || t.importMeetingTitle, 1000),
    body: clip(note.summary?.overview),
    occurredAt: new Date(note.date).toISOString(),
    participants: (note.participants ?? []).flatMap(addresses).slice(0, 100),
    proposedCommitment: clip(note.summary?.action_items, 20000),
  };
}
export function normalizeLinkedIn(value: unknown): ImportRecord | null {
  const message = z
    .object({
      id: z.string(),
      chat_id: z.string(),
      is_sender: z.boolean(),
      is_event: z.boolean(),
      text: z.string().optional(),
      timestamp: z.iso.datetime(),
    })
    .parse(value);
  if (message.is_event) return null;
  // V2 message IDs are only guaranteed unique within their chat.
  return {
    externalId: `${message.chat_id}:${message.id}`,
    threadId: message.chat_id,
    kind: "message",
    title: t.importLinkedInTitle,
    body: clip(message.text),
    occurredAt: message.timestamp,
    direction: message.is_sender ? "outbound" : "inbound",
    participants: [],
  };
}
const list = z.object({
  data: z.array(z.unknown()),
  next_cursor: z.string().nullish(),
});
export async function readProviderPage(
  provider: IntegrationProvider,
  credentials: ProviderCredentials,
  accountId: string,
  selfEmail: string,
  cursor: Record<string, unknown>,
  transport: ProviderFetch = fetch,
): Promise<ProviderPage> {
  const records: ImportRecord[] = [];
  const headers = { Authorization: `Bearer ${credentials.accessToken}` };
  if (provider === "gmail") {
    const baseline =
      typeof cursor.historyId === "string" ? cursor.historyId : undefined;
    const partial =
      cursor.mode === "history" || (!!baseline && cursor.mode !== "initial");
    const path = new URL(
      partial
        ? "https://gmail.googleapis.com/gmail/v1/users/me/history"
        : "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    );
    path.searchParams.set("maxResults", "20");
    if (partial) {
      path.searchParams.set("startHistoryId", baseline ?? "");
      path.searchParams.set("historyTypes", "messageAdded");
    } else path.searchParams.set("q", "newer_than:30d -in:spam -in:trash");
    if (typeof cursor.pageToken === "string")
      path.searchParams.set("pageToken", cursor.pageToken);
    let historyId = baseline;
    if (!historyId) {
      const profile = z
        .object({ historyId: z.string() })
        .parse(
          await providerJson(
            "https://gmail.googleapis.com/gmail/v1/users/me/profile",
            { headers },
            transport,
          ),
        );
      historyId = profile.historyId;
    }
    let result: unknown;
    try {
      result = await providerJson(path.href, { headers }, transport);
    } catch (error) {
      if (
        partial &&
        error instanceof DomainError &&
        (error as DomainError & { providerStatus?: number }).providerStatus ===
          404
      ) {
        return { records: [], cursor: { mode: "initial" }, more: true };
      }
      throw error;
    }
    const page = z
      .object({
        messages: z.array(z.object({ id: z.string() })).optional(),
        history: z
          .array(
            z.object({
              messagesAdded: z
                .array(z.object({ message: z.object({ id: z.string() }) }))
                .optional(),
            }),
          )
          .optional(),
        nextPageToken: z.string().optional(),
        historyId: z.string().optional(),
      })
      .parse(result);
    const ids = [
      ...new Set(
        (partial
          ? (page.history?.flatMap((h) =>
              (h.messagesAdded ?? []).map((m) => m.message),
            ) ?? [])
          : (page.messages ?? [])
        ).map((m) => m.id),
      ),
    ];
    // Bound concurrency and batch size for serverless deadlines. A failed batch
    // leaves the checkpoint unchanged, so retries can safely deduplicate it.
    for (let offset = 0; offset < ids.length; offset += 5) {
      const batch = await Promise.all(
        ids.slice(offset, offset + 5).map(async (id) => {
          try {
            const record = normalizeGmail(
              await providerJson(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
                { headers },
                transport,
              ),
              selfEmail,
            );
            return record;
          } catch (error) {
            if (
              !(
                error instanceof DomainError &&
                (error as DomainError & { providerStatus?: number })
                  .providerStatus === 404
              )
            )
              throw error;
          }
          return null;
        }),
      );
      for (const record of batch) if (record) records.push(record);
    }
    return {
      records,
      cursor: page.nextPageToken
        ? {
            mode: partial ? "history" : "initial",
            historyId,
            pageToken: page.nextPageToken,
          }
        : { historyId: partial ? (page.historyId ?? historyId) : historyId },
      more: !!page.nextPageToken,
    };
  }
  if (provider === "calendar") {
    const url = new URL(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    );
    url.searchParams.set("maxResults", "100");
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    if (typeof cursor.syncToken === "string")
      url.searchParams.set("syncToken", cursor.syncToken);
    else
      url.searchParams.set(
        "timeMin",
        typeof cursor.timeMin === "string"
          ? cursor.timeMin
          : new Date(Date.now() - 30 * 86400000).toISOString(),
      );
    if (typeof cursor.pageToken === "string")
      url.searchParams.set("pageToken", cursor.pageToken);
    let result: unknown;
    try {
      result = await providerJson(url.href, { headers }, transport);
    } catch (error) {
      if (
        cursor.syncToken &&
        error instanceof DomainError &&
        (error as DomainError & { providerStatus?: number }).providerStatus ===
          410
      )
        return { records: [], cursor: {}, more: true };
      throw error;
    }
    const page = z
      .object({
        items: z.array(z.unknown()).optional(),
        nextPageToken: z.string().optional(),
        nextSyncToken: z.string().optional(),
      })
      .parse(result);
    return {
      records: (page.items ?? []).map(normalizeCalendar),
      cursor: page.nextPageToken
        ? {
            ...cursor,
            timeMin: url.searchParams.get("timeMin"),
            pageToken: page.nextPageToken,
          }
        : { syncToken: page.nextSyncToken },
      more: !!page.nextPageToken,
    };
  }
  if (provider === "fireflies") {
    if (!credentials.apiKey) throw new DomainError("RECONNECT_REQUIRED", 422);
    const skip = typeof cursor.skip === "number" ? cursor.skip : 0;
    const result = await firefliesQuery(
      credentials.apiKey,
      "query($user: String, $skip: Int) { transcripts(user_id: $user, limit: 20, skip: $skip) { id title date participants summary { overview action_items } } }",
      { user: accountId, skip },
      transport,
    );
    const notes = z.array(z.unknown()).parse(result.transcripts);
    return {
      records: notes.map(normalizeFireflies),
      cursor: notes.length === 20 ? { skip: skip + 20 } : {},
      more: notes.length === 20,
    };
  }
  // A bounded page per request; subsequent calls resume an unfinished chat history.
  let chats = z.array(z.object({ id: z.string() })).parse(cursor.chats ?? []);
  let nextChatCursor =
    typeof cursor.nextChatCursor === "string"
      ? cursor.nextChatCursor
      : undefined;
  if (!chats.length) {
    const page = list.parse(
      await unipileJson(
        credentials.apiKey ?? "",
        `/${encodeURIComponent(accountId)}/chats?limit=10${typeof cursor.chatCursor === "string" ? `&cursor=${encodeURIComponent(cursor.chatCursor)}` : ""}`,
        {},
        transport,
      ),
    );
    chats = z.array(z.object({ id: z.string() })).parse(page.data);
    nextChatCursor = page.next_cursor ?? undefined;
  }
  if (!chats.length) return { records: [], cursor: {}, more: false };
  const chat = chats[0];
  const page = list.parse(
    await unipileJson(
      credentials.apiKey ?? "",
      `/${encodeURIComponent(accountId)}/chats/${encodeURIComponent(chat.id)}/messages?limit=50${typeof cursor.messageCursor === "string" ? `&cursor=${encodeURIComponent(cursor.messageCursor)}` : ""}`,
      {},
      transport,
    ),
  );
  for (const message of page.data) {
    const record = normalizeLinkedIn(message);
    if (record) records.push(record);
  }
  const remaining = page.next_cursor ? chats : chats.slice(1);
  return {
    records,
    cursor: remaining.length
      ? {
          chats: remaining,
          nextChatCursor,
          ...(page.next_cursor ? { messageCursor: page.next_cursor } : {}),
        }
      : nextChatCursor
        ? { chatCursor: nextChatCursor }
        : {},
    more: remaining.length > 0 || !!nextChatCursor,
  };
}
