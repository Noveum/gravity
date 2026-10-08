"use client";
import { preciseDateLabel } from "@crm/core/calendar";
import type { ClientContext, JsonValue } from "@crm/core/dto";
import type { MessageHistoryService } from "@crm/core/message-history";
import t from "@crm/i18n/translations/en.json";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Mail,
  MessageSquare,
  MessagesSquare,
} from "lucide-react";
import { useRef, useState } from "react";
import { errorText, label, requestJson } from "../client-api";
import { splitImportedConversation } from "./imported-conversation";

function paragraphs(body: string) {
  let offset = 0;
  return body.split(/\n\s*\n/).map((text) => {
    const paragraph = { text, offset };
    offset += text.length + 1;
    return paragraph;
  });
}

export function ConversationHistory({
  context,
  person,
  timeZone,
}: {
  context?: ClientContext;
  person?: ClientContext["person"];
  timeZone: string;
}) {
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("");
  const [all, setAll] = useState(false);
  const scope = context ? `${context.relationship.id}:${context.asOf}` : "";
  const currentScope = useRef(scope);
  currentScope.current = scope;
  type Page = JsonValue<Awaited<ReturnType<MessageHistoryService["page"]>>>;
  const [historyPage, setHistoryPage] = useState<{
    scope: string;
    page: Page;
  } | null>(null);
  const [loadingScope, setLoadingScope] = useState("");
  const loading = !!scope && loadingScope === scope;
  const [historyError, setHistoryError] = useState({ scope: "", message: "" });
  const error = historyError.scope === scope ? historyError.message : "";
  const pending = useRef(false);
  const page = historyPage?.scope === scope ? historyPage.page : null;
  person = context?.person ?? person;
  const native = [
    ...(context?.messages ?? []),
    ...(page?.messages ?? []),
  ].filter(
    (message, index, messages) =>
      messages.findIndex((other) => other.id === message.id) === index,
  );
  const imported = splitImportedConversation(person?.summary ?? "").messages;
  const messages = [
    ...native.map((message) => ({
      ...message,
      sender:
        message.direction === "inbound"
          ? (person?.name ?? t.incoming)
          : t.outgoing,
      sourceId: message.providerMessageId,
      native: message.provenance === "native",
      imported: false,
    })),
    ...imported
      .filter(
        (message) =>
          !native.some(
            (existing) =>
              existing.direction === message.direction &&
              existing.body.trim() === message.body.trim() &&
              Date.parse(existing.occurredAt) ===
                Date.parse(message.occurredAt),
          ),
      )
      .map((message) => ({
        ...message,
        channel: "imported",
        imported: true,
        native: false,
      })),
  ].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const filtered = messages.filter(
    (message) =>
      (!channel || message.channel === channel) &&
      `${message.sender} ${message.body}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const visible = all ? filtered : filtered.slice(0, 8);
  return (
    <section
      className="conversation-history"
      aria-label={t.contactWorkspace.history}
    >
      <div className="section-heading">
        <h3>{t.contactWorkspace.history}</h3>
        <span className="muted">{messages.length}</span>
      </div>
      <div className="history-toolbar">
        <input
          type="search"
          aria-label={t.contactWorkspace.searchHistory}
          placeholder={t.contactWorkspace.searchHistory}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setAll(false);
          }}
        />
        <select
          aria-label={t.channel}
          value={channel}
          onChange={(event) => {
            setChannel(event.target.value);
            setAll(false);
          }}
        >
          <option value="">{t.contactWorkspace.allChannels}</option>
          {[...new Set(messages.map((message) => message.channel))].map(
            (value) => (
              <option key={value} value={value}>
                {value === "imported"
                  ? t.contactWorkspace.unknownChannel
                  : label(value)}
              </option>
            ),
          )}
        </select>
      </div>
      <div className="conversation-cards">
        {visible.map((message) => (
          <article
            key={message.id}
            className="conversation-card"
            data-direction={message.direction}
          >
            <header>
              <span className="conversation-channel">
                {message.channel === "gmail" ? (
                  <Mail size={15} />
                ) : message.channel === "linkedin" ? (
                  <MessagesSquare size={15} />
                ) : (
                  <MessageSquare size={15} />
                )}
                {message.channel === "imported"
                  ? t.contactWorkspace.imported
                  : label(message.channel)}
              </span>
              <time dateTime={message.occurredAt}>
                {preciseDateLabel(message.occurredAt, timeZone)}
              </time>
            </header>
            <div className="conversation-sender">
              {message.direction === "inbound" ? (
                <ArrowDownLeft size={14} />
              ) : (
                <ArrowUpRight size={14} />
              )}
              <strong>{message.sender}</strong>
              {message.native && (
                <span className="badge">{t.nativeIngestion.historySource}</span>
              )}
              <span>
                {message.direction === "inbound" ? t.incoming : t.outgoing}
              </span>
            </div>
            <div className="conversation-body">
              {paragraphs(message.body).map((paragraph) => (
                <p key={`${message.id}-${paragraph.offset}`}>
                  {paragraph.text}
                </p>
              ))}
            </div>
            {message.sourceId && (
              <details className="conversation-source">
                <summary>{t.contactWorkspace.sourceDetails}</summary>
                <code>{message.sourceId}</code>
              </details>
            )}
          </article>
        ))}
      </div>
      {!filtered.length && (
        <p className="muted">
          {messages.length
            ? t.contactWorkspace.noMatchingHistory
            : t.noMessages}
        </p>
      )}
      {filtered.length > 8 && (
        <button
          type="button"
          className="small ghost"
          onClick={() => setAll(!all)}
        >
          {all
            ? t.contactWorkspace.showLess
            : t.contactWorkspace.showAll.replace(
                "{count}",
                String(filtered.length),
              )}
        </button>
      )}
      {context && (page ? !!page.nextCursor : !!context.messagesNextCursor) && (
        <button
          type="button"
          className="small ghost"
          disabled={loading}
          onClick={async () => {
            if (pending.current) return;
            pending.current = true;
            setLoadingScope(scope);
            setHistoryError({ scope, message: "" });
            const cursor = page?.nextCursor ?? context.messagesNextCursor;
            const query = new URLSearchParams({
              operation: "messages",
              organizationId: context.relationship.organizationId,
              productId: context.relationship.productId,
              relationshipId: context.relationship.id,
            });
            if (cursor) query.set("cursor", cursor);
            try {
              const result = await requestJson<Page>(`/api/crm?${query}`);
              if (currentScope.current === scope) {
                setHistoryPage({
                  scope,
                  page: {
                    ...result,
                    messages: [...(page?.messages ?? []), ...result.messages],
                  },
                });
                setAll(true);
              }
            } catch (cause) {
              if (currentScope.current === scope)
                setHistoryError({ scope, message: errorText(cause) });
            } finally {
              pending.current = false;
              if (currentScope.current === scope) setLoadingScope("");
            }
          }}
        >
          {loading ? t.loading : t.nativeIngestion.loadEarlier}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      <p className="coverage-note">{t.partialHistory}</p>
    </section>
  );
}
