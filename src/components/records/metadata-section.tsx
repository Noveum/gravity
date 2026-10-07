"use client";
import { parseMoney } from "@crm/core/analytics";
import t from "@crm/i18n/translations/en.json";
import { useWorkspaceData } from "../crm/crm-context";
import { formatMoney, fromMinor } from "../money";
import { InlineField } from "./inline-field";

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
      {record.amountMinor !== null && (
        <span className="deal-size">
          {formatMoney(record.amountMinor, record.currency)}
        </span>
      )}
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
  compact = false,
}: {
  compact?: boolean;
  entity: "person" | "company" | "relationship" | "opportunity";
  record: MetadataRecord;
}) {
  const crm = useWorkspaceData();
  record = crm.currentRecord(record);
  const heading =
    entity === "relationship"
      ? t.relationshipDealSizeAndTags
      : entity === "person"
        ? t.personDealSizeAndTags
        : entity === "company"
          ? t.companyDealSizeAndTags
          : t.dealSizeAndTags;
  const save = async (
    captured: MetadataRecord,
    patch: { tags?: string[]; amountMinor?: number | null; currency?: string },
  ) => {
    const original = crm.currentRecord(captured);
    const result = await crm.send(
      {
        operation: "record-metadata",
        organizationId: crm.organizationId,
        entity,
        recordId: original.id,
        version: original.version,
        tags: original.tags,
        amountMinor: original.amountMinor,
        currency: original.currency,
        ...patch,
      },
      false,
      false,
    );
    return result.ok ? null : (result.error ?? t.errors.INVALID_INPUT);
  };
  const fields = (
    <>
      {!compact && (
        <InlineField
          key={`${record.id}:tags`}
          label={t.tags}
          record={record}
          value={record.tags.join(", ")}
          readOnly={!!record.archivedAt}
          onSave={(value, original) =>
            save(original, {
              tags: value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            })
          }
        />
      )}
      <InlineField
        key={`${record.id}:amount`}
        label={t.dealSize}
        record={record}
        value={fromMinor(record.amountMinor, record.currency)}
        type="number"
        readOnly={!!record.archivedAt}
        onSave={async (value, original) => {
          try {
            return await save(original, {
              amountMinor: parseMoney(
                value,
                crm.currentRecord(original).currency,
              ),
            });
          } catch {
            return t.errors.INVALID_INPUT;
          }
        }}
      />
      <InlineField
        key={`${record.id}:currency`}
        label={t.currency}
        record={record}
        value={record.currency}
        readOnly={!!record.archivedAt}
        options={Intl.supportedValuesOf("currency").map((value) => ({
          value,
          label: value,
        }))}
        onSave={(value, original) => save(original, { currency: value })}
      />
      {!compact && entity !== "opportunity" && (
        <p className="muted field-hint">{t.estimateForecastNote}</p>
      )}
    </>
  );
  if (compact) return <div className="deal-estimate-fields">{fields}</div>;
  return (
    <section className="record-section metadata-section">
      <details className="estimate-details">
        <summary>
          <h3>{heading}</h3>
          <MetadataValues record={record} />
        </summary>
        {fields}
      </details>
    </section>
  );
}
