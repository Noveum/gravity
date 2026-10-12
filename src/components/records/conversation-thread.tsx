import { preciseDateLabel } from "@crm/core/calendar";
import t from "@crm/i18n/translations/en.json";
import { Mail, MessageSquare, MessagesSquare } from "lucide-react";
import { Fragment } from "react";
import { label } from "../client-api";
import "./conversation-thread.css";

export interface ConversationThreadMessage {
  id: string;
  body: string;
  direction: "inbound" | "outbound";
  occurredAt: string;
  channel: string;
  sender?: string;
  sourceId?: string | null;
  native?: boolean;
}

function paragraphs(body: string) {
  let offset = 0;
  return body.split(/\n\s*\n/).map((text) => {
    const paragraph = { text, offset };
    offset += text.length + 1;
    return paragraph;
  });
}

export function ConversationThread({
  messages,
  timeZone,
  personName,
  compact = false,
}: {
  messages: readonly ConversationThreadMessage[];
  timeZone: string;
  personName?: string;
  compact?: boolean;
}) {
  const days = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone,
  });
  const times = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  const chronological = [...messages].sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
  );
  return (
    <ol className="message-thread" data-compact={compact || undefined}>
      {chronological.map((message, index) => {
        const day = days.format(new Date(message.occurredAt));
        const previous = chronological[index - 1];
        const sender =
          message.sender ||
          (message.direction === "outbound"
            ? t.outgoing
            : personName || t.incoming);
        const channel =
          message.channel === "imported"
            ? t.contactWorkspace.imported
            : label(message.channel);
        const initials = sender
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((word) => word[0])
          .join("")
          .toUpperCase();
        return (
          <Fragment key={message.id}>
            {(!previous ||
              days.format(new Date(previous.occurredAt)) !== day) && (
              <li className="message-thread-date" role="presentation">
                <span>{day}</span>
              </li>
            )}
            <li
              className="message-thread-row"
              data-direction={message.direction}
            >
              <span className="message-thread-avatar" aria-hidden="true">
                {initials}
              </span>
              <article
                className="message-thread-bubble"
                data-direction={message.direction}
                aria-label={`${sender} · ${channel}`}
              >
                <header className="message-thread-heading">
                  <strong>{sender}</strong>
                  <time
                    dateTime={message.occurredAt}
                    title={preciseDateLabel(message.occurredAt, timeZone)}
                  >
                    {times.format(new Date(message.occurredAt))}
                  </time>
                </header>
                <div className="message-thread-body">
                  {paragraphs(message.body).map((paragraph) => (
                    <p key={`${message.id}-${paragraph.offset}`}>
                      {paragraph.text}
                    </p>
                  ))}
                </div>
                <footer className="message-thread-footer">
                  <span className="message-thread-channel">
                    {message.channel === "gmail" ? (
                      <Mail size={12} aria-hidden="true" />
                    ) : message.channel === "linkedin" ? (
                      <MessagesSquare size={12} aria-hidden="true" />
                    ) : (
                      <MessageSquare size={12} aria-hidden="true" />
                    )}
                    {channel}
                  </span>
                  {(message.sourceId || message.native) && (
                    <details className="message-thread-source">
                      <summary>{t.contactWorkspace.sourceDetails}</summary>
                      {message.native && (
                        <span>{t.nativeIngestion.historySource}</span>
                      )}
                      {message.sourceId && <code>{message.sourceId}</code>}
                    </details>
                  )}
                </footer>
              </article>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
