"use client";
import type { ClientContext, JsonValue } from "@crm/core/dto";
import type { MessageHistoryService } from "@crm/core/message-history";
import t from "@crm/i18n/translations/en.json";
import { useLayoutEffect, useRef, useState } from "react";
import { errorText, label, requestJson } from "../client-api";
import { ConversationThread } from "./conversation-thread";
import { splitImportedConversation } from "./imported-conversation";

export function ConversationHistory({
  context,
  person,
  timeZone,
  compact = false,
  viewerId,
  memberName,
}: {
  context?: ClientContext;
  person?: ClientContext["person"];
  timeZone: string;
  compact?: boolean;
  viewerId?: string;
  memberName?: (id: string) => string;
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
  const scroll = useRef<HTMLDivElement>(null);
  const previousScrollScope = useRef<string | null>(null);
  const oldestVisibleId = useRef<string | undefined>(undefined);
  const followLatest = useRef(true);
  const preserveScroll = useRef<{ height: number; top: number } | null>(null);
  const rememberScroll = () => {
    if (scroll.current)
      preserveScroll.current = {
        height: scroll.current.scrollHeight,
        top: scroll.current.scrollTop,
      };
  };
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
  const senderFor = (conversationId: string) => {
    const ownerId = context?.conversations?.find(
      (conversation) => conversation.id === conversationId,
    )?.ownerId;
    if (ownerId && ownerId === viewerId) return t.you;
    return (ownerId && memberName?.(ownerId)) || t.outgoing;
  };
  const messages = [
    ...native.map((message) => ({
      ...message,
      sender:
        message.direction === "inbound"
          ? (person?.name ?? t.incoming)
          : senderFor(message.conversationId),
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
  const scrollScope = JSON.stringify([
    context?.relationship.organizationId,
    context?.relationship.productId,
    context?.relationship.id ?? person?.id,
    search,
    channel,
  ]);
  // Incoming messages must not evict the message being read from the latest-eight window.
  // Keep only its boundary ID; every rendered body still comes from the current authorized data.
  const retainedIndex =
    previousScrollScope.current === scrollScope &&
    !followLatest.current &&
    !preserveScroll.current
      ? filtered.findIndex((message) => message.id === oldestVisibleId.current)
      : -1;
  const visible = all
    ? filtered
    : filtered.slice(0, Math.max(8, retainedIndex + 1));
  useLayoutEffect(() => {
    if (!scroll.current) {
      previousScrollScope.current = null;
      oldestVisibleId.current = undefined;
      followLatest.current = true;
      preserveScroll.current = null;
      return;
    }
    if (previousScrollScope.current !== scrollScope) {
      scroll.current.scrollTop = scroll.current.scrollHeight;
      previousScrollScope.current = scrollScope;
    } else if (preserveScroll.current) {
      const { height, top } = preserveScroll.current;
      scroll.current.scrollTop = top + scroll.current.scrollHeight - height;
    } else if (followLatest.current) {
      scroll.current.scrollTop = scroll.current.scrollHeight;
    }
    followLatest.current =
      scroll.current.scrollHeight -
        scroll.current.clientHeight -
        scroll.current.scrollTop <=
      1;
    oldestVisibleId.current = visible.at(-1)?.id;
    preserveScroll.current = null;
  });
  const filters = (
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
  );
  return (
    <section
      className="conversation-history"
      aria-label={t.contactWorkspace.history}
      data-compact={compact || undefined}
      data-empty={!messages.length || undefined}
    >
      <div className="section-heading">
        <h3>{t.contactWorkspace.history}</h3>
        <span className="muted">{messages.length}</span>
      </div>
      {!!messages.length &&
        (compact ? (
          <details className="conversation-history-filters">
            <summary>{t.filters}</summary>
            {filters}
          </details>
        ) : (
          filters
        ))}
      {!!visible.length && (
        <div
          className="conversation-history-scroll"
          ref={scroll}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable history needs keyboard focus so arrow keys can reach earlier messages.
          tabIndex={0}
          onScroll={(event) => {
            const element = event.currentTarget;
            followLatest.current =
              element.scrollHeight - element.clientHeight - element.scrollTop <=
              1;
          }}
        >
          <ConversationThread
            messages={visible}
            timeZone={timeZone}
            personName={person?.name}
            compact={compact}
          />
        </div>
      )}
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
          onClick={() => {
            rememberScroll();
            setAll(!all);
          }}
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
                rememberScroll();
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
