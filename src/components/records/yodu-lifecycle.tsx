"use client";
import type { YoduEventPage } from "@crm/connectors/yodu";
import { preciseDateLabel } from "@crm/core/calendar";
import type { JsonValue } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, requestJson } from "../client-api";

export type ClientYoduEvent = JsonValue<YoduEventPage>["events"][number];

export function YoduEventCards({
  events,
  timeZone,
  association,
}: {
  events: ClientYoduEvent[];
  timeZone: string;
  association?: (event: ClientYoduEvent) => React.ReactNode;
}) {
  return (
    <div className="conversation-cards">
      {events.map((event) => (
        <article className="evidence-item" key={event.id}>
          <div className="section-heading">
            <strong>{t.yodu.kinds[event.kind]}</strong>
            <span className="badge">{t.yodu.proof}</span>
          </div>
          <p>
            {event.sourceLabel} ·{" "}
            <time dateTime={event.occurredAt}>
              {preciseDateLabel(event.occurredAt, timeZone)}
            </time>
          </p>
          <small>
            {event.externalSubjectId}
            {!event.relationshipId && ` · ${t.yodu.unmatched}`}
          </small>
          <details>
            <summary>{t.contactWorkspace.sourceDetails}</summary>
            <dl className="properties">
              <dt>{t.yodu.eventId}</dt>
              <dd>{event.providerEventId}</dd>
              <dt>{t.yodu.source}</dt>
              <dd>{event.sourceId}</dd>
              <dt>{t.yodu.sourceVersion}</dt>
              <dd>{event.sourceVersion}</dd>
              <dt>{t.yodu.occurredAt}</dt>
              <dd>{event.occurredAt}</dd>
              <dt>{t.yodu.receivedAt}</dt>
              <dd>{event.receivedAt}</dd>
              <dt>{t.yodu.payloadHash}</dt>
              <dd>
                <code>{event.payloadHash}</code>
              </dd>
            </dl>
          </details>
          {association?.(event)}
        </article>
      ))}
    </div>
  );
}

export function YoduLifecyclePanel({
  organizationId,
  productId,
  relationshipId,
  timeZone,
  revision,
}: {
  organizationId: string;
  productId: string;
  relationshipId: string;
  timeZone: string;
  revision?: string;
}) {
  const [page, setPage] = useState<JsonValue<YoduEventPage> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const alive = useRef(false);
  const generation = useRef(0);
  const load = useCallback(
    async (cursor?: string) => {
      const current = ++generation.current;
      setLoading(true);
      try {
        const query = new URLSearchParams({
          operation: "yodu-events",
          organizationId,
          productId,
          relationshipId,
        });
        if (cursor) query.set("cursor", cursor);
        const result = await requestJson<JsonValue<YoduEventPage>>(
          `/api/integrations?${query}`,
        );
        if (alive.current && generation.current === current) {
          setPage((prior) =>
            cursor && prior
              ? { ...result, events: [...prior.events, ...result.events] }
              : result,
          );
          setError("");
        }
      } catch (cause) {
        if (alive.current && generation.current === current)
          setError(errorText(cause, timeZone));
      } finally {
        if (generation.current === current) {
          if (alive.current) setLoading(false);
        }
      }
    },
    [organizationId, productId, relationshipId, timeZone],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: A receipt revision supersedes any request started before that change.
  useEffect(() => {
    alive.current = true;
    setPage(null);
    setError("");
    void load();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [revision, load]);
  return (
    <section aria-label={t.yodu.title}>
      <div className="section-heading">
        <h3>{t.yodu.title}</h3>
        <button
          type="button"
          className="small ghost"
          disabled={loading}
          onClick={() => void load()}
        >
          {t.yodu.refresh}
        </button>
      </div>
      <p className="muted">{t.yodu.verificationNote}</p>
      {loading && !page && <p role="status">{t.loading}</p>}
      {error && (
        <p role="alert">
          {error}
          <button type="button" disabled={loading} onClick={() => void load()}>
            {t.retry}
          </button>
        </p>
      )}
      {page && <YoduEventCards events={page.events} timeZone={timeZone} />}
      {page && !page.events.length && (
        <p className="muted">{t.yodu.noEvents}</p>
      )}
      {page?.nextCursor && (
        <button
          type="button"
          className="small"
          disabled={loading}
          onClick={() => void load(page.nextCursor ?? undefined)}
        >
          {t.yodu.more}
        </button>
      )}
    </section>
  );
}
