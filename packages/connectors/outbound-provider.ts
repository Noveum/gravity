import { z } from "zod";
import { DomainError } from "../core/policy";
import {
  decodeMailHeader,
  type ProviderFetch,
  providerJson,
  unipileJson,
} from "./providers";
import type { ProviderCredentials } from "./types";
import { unipileV1Json } from "./unipile-v1";

export const gmailSendScope = "https://www.googleapis.com/auth/gmail.send";
export interface OutboundMessage {
  channel: "gmail" | "linkedin";
  accountId: string;
  from: string;
  recipient: string;
  subject: string;
  body: string;
  threadId?: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
}
export function emailDraft(draft: string) {
  const match = /^Subject: ([^\r\n]{1,200})\r?\n\r?\n([\s\S]+)$/i.exec(draft);
  if (
    !match?.[2].trim() ||
    [...match[1]].some(
      (value) => value.charCodeAt(0) < 32 || value.charCodeAt(0) === 127,
    )
  )
    throw new DomainError("EMAIL_SUBJECT_REQUIRED", 422);
  return { subject: match[1], body: match[2] };
}
export function mimeMessage(message: OutboundMessage) {
  const from = z.email().parse(message.from);
  const to = z.email().parse(message.recipient);
  const words: string[] = [];
  let word = "";
  for (const character of message.subject) {
    if (Buffer.byteLength(word + character, "utf8") > 42) {
      words.push(word);
      word = "";
    }
    word += character;
  }
  if (word) words.push(word);
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${words.map((value) => `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`).join("\r\n ")}`,
    `Message-ID: <${message.messageId}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  for (const [name, value] of [
    ["In-Reply-To", message.inReplyTo],
    ["References", message.references],
  ]) {
    if (!value) continue;
    if (
      [...value].some((character) =>
        [0, 10, 13].includes(character.charCodeAt(0)),
      )
    )
      throw new DomainError("PROVIDER_RESPONSE_INVALID", 502);
    headers.push(`${name}: ${value}`);
  }
  // Fold base64 to RFC 2045 line length. Header values cannot create additional recipients.
  const encoded = Buffer.from(message.body.replace(/\r?\n/g, "\r\n")).toString(
    "base64",
  );
  return Buffer.from(
    `${headers.join("\r\n")}\r\n\r\n${encoded.match(/.{1,76}/g)?.join("\r\n") ?? ""}\r\n`,
  ).toString("base64url");
}
const gmailHeaders = (credentials: ProviderCredentials) => ({
  Authorization: `Bearer ${credentials.accessToken}`,
});
export async function prepareReply(
  message: OutboundMessage,
  credentials: ProviderCredentials,
  transport: ProviderFetch,
) {
  if (message.channel !== "gmail" || !message.threadId) return message;
  const thread = z
    .object({
      messages: z.array(
        z.object({
          payload: z.object({
            headers: z.array(z.object({ name: z.string(), value: z.string() })),
          }),
        }),
      ),
    })
    .parse(
      await providerJson(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(message.threadId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=References`,
        { headers: gmailHeaders(credentials) },
        transport,
      ),
    );
  const headers = thread.messages.at(-1)?.payload.headers;
  const header = (name: string) =>
    headers?.find((item) => item.name.toLowerCase() === name)?.value;
  const normalize = (value: string) => value.replace(/^(re:\s*)+/i, "").trim();
  if (
    !header("message-id") ||
    normalize(decodeMailHeader(header("subject") ?? "")) !==
      normalize(message.subject)
  )
    throw new DomainError("THREAD_SUBJECT_MISMATCH", 422);
  return {
    ...message,
    inReplyTo: header("message-id"),
    references: [header("references"), header("message-id")]
      .filter(Boolean)
      .join(" "),
  };
}
export async function resolveLinkedInRecipient(
  accountId: string,
  profile: string,
  credentials: ProviderCredentials,
  transport: ProviderFetch,
) {
  const url = new URL(profile);
  if (
    url.protocol !== "https:" ||
    !["linkedin.com", "www.linkedin.com"].includes(url.hostname) ||
    !/^\/in\/[^/]+\/?$/.test(url.pathname)
  )
    throw new DomainError("LINKEDIN_PROFILE_REQUIRED", 422);
  const identifier = decodeURIComponent(url.pathname.split("/")[2]);
  if (credentials.apiVersion === "v1") {
    const query = new URLSearchParams({
      account_id: accountId,
      linkedin_api: "classic",
    });
    const user = z
      .object({
        provider_id: z.string().min(1),
        public_identifier: z.string().optional(),
      })
      .parse(
        await unipileV1Json(
          credentials,
          `/users/${encodeURIComponent(identifier)}?${query}`,
          {},
          transport,
        ),
      );
    if (
      user.public_identifier &&
      user.public_identifier.toLowerCase() !== identifier.toLowerCase()
    )
      throw new DomainError("RECIPIENT_MISMATCH", 422);
    return user.provider_id;
  }
  const user = z
    .object({ id: z.string().min(1), public_identifier: z.string().optional() })
    .parse(
      await unipileJson(
        credentials.apiKey ?? "",
        `/${encodeURIComponent(accountId)}/users/${encodeURIComponent(identifier)}?variant=linkedin_classic`,
        {},
        transport,
      ),
    );
  if (
    user.public_identifier &&
    user.public_identifier.toLowerCase() !== identifier.toLowerCase()
  )
    throw new DomainError("RECIPIENT_MISMATCH", 422);
  return user.id;
}
export async function dispatchMessage(
  message: OutboundMessage,
  credentials: ProviderCredentials,
  transport: ProviderFetch,
) {
  if (message.channel === "gmail") {
    const result = z
      .object({ id: z.string().min(1), threadId: z.string().min(1) })
      .parse(
        await providerJson(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          {
            method: "POST",
            headers: {
              ...gmailHeaders(credentials),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              raw: mimeMessage(message),
              ...(message.threadId ? { threadId: message.threadId } : {}),
            }),
          },
          transport,
        ),
      );
    return { externalMessageId: result.id, externalThreadId: result.threadId };
  }
  const base = `/${encodeURIComponent(message.accountId)}`;
  if (credentials.apiVersion === "v1") {
    if (message.threadId) {
      try {
        const chat = z
          .object({ id: z.string(), account_id: z.string() })
          .parse(
            await unipileV1Json(
              credentials,
              `/chats/${encodeURIComponent(message.threadId)}`,
              {},
              transport,
            ),
          );
        if (
          chat.id !== message.threadId ||
          chat.account_id !== message.accountId
        )
          throw new DomainError("RECIPIENT_MISMATCH", 422);
      } catch (error) {
        throw Object.assign(
          error instanceof DomainError
            ? error
            : new DomainError("PROVIDER_RESPONSE_INVALID", 502),
          { dispatchNotAttempted: true },
        );
      }
    }
    const body = new FormData();
    body.set("text", message.body);
    body.set("account_id", message.accountId);
    if (!message.threadId) body.append("attendees_ids", message.recipient);
    const result = z
      .object({
        message_id: z.string().min(1),
        chat_id: z.string().min(1).optional(),
      })
      .parse(
        await unipileV1Json(
          credentials,
          message.threadId
            ? `/chats/${encodeURIComponent(message.threadId)}/messages`
            : "/chats",
          { method: "POST", body },
          transport,
        ),
      );
    const externalThreadId = message.threadId ?? result.chat_id;
    if (!externalThreadId)
      throw new DomainError("PROVIDER_RESPONSE_INVALID", 502);
    return { externalMessageId: result.message_id, externalThreadId };
  }
  const result = z
    .object({
      message_id: z.string().min(1),
      chat_id: z.string().min(1).optional(),
    })
    .parse(
      await unipileJson(
        credentials.apiKey ?? "",
        message.threadId
          ? `${base}/chats/${encodeURIComponent(message.threadId)}/messages/send`
          : `${base}/inboxes/CLASSIC/chats/send`,
        {
          method: "POST",
          body: JSON.stringify({
            text: message.body,
            ...(!message.threadId ? { users_ids: message.recipient } : {}),
          }),
        },
        transport,
      ),
    );
  const externalThreadId = message.threadId ?? result.chat_id;
  if (!externalThreadId)
    throw new DomainError("PROVIDER_RESPONSE_INVALID", 502);
  return { externalMessageId: result.message_id, externalThreadId };
}
