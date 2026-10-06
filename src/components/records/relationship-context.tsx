"use client";
import type { ClientContext } from "@crm/core/dto";
import {
  contextSectionKeys,
  emptyRelationshipDetails,
  isImportedContext,
  safeContextUrl,
} from "@crm/core/relationship-context";
import t from "@crm/i18n/translations/en.json";
import { Clock3, FileText, Pencil, Radar } from "lucide-react";
import { useState } from "react";
import { dateLabel } from "../client-api";
import { useCrm } from "../crm/crm-context";
import { ImportedContext } from "./imported-context";
import { InlineField } from "./inline-field";
import { RecordText } from "./record-text";
import { RelationshipContextDialog } from "./relationship-context-dialog";

export function RelationshipContext({
  relationship,
}: {
  relationship: ClientContext["relationship"];
}) {
  const { timeZone, busy, send, currentRecord } = useCrm();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<ClientContext["relationship"] | null>(
    null,
  );
  relationship =
    saved && saved.version > relationship.version ? saved : relationship;
  const details = relationship.contextDetails ?? emptyRelationshipDetails();
  const isImported = isImportedContext(relationship.context);
  const hasNotes =
    relationship.context ||
    contextSectionKeys.some((key) => details[key]) ||
    details.fields.length ||
    details.signals.length;
  return (
    <section
      className="relationship-context record-section"
      aria-label={t.contextFields.heading}
    >
      <div className="context-heading">
        <h3>
          <FileText size={15} aria-hidden="true" />
          {t.contextFields.heading}
        </h3>
        <button
          type="button"
          className="small"
          disabled={busy}
          onClick={() => setEditing(true)}
        >
          <Pencil size={13} aria-hidden="true" />
          {t.contextFields.edit}
        </button>
      </div>
      {!hasNotes && <p className="muted">{t.contextFields.empty}</p>}
      <div className="context-note-grid">
        {
          <div className="context-note">
            <InlineField
              key={`${relationship.id}:summary`}
              label={t.summary}
              record={relationship}
              value={isImported ? "" : relationship.context}
              multiline
              onSave={async (value, captured) => {
                const original = currentRecord(captured);
                const result = await send(
                  {
                    operation: "relationship",
                    organizationId: original.organizationId,
                    productId: original.productId,
                    relationshipId: original.id,
                    version: original.version,
                    context: value,
                  },
                  false,
                  false,
                  "/api/outreach",
                );
                if (result.ok)
                  setSaved(result.result as ClientContext["relationship"]);
                return result.ok
                  ? null
                  : (result.error ?? t.errors.INVALID_INPUT);
              }}
            />
          </div>
        }
        {contextSectionKeys
          .filter((key) => details[key])
          .map((key) => (
            <div key={key} className="context-note">
              <InlineField
                key={`${relationship.id}:${key}`}
                label={t.contextFields.sections[key]}
                record={relationship}
                value={details[key]}
                multiline
                onSave={async (value, captured) => {
                  const original = currentRecord(captured);
                  const result = await send(
                    {
                      operation: "relationship",
                      organizationId: original.organizationId,
                      productId: original.productId,
                      relationshipId: original.id,
                      version: original.version,
                      contextDetails: { [key]: value },
                    },
                    false,
                    false,
                    "/api/outreach",
                  );
                  if (result.ok)
                    setSaved(result.result as ClientContext["relationship"]);
                  return result.ok
                    ? null
                    : (result.error ?? t.errors.INVALID_INPUT);
                }}
              />
            </div>
          ))}
      </div>
      {!!details.fields.length && (
        <div className="context-note">
          <h4>{t.contextFields.customFields}</h4>
          <dl className="context-fields">
            {details.fields.map((field) => (
              <div key={field.id}>
                <dt>{field.label}</dt>
                <dd>
                  {field.type === "boolean" ? (
                    field.value ? (
                      t.contextFields.yes
                    ) : (
                      t.contextFields.no
                    )
                  ) : field.type === "url" && safeContextUrl(field.value) ? (
                    <a
                      href={safeContextUrl(field.value) ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {field.value}
                    </a>
                  ) : field.type === "text" && field.value ? (
                    <RecordText value={String(field.value)} />
                  ) : (
                    String(field.value) || t.contextFields.notProvided
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {!!details.signals.length && (
        <div className="context-signals">
          <h4>
            <Radar size={15} aria-hidden="true" />
            {t.contextFields.signals}{" "}
            <span className="badge">{details.signals.length}</span>
          </h4>
          {details.signals.map((signal) => (
            <article key={signal.id} className="context-signal">
              <div className="signal-title">
                <strong>{signal.title}</strong>
                <span className="badge">
                  {t.contextFields.kinds[signal.kind]}
                </span>
                <span className="badge">
                  {signal.classification === "fact" ? t.fact : t.hypothesis}
                </span>
              </div>
              <RecordText value={signal.description} />
              <div className="signal-meta">
                {signal.observedAt && (
                  <span>
                    <Clock3 size={12} aria-hidden="true" />
                    {dateLabel(signal.observedAt, timeZone)}
                  </span>
                )}
                {signal.sourceUrl && safeContextUrl(signal.sourceUrl) && (
                  <a
                    href={safeContextUrl(signal.sourceUrl) ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t.contextFields.source}
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {isImported && (
        <ImportedContext
          key={relationship.context}
          source={relationship.context}
          title={
            relationship.contextSource
              ? t.contextFields.currentImport
              : t.contextFields.importedSource
          }
        />
      )}
      {relationship.contextSource &&
        relationship.contextSource !== relationship.context && (
          <ImportedContext
            key={relationship.contextSource}
            source={relationship.contextSource}
          />
        )}
      {editing && (
        <RelationshipContextDialog
          relationship={relationship}
          onSaved={setSaved}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  );
}
