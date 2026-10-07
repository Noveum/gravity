"use client";
import type { ContactAttributionService } from "@crm/core/contact-attribution";
import type { ClientContext, JsonValue } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { useEffect, useRef, useState } from "react";
import { dateLabel, requestJson } from "../client-api";
import { useCrm } from "../crm/crm-context";
import { RecordDialog, text } from "./record-dialog";

type Attribution = JsonValue<
  Awaited<ReturnType<ContactAttributionService["list"]>>
>;
const copy = t.attribution;

export function ContactAttribution({ context }: { context: ClientContext }) {
  const crm = useCrm();
  const [page, setPage] = useState({ scope: "", offset: 0 });
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const personId = context.person?.id ?? "";
  const productId = context.relationship.productId;
  const scope = `${crm.organizationId}/${personId}/${productId}/${crm.sourceData?.asOf}/${retry}`;
  const offset = page.scope === scope ? page.offset : 0;
  const setOffset = (offset: number) => setPage({ scope, offset });
  const [loaded, setLoaded] = useState<{
    scope: string;
    data: Attribution | null;
    error: boolean;
  }>({ scope: "", data: null, error: false });
  useEffect(() => {
    if (!personId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      operation: "contact-attribution",
      organizationId: crm.organizationId,
      productId,
      personId,
      offset: String(offset),
    });
    requestJson<Attribution>(`/api/crm?${query}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setLoaded((current) => ({
            scope,
            data:
              offset && current.scope === scope && current.data
                ? { ...data, items: [...current.data.items, ...data.items] }
                : data,
            error: false,
          }));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLoaded({ scope, data: null, error: true });
      });
    return () => controller.abort();
  }, [scope, crm.organizationId, personId, productId, offset]);
  // A new record/product never renders the previous record's attribution.
  const data = loaded.scope === scope ? loaded.data : null;
  const failed = loaded.scope === scope && loaded.error;
  const original = data?.creator;
  return (
    <section className="record-section" aria-label={copy.title}>
      <details>
        <summary>
          <strong>{copy.title}</strong>
        </summary>
        {failed ? (
          <p role="alert">
            {copy.unavailable}{" "}
            <button
              type="button"
              onClick={() => {
                setOffset(0);
                setRetry((n) => n + 1);
              }}
            >
              {copy.retry}
            </button>
          </p>
        ) : !data ? (
          <p role="status">{t.loading}</p>
        ) : (
          <>
            <dl className="properties">
              <dt>{copy.creator}</dt>
              <dd>{original?.actorName ?? copy.unknown}</dd>
              <dt>{copy.lastEditor}</dt>
              <dd>{data.lastEditor?.actorName ?? copy.unknown}</dd>
            </dl>
            <p className="coverage-note">{copy.coverage}</p>
            <h4>{copy.history}</h4>
            {!data.items.length && <p className="muted">{copy.unknown}</p>}
            {data.items.map((item) => (
              <article className="attribution-event" key={item.id}>
                <strong>{copy[item.kind]}</strong>
                <small className="attribution-date">
                  {dateLabel(item.createdAt, crm.timeZone)}
                </small>
                <dl className="properties">
                  <dt>{copy.submittedBy}</dt>
                  <dd>
                    {item.actorName ??
                      (item.transport === "system"
                        ? copy.system
                        : copy.unknown)}
                  </dd>
                  {item.sourceMemberId && (
                    <>
                      <dt>{item.provider ? copy.source : copy.sourceMember}</dt>
                      <dd>{item.sourceMemberName ?? item.sourceMemberId}</dd>
                    </>
                  )}
                  <dt>{copy.transport}</dt>
                  <dd>
                    {copy[item.transport]}
                    {item.clientId ? ` · ${item.clientId}` : ""}
                  </dd>
                  {item.batchLabel && (
                    <>
                      <dt>{copy.batch}</dt>
                      <dd>{item.batchLabel}</dd>
                    </>
                  )}
                  {item.sourceKind && (
                    <>
                      <dt>{copy.sourceKind}</dt>
                      <dd>{copy[item.sourceKind]}</dd>
                    </>
                  )}
                  {item.provider && (
                    <>
                      <dt>{copy.provider}</dt>
                      <dd>{item.provider}</dd>
                    </>
                  )}
                  {item.sourceRecordId && (
                    <>
                      <dt>{copy.sourceRecordId}</dt>
                      <dd>{item.sourceRecordId}</dd>
                    </>
                  )}
                </dl>
              </article>
            ))}
            {data.nextOffset !== null && (
              <button
                type="button"
                onClick={() => setOffset(data.nextOffset ?? 0)}
              >
                {copy.more}
              </button>
            )}
          </>
        )}
        {!context.person?.archivedAt && (
          <button
            type="button"
            disabled={crm.busy}
            onClick={() => setEditing(true)}
          >
            {copy.recordSource}
          </button>
        )}
      </details>
      {editing && context.person && (
        <AttributionDialog
          key={`${personId}/${productId}`}
          context={context}
          onClose={() => {
            setEditing(false);
            setOffset(0);
            setRetry((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}

function AttributionDialog({
  context,
  onClose,
}: {
  context: ClientContext;
  onClose: () => void;
}) {
  const crm = useCrm();
  const [original] = useState(context);
  const submissionKeys = useRef(new Map<string, string>());
  return (
    <RecordDialog
      title={copy.recordSource}
      submitLabel={t.save}
      onClose={onClose}
      onSubmit={async (fields) => {
        const declaration = {
          label: text(fields, "label"),
          sourceKind: text(fields, "sourceKind"),
          sourceMemberId: text(fields, "sourceMemberId") || null,
        };
        // Exact retries retain their key, even after a lost response. Correcting
        // batch metadata starts a new declaration rather than mutating a batch.
        const identity = JSON.stringify(declaration);
        let submissionKey = submissionKeys.current.get(identity);
        if (!submissionKey) {
          submissionKey = crypto.randomUUID();
          submissionKeys.current.set(identity, submissionKey);
        }
        const batch = await requestJson<{ id: string }>("/api/crm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "import-batch",
            organizationId: original.relationship.organizationId,
            productId: original.relationship.productId,
            submissionKey,
            ...declaration,
          }),
        });
        await requestJson("/api/crm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "contact-import",
            organizationId: original.relationship.organizationId,
            productId: original.relationship.productId,
            personId: original.person?.id,
            version: original.person?.version,
            batchId: batch.id,
            sourceRecordId: text(fields, "sourceRecordId"),
          }),
        });
        await crm.refresh();
        return null;
      }}
    >
      <p className="coverage-note">{copy.sourceNote}</p>
      <label>
        {copy.batchLabel}
        <input name="label" required maxLength={150} />
      </label>
      <label>
        {copy.sourceKind}
        <select name="sourceKind" defaultValue="file">
          <option value="file">{copy.file}</option>
          <option value="agent">{copy.agent}</option>
          <option value="manual">{copy.manual}</option>
        </select>
      </label>
      <label>
        {copy.sourceMember}
        <select name="sourceMemberId" defaultValue="">
          <option value="">{copy.unspecified}</option>
          {crm.sourceData?.members
            .filter((m) =>
              m.productIds.includes(original.relationship.productId),
            )
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        {copy.sourceRecordId}
        <input name="sourceRecordId" required maxLength={200} />
      </label>
    </RecordDialog>
  );
}
