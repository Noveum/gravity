"use client";
import { parseMoney } from "@crm/core/analytics";
import t from "@crm/i18n/translations/en.json";
import { useState } from "react";
import { useWorkspaceData } from "../crm/crm-context";
import { formatMoney, fromMinor, minorStep } from "../money";
import { RecordDialog, text } from "./record-dialog";

export interface MetadataRecord {
  id: string;
  version: number;
  tags: string[];
  amountMinor: number | null;
  currency: string;
  archivedAt?: string | null;
}
export function MetadataValues({
  record,
}: {
  record: Pick<MetadataRecord, "tags" | "amountMinor" | "currency">;
}) {
  return (
    <>
      <span className="deal-size">
        {formatMoney(record.amountMinor, record.currency)}
      </span>
      <span className="record-tags">
        {record.tags.map((tag) => (
          <span key={tag} className="badge">
            {tag}
          </span>
        ))}
      </span>
    </>
  );
}
export function MetadataSection({
  entity,
  record,
}: {
  entity: "person" | "company" | "relationship" | "opportunity";
  record: MetadataRecord;
}) {
  const crm = useWorkspaceData();
  const [editing, setEditing] = useState(false);
  const [currency, setCurrency] = useState(record.currency);
  return (
    <section className="record-section metadata-section">
      <h3>
        {entity === "relationship"
          ? t.relationshipDealSizeAndTags
          : t.dealSizeAndTags}
      </h3>
      <MetadataValues record={record} />
      {!record.archivedAt && (
        <button
          className="ghost"
          type="button"
          onClick={() => {
            setCurrency(record.currency);
            setEditing(true);
          }}
        >
          {t.editDealSizeAndTags}
        </button>
      )}
      {editing && (
        <RecordDialog
          title={t.editDealSizeAndTags}
          submitLabel={t.save}
          onClose={() => setEditing(false)}
          onSubmit={async (fields) => {
            let amountMinor: number | null;
            try {
              amountMinor = parseMoney(text(fields, "amount"), currency);
            } catch {
              return t.errors.INVALID_INPUT;
            }
            const result = await crm.send(
              {
                operation: "record-metadata",
                organizationId: crm.organizationId,
                entity,
                recordId: record.id,
                version: record.version,
                tags: text(fields, "tags")
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
                amountMinor,
                currency,
              },
              t.updated,
              false,
            );
            return result.ok ? null : (result.error ?? t.errors.INVALID_INPUT);
          }}
        >
          <label>
            {t.tags}
            <input
              data-primary-field
              name="tags"
              defaultValue={record.tags.join(", ")}
              aria-describedby="tags-hint"
            />
          </label>
          <small id="tags-hint">{t.tagsHint}</small>
          <label>
            {t.currency}
            <select
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {Intl.supportedValuesOf("currency").map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.dealSize}
            <input
              name="amount"
              type="number"
              min="0"
              step={minorStep(currency)}
              defaultValue={fromMinor(record.amountMinor, record.currency)}
            />
          </label>
        </RecordDialog>
      )}
    </section>
  );
}
