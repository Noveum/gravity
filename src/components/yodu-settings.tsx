"use client";
import type { YoduEventPage, YoduSources } from "@crm/connectors/yodu";
import type { ClientSnapshot, JsonValue } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, requestJson } from "./client-api";
import { type ClientYoduEvent, YoduEventCards } from "./records/yodu-lifecycle";

type Sources = JsonValue<YoduSources>;
type Source = Sources["sources"][number];
type EventPage = JsonValue<YoduEventPage>;

export function YoduSettings({
  data,
  organizationId,
  productId,
  demo,
  onChanged,
  timeZone,
}: {
  data: ClientSnapshot;
  organizationId: string;
  productId: string;
  demo: boolean;
  onChanged: () => Promise<void>;
  timeZone: string;
}) {
  const [selectedProduct, setSelectedProduct] = useState(
    productId || data.products[0]?.id || "",
  );
  const [expanded, setExpanded] = useState(false);
  const [overview, setOverview] = useState<Sources | null>(null);
  const [page, setPage] = useState<EventPage | null>(null);
  const [filter, setFilter] = useState("false");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState<{
    sourceId: string;
    value: string;
  } | null>(null);
  const [createId, setCreateId] = useState("");
  const alive = useRef(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const canManage = overview?.canManage ?? false;
  const relationships = data.relationships.filter(
    (relationship) => relationship.productId === selectedProduct,
  );
  const relationshipLabel = (id: string) => {
    const relationship = relationships.find((row) => row.id === id);
    return (
      data.people.find((person) => person.id === relationship?.personId)
        ?.name ?? id
    );
  };
  const load = useCallback(
    async (cursor?: string) => {
      if (demo || !selectedProduct || !expanded) return;
      const current = ++generation.current;
      setLoading(true);
      const scope = { organizationId, productId: selectedProduct };
      try {
        const [sources, events] = await Promise.all([
          requestJson<Sources>(
            `/api/integrations?${new URLSearchParams({ ...scope, operation: "yodu-sources" })}`,
          ),
          requestJson<EventPage>(
            `/api/integrations?${new URLSearchParams({ ...scope, operation: "yodu-events", unmatched: filter, ...(cursor ? { cursor } : {}) })}`,
          ),
        ]);
        if (alive.current && generation.current === current) {
          setOverview(sources);
          setPage((prior) =>
            cursor && prior
              ? { ...events, events: [...prior.events, ...events.events] }
              : events,
          );
          setError("");
        }
      } catch (cause) {
        if (alive.current && generation.current === current)
          setError(errorText(cause, timeZone));
      } finally {
        if (alive.current && generation.current === current) setLoading(false);
      }
    },
    [organizationId, selectedProduct, demo, expanded, filter, timeZone],
  );
  async function loadBindings(cursor: string) {
    const current = ++generation.current;
    setLoading(true);
    try {
      const result = await requestJson<Sources>(
        `/api/integrations?${new URLSearchParams({
          organizationId,
          productId: selectedProduct,
          operation: "yodu-sources",
          bindingsCursor: cursor,
        })}`,
      );
      if (alive.current && generation.current === current) {
        setOverview((prior) =>
          prior
            ? {
                ...result,
                bindings: [
                  ...new Map(
                    [...prior.bindings, ...result.bindings].map((row) => [
                      row.id,
                      row,
                    ]),
                  ).values(),
                ],
              }
            : result,
        );
        setError("");
      }
    } catch (cause) {
      if (alive.current && generation.current === current)
        setError(errorText(cause, timeZone));
    } finally {
      if (alive.current && generation.current === current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    setOverview(null);
    setPage(null);
    setSecret(null);
    setError("");
    setLoading(false);
    setCreateId(crypto.randomUUID());
    void load();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [load]);
  async function mutate(operation: string, body: object) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const scopeGeneration = generation.current;
    try {
      const result = await requestJson<{ id?: string; signingSecret?: string }>(
        "/api/integrations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation,
            organizationId,
            productId: selectedProduct,
            ...body,
          }),
        },
      );
      if (!alive.current || generation.current !== scopeGeneration) return;
      if (result.signingSecret && result.id)
        setSecret({ sourceId: result.id, value: result.signingSecret });
      if (operation === "yodu-create-source") setCreateId(crypto.randomUUID());
      await load();
      await onChanged();
    } catch (cause) {
      if (alive.current && generation.current === scopeGeneration)
        setError(errorText(cause, timeZone));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function association(event: ClientYoduEvent) {
    if (!canManage) return null;
    return (
      <form
        className="connection-buttons"
        onSubmit={(submit) => {
          submit.preventDefault();
          const relationshipId = new FormData(submit.currentTarget).get(
            "relationshipId",
          );
          void mutate("yodu-bind-subject", {
            sourceId: event.sourceId,
            externalSubjectId: event.externalSubjectId,
            relationshipId,
            ...(event.bindingVersion
              ? { expectedVersion: event.bindingVersion }
              : {}),
          });
        }}
      >
        <label>
          {t.yodu.relationship}
          <select
            key={`${event.relationshipId}:${event.bindingVersion}`}
            name="relationshipId"
            required
            disabled={busy}
            defaultValue={
              relationships.some((row) => row.id === event.relationshipId)
                ? (event.relationshipId ?? "")
                : ""
            }
          >
            <option value="" disabled>
              {t.yodu.chooseRelationship}
            </option>
            {relationships.map((relationship) => (
              <option key={relationship.id} value={relationship.id}>
                {relationshipLabel(relationship.id)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy || !relationships.length}>
          {t.yodu.bind}
        </button>
      </form>
    );
  }
  return (
    <article className="integration-card">
      <div className="section-heading">
        <h2>{t.yodu.setupTitle}</h2>
      </div>
      <p>{t.yodu.setupNote}</p>
      <p className="muted">{t.yodu.verificationNote}</p>
      <button
        type="button"
        disabled={busy || demo}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? t.close : t.connectionSetup}
      </button>
      {expanded && (
        <>
          <label>
            {t.product}
            <select
              value={selectedProduct}
              disabled={busy || !!productId}
              onChange={(event) => setSelectedProduct(event.target.value)}
            >
              {!selectedProduct && (
                <option value="">{t.yodu.selectProduct}</option>
              )}
              {data.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <p>
            <a
              href="/docs/yodu-lifecycle-bridge"
              target="_blank"
              rel="noreferrer"
            >
              {t.yodu.bridgeGuide}
            </a>
          </p>
          {demo && <p className="connection-note">{t.integrationDemo}</p>}
          {loading && <p role="status">{t.loading}</p>}
          {error && (
            <p role="alert">
              {error}
              <button
                type="button"
                disabled={loading || busy}
                onClick={() => void load()}
              >
                {t.retry}
              </button>
            </p>
          )}
          {overview && !overview.configured && (
            <p className="connection-note">{t.integrationConfigRequired}</p>
          )}
          {overview && !canManage && (
            <p className="muted">{t.yodu.adminNote}</p>
          )}
          {secret && (
            <div className="callout">
              <p>{t.yodu.secretNote}</p>
              <label>
                {t.signingSecret}
                <input
                  type="password"
                  readOnly
                  value={secret.value}
                  autoComplete="off"
                />
              </label>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(secret.value);
                  } catch {
                    setError(t.copyFailed);
                  }
                }}
              >
                {t.copy}
              </button>
              <button type="button" onClick={() => setSecret(null)}>
                {t.done}
              </button>
            </div>
          )}
          {canManage && overview?.configured && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const label = new FormData(event.currentTarget).get("label");
                void mutate("yodu-create-source", {
                  sourceId: createId,
                  label,
                });
              }}
            >
              <label>
                {t.yodu.sourceLabel}
                <input
                  name="label"
                  required
                  maxLength={100}
                  disabled={busy}
                  defaultValue={t.yodu.sourceDefault}
                />
              </label>
              <button type="submit" disabled={busy || !createId}>
                {t.yodu.create}
              </button>
            </form>
          )}
          {overview?.sources.map((source) => (
            <SourceControls
              key={`${source.id}:${source.version}`}
              source={source}
              canManage={canManage}
              busy={busy}
              mutate={mutate}
            />
          ))}
          {overview && !overview.sources.length && (
            <p className="muted">{t.yodu.noSources}</p>
          )}
          {canManage && !!overview?.sources.length && (
            <>
              <h3>{t.yodu.mapping}</h3>
              <p className="muted">{t.yodu.rebindNote}</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const sourceId = String(form.get("sourceId"));
                  const externalSubjectId = String(
                    form.get("externalSubjectId"),
                  ).trim();
                  const existing = overview.bindings.find(
                    (binding) =>
                      binding.sourceId === sourceId &&
                      binding.externalSubjectId === externalSubjectId,
                  );
                  void mutate("yodu-bind-subject", {
                    sourceId,
                    externalSubjectId,
                    relationshipId: form.get("relationshipId"),
                    ...(existing ? { expectedVersion: existing.version } : {}),
                  });
                }}
              >
                <label>
                  {t.yodu.source}
                  <select name="sourceId" disabled={busy}>
                    {overview.sources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.yodu.subject}
                  <input
                    name="externalSubjectId"
                    required
                    maxLength={200}
                    disabled={busy}
                  />
                </label>
                <label>
                  {t.yodu.relationship}
                  <select
                    name="relationshipId"
                    defaultValue=""
                    required
                    disabled={busy}
                  >
                    <option value="" disabled>
                      {t.yodu.chooseRelationship}
                    </option>
                    {relationships.map((relationship) => (
                      <option key={relationship.id} value={relationship.id}>
                        {relationshipLabel(relationship.id)}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" disabled={busy || !relationships.length}>
                  {t.yodu.bind}
                </button>
              </form>
              {overview.bindings.map((binding) => (
                <form
                  key={`${binding.id}:${binding.version}`}
                  className="connection-account"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void mutate("yodu-bind-subject", {
                      sourceId: binding.sourceId,
                      externalSubjectId: binding.externalSubjectId,
                      expectedVersion: binding.version,
                      relationshipId: new FormData(event.currentTarget).get(
                        "relationshipId",
                      ),
                    });
                  }}
                >
                  <span>
                    {
                      overview.sources.find(
                        (source) => source.id === binding.sourceId,
                      )?.label
                    }{" "}
                    · {binding.externalSubjectId}
                  </span>
                  <label>
                    {t.yodu.relationship}
                    <select
                      name="relationshipId"
                      disabled={busy}
                      defaultValue={
                        relationships.some(
                          (row) => row.id === binding.relationshipId,
                        )
                          ? binding.relationshipId
                          : ""
                      }
                      required
                    >
                      <option value="" disabled>
                        {t.yodu.chooseRelationship}
                      </option>
                      {relationships.map((relationship) => (
                        <option key={relationship.id} value={relationship.id}>
                          {relationshipLabel(relationship.id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    disabled={busy || !relationships.length}
                  >
                    {t.save}
                  </button>
                </form>
              ))}
              {overview.bindingsTruncated && (
                <button
                  type="button"
                  disabled={busy || loading || !overview.nextBindingsCursor}
                  onClick={() => {
                    if (overview.nextBindingsCursor)
                      void loadBindings(overview.nextBindingsCursor);
                  }}
                >
                  {t.yodu.loadMoreBindings}
                </button>
              )}
            </>
          )}
          {page && (
            <>
              <div className="section-heading">
                <h3>{t.yodu.events}</h3>
                <select
                  aria-label={t.yodu.events}
                  value={filter}
                  disabled={busy || loading}
                  onChange={(event) => setFilter(event.target.value)}
                >
                  <option value="false">{t.yodu.allEvents}</option>
                  <option value="true">{t.yodu.unmatchedEvents}</option>
                </select>
                <button
                  type="button"
                  disabled={busy || loading}
                  onClick={() => void load()}
                >
                  {t.yodu.refresh}
                </button>
              </div>
              <YoduEventCards
                events={page.events}
                timeZone={timeZone}
                association={association}
              />
              {!page.events.length && (
                <p className="muted">{t.yodu.noEvents}</p>
              )}
              {page.nextCursor && (
                <button
                  type="button"
                  disabled={busy || loading}
                  onClick={() => void load(page.nextCursor ?? undefined)}
                >
                  {t.yodu.more}
                </button>
              )}
            </>
          )}
        </>
      )}
    </article>
  );
}
function SourceControls({
  source,
  canManage,
  busy,
  mutate,
}: {
  source: Source;
  canManage: boolean;
  busy: boolean;
  mutate: (operation: string, body: object) => Promise<void>;
}) {
  return (
    <div className="connection-account">
      <div>
        <strong>{source.label}</strong>{" "}
        <span className="badge">
          {source.enabled ? t.yodu.enabled : t.yodu.disabled}
        </span>
        <label>
          {t.webhookUrl}
          <input readOnly value={source.webhookUrl} />
        </label>
        {canManage && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void mutate("yodu-update-source", {
                sourceId: source.id,
                version: source.version,
                label: new FormData(event.currentTarget).get("label"),
              });
            }}
          >
            <label>
              {t.yodu.sourceLabel}
              <input
                name="label"
                required
                maxLength={100}
                defaultValue={source.label}
                disabled={busy}
              />
            </label>
            <button type="submit" disabled={busy}>
              {t.yodu.rename}
            </button>
          </form>
        )}
      </div>
      {canManage && (
        <div className="connection-buttons">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void mutate("yodu-update-source", {
                sourceId: source.id,
                version: source.version,
                enabled: !source.enabled,
              })
            }
          >
            {source.enabled ? t.yodu.disable : t.yodu.enable}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void mutate("yodu-update-source", {
                sourceId: source.id,
                version: source.version,
                rotateSecret: true,
              })
            }
          >
            {t.yodu.rotate}
          </button>
        </div>
      )}
    </div>
  );
}
