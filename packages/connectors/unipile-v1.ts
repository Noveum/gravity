import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DomainError } from "../core/policy";
import {
  normalizeLinkedIn,
  type ProviderFetch,
  providerJson,
} from "./providers";
import type { ProviderCredentials, ProviderPage } from "./types";

export const unipileDsn = z
  .string()
  .trim()
  .max(200)
  .transform((value, context) => {
    const match =
      /^(?:https:\/\/)?(api[0-9]+\.unipile\.com):([0-9]{1,5})\/?$/.exec(value);
    const port = Number(match?.[2]);
    if (!match || port < 1 || port > 65535) {
      context.addIssue({ code: "custom", message: "UNIPILE_DSN_INVALID" });
      return z.NEVER;
    }
    return `${match[1]}:${port}`;
  });
export async function unipileV1Json(
  credentials: ProviderCredentials,
  path: string,
  init: RequestInit = {},
  transport: ProviderFetch = fetch,
) {
  if (!credentials.apiKey || !credentials.dsn)
    throw new DomainError("CONNECTOR_NOT_CONFIGURED", 503);
  const dsn = unipileDsn.parse(credentials.dsn);
  const [host, port] = dsn.split(":");
  const url = new URL(`https://${host}/api/v1${path}`);
  url.searchParams.set("port", port ?? "");
  const headers = new Headers(init.headers);
  headers.set("X-API-KEY", credentials.apiKey);
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  try {
    return await providerJson(url.href, { ...init, headers }, transport);
  } catch (error) {
    const status = (error as { providerStatus?: number }).providerStatus;
    if (status === 401)
      throw Object.assign(new DomainError("UNIPILE_KEY_INVALID", 422), {
        providerStatus: status,
      });
    if (status === 400)
      throw Object.assign(new DomainError("UNIPILE_REQUEST_INVALID", 502), {
        providerStatus: status,
      });
    throw error;
  }
}
export const unipileV1Account = z.object({
  id: z.string().min(1),
  type: z.literal("LINKEDIN"),
  name: z.string(),
  sources: z.array(z.object({ id: z.string(), status: z.string() })),
});
export function unipileV1Status(account: z.infer<typeof unipileV1Account>) {
  const messaging = account.sources.find(
    (source) => source.id === `${account.id}_MESSAGING`,
  );
  return messaging?.status ?? "STOPPED";
}
export function verifyUnipileV1Authorization(
  header: string | null,
  secret: string,
) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(header ?? "");
  return (
    !!secret &&
    expected.length === provided.length &&
    timingSafeEqual(expected, provided)
  );
}
export function unipileV1Envelope(input: unknown) {
  const status = z
    .object({
      AccountStatus: z.object({
        account_id: z.string(),
        account_type: z.literal("LINKEDIN"),
        message: z.string(),
      }),
    })
    .safeParse(input);
  if (status.success) {
    const value = status.data.AccountStatus;
    const types: Record<string, string> = {
      OK: "account.status.running",
      RECONNECTED: "account.status.running",
      CREDENTIALS: "account.status.disconnected",
      ERROR: "account.status.errored",
      STOPPED: "account.status.errored",
      PERMISSIONS: "account.status.permission",
      DELETED: "account.remove",
    };
    return {
      id: `${value.account_id}:${value.message}`,
      account_id: value.account_id,
      account_provider: "linkedin",
      type: types[value.message] ?? "ignored",
      payload: {},
    };
  }
  const value = z
    .object({
      event: z.string().optional(),
      account_id: z.string(),
      account_type: z.literal("LINKEDIN"),
      message_id: z.string(),
      chat_id: z.string(),
      message: z.string().nullish(),
      timestamp: z.iso.datetime(),
      is_sender: z.union([z.literal(0), z.literal(1), z.boolean()]).optional(),
      is_event: z.union([z.literal(0), z.literal(1), z.boolean()]).optional(),
      account_info: z.object({ user_id: z.string() }).optional(),
      sender: z.object({ attendee_provider_id: z.string() }).optional(),
    })
    .parse(input);
  if (value.event && value.event !== "message_received")
    return {
      id: value.message_id,
      account_id: value.account_id,
      account_provider: "linkedin",
      type: "ignored",
      payload: {},
    };
  if (
    value.is_sender === undefined &&
    (!value.account_info?.user_id || !value.sender?.attendee_provider_id)
  )
    throw new DomainError("PROVIDER_RESPONSE_INVALID", 422);
  return {
    id: `${value.chat_id}:${value.message_id}`,
    account_id: value.account_id,
    account_provider: "linkedin",
    type: value.is_event ? "ignored" : "message.new",
    payload: {
      id: value.message_id,
      chat_id: value.chat_id,
      text: value.message ?? "",
      timestamp: value.timestamp,
      is_event: false,
      is_sender:
        value.is_sender === undefined
          ? value.account_info?.user_id === value.sender?.attendee_provider_id
          : !!value.is_sender,
    },
  };
}
export function normalizeLinkedInV1(
  value: unknown,
  accountId: string,
  chatId?: string,
) {
  const message = z
    .object({
      id: z.string(),
      account_id: z.string(),
      chat_id: z.string(),
      is_sender: z.union([z.literal(0), z.literal(1), z.boolean()]),
      is_event: z.union([z.literal(0), z.literal(1), z.boolean()]),
      text: z.string().nullish(),
      timestamp: z.iso.datetime(),
    })
    .parse(value);
  if (
    message.account_id !== accountId ||
    (chatId && message.chat_id !== chatId)
  )
    throw new DomainError("PROVIDER_RESPONSE_INVALID", 502);
  return normalizeLinkedIn({
    ...message,
    is_sender: !!message.is_sender,
    is_event: !!message.is_event,
    text: message.text ?? "",
  });
}
const list = z.object({
  items: z.array(z.unknown()),
  cursor: z.string().nullish(),
});
export async function readUnipileV1Page(
  credentials: ProviderCredentials,
  accountId: string,
  cursor: Record<string, unknown>,
  transport: ProviderFetch,
): Promise<ProviderPage> {
  let chats = z
    .array(z.object({ id: z.string(), account_id: z.string() }))
    .parse(cursor.chats ?? []);
  let nextChatCursor =
    typeof cursor.nextChatCursor === "string"
      ? cursor.nextChatCursor
      : undefined;
  if (!chats.length) {
    const query = new URLSearchParams({ account_id: accountId, limit: "10" });
    if (typeof cursor.chatCursor === "string")
      query.set("cursor", cursor.chatCursor);
    const page = list.parse(
      await unipileV1Json(credentials, `/chats?${query}`, {}, transport),
    );
    chats = z
      .array(z.object({ id: z.string(), account_id: z.string() }))
      .parse(page.items);
    nextChatCursor = page.cursor ?? undefined;
  }
  if (chats.some((chat) => chat.account_id !== accountId))
    throw new DomainError("PROVIDER_RESPONSE_INVALID", 502);
  const chat = chats[0];
  if (!chat)
    return {
      records: [],
      cursor: nextChatCursor ? { chatCursor: nextChatCursor } : {},
      more: !!nextChatCursor,
    };
  const query = new URLSearchParams({ limit: "50" });
  if (typeof cursor.messageCursor === "string")
    query.set("cursor", cursor.messageCursor);
  const page = list.parse(
    await unipileV1Json(
      credentials,
      `/chats/${encodeURIComponent(chat.id)}/messages?${query}`,
      {},
      transport,
    ),
  );
  const records = page.items.flatMap((message) => {
    const record = normalizeLinkedInV1(message, accountId, chat.id);
    return record ? [record] : [];
  });
  const remaining = page.cursor ? chats : chats.slice(1);
  return {
    records,
    cursor: remaining.length
      ? {
          chats: remaining,
          nextChatCursor,
          ...(page.cursor ? { messageCursor: page.cursor } : {}),
        }
      : nextChatCursor
        ? { chatCursor: nextChatCursor }
        : {},
    more: remaining.length > 0 || !!nextChatCursor,
  };
}
