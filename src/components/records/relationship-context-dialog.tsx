"use client";
import { instantFromZonedInput, zonedInputValue } from "@crm/core/calendar";
import type { ClientContext } from "@crm/core/dto";
import {
  contextSectionKeys,
  emptyRelationshipDetails,
  fieldKinds,
  fitsRelationshipInput,
  isImportedContext,
  type RelationshipSignal,
  relationshipDetailsSchema,
  signalKinds,
} from "@crm/core/relationship-context";
import t from "@crm/i18n/translations/en.json";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useCrm } from "../crm/crm-context";
import { useOutreachSend } from "../outreach/outreach-data";
import { RecordDialog, text } from "./record-dialog";

interface FieldDraft {
  id: string;
  label: string;
  type: (typeof fieldKinds)[number];
  value: string;
}
export function RelationshipContextDialog({
  relationship,
  onClose,
  onSaved,
}: {
  relationship: ClientContext["relationship"];
  onClose: () => void;
  onSaved: (relationship: ClientContext["relationship"]) => void;
}) {
  const crm = useCrm();
  const send = useOutreachSend();
  // Capture the version when editing starts. Live updates never silently rebase unsaved edits.
  const [original] = useState(relationship);
  const details = original.contextDetails ?? emptyRelationshipDetails();
  const isImported = isImportedContext(original.context);
  const [signals, setSignals] = useState<RelationshipSignal[]>(details.signals);
  const [fields, setFields] = useState<FieldDraft[]>(
    details.fields.map((field) => ({ ...field, value: String(field.value) })),
  );
  const [timeZone, setTimeZone] = useState(crm.timeZone);
  const [dateDrafts, setDateDrafts] = useState<Record<string, string>>({});
  const updateSignal = (id: string, patch: Partial<RelationshipSignal>) =>
    setSignals((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  const updateField = (id: string, patch: Partial<FieldDraft>) =>
    setFields((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  const invalidDate = (key: string, allowEmpty = false) => {
    const value = dateDrafts[key];
    return (
      value !== undefined &&
      !(allowEmpty && value === "") &&
      !instantFromZonedInput(value, timeZone)
    );
  };
  const clearDateDraft = (key: string) =>
    setDateDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  const changeTimeZone = (nextZone: string) => {
    const retained = Object.fromEntries(
      Object.entries(dateDrafts).filter(
        ([, value]) => !instantFromZonedInput(value, timeZone),
      ),
    );
    setSignals((current) =>
      current.map((signal) => {
        const value = retained[`signal:${signal.id}`];
        const instant = value && instantFromZonedInput(value, nextZone);
        return instant ? { ...signal, observedAt: instant } : signal;
      }),
    );
    setFields((current) =>
      current.map((field) => {
        const value = retained[`field:${field.id}`];
        const instant = value && instantFromZonedInput(value, nextZone);
        return field.type === "datetime" && instant
          ? { ...field, value: instant }
          : field;
      }),
    );
    setDateDrafts(retained);
    setTimeZone(nextZone);
  };
  return (
    <RecordDialog
      inline
      dirty={
        Object.keys(dateDrafts).length > 0 ||
        JSON.stringify(signals) !== JSON.stringify(details.signals) ||
        JSON.stringify(fields) !==
          JSON.stringify(
            details.fields.map((field) => ({
              ...field,
              value: String(field.value),
            })),
          )
      }
      title={t.contextFields.edit}
      className="context-edit-dialog"
      submitLabel={t.save}
      onClose={onClose}
      onSubmit={async (values) => {
        if (
          signals.some((signal) => invalidDate(`signal:${signal.id}`, true)) ||
          fields.some(
            (field) =>
              field.type === "datetime" && invalidDate(`field:${field.id}`),
          )
        )
          return t.contextFields.invalidDatetime;
        const sections = Object.fromEntries(
          contextSectionKeys.map((key) => [key, text(values, key)]),
        );
        const parsed = relationshipDetailsSchema.safeParse({
          ...sections,
          signals,
          fields: fields.map((field) => ({
            ...field,
            value:
              field.type === "number"
                ? field.value.trim()
                  ? Number(field.value)
                  : null
                : field.type === "boolean"
                  ? field.value === "true"
                  : field.value,
          })),
        });
        if (!parsed.success) return t.contextFields.invalid;
        const summary = text(values, "context");
        const body = {
          operation: "relationship",
          organizationId: original.organizationId,
          productId: original.productId,
          relationshipId: original.id,
          version: original.version,
          // A blank summary while adding structured fields leaves a legacy import untouched.
          ...(!isImported || summary ? { context: summary } : {}),
          contextDetails: parsed.data,
        };
        if (!fitsRelationshipInput(body)) return t.contextFields.invalid;
        const result = await send(body);
        if (!result.ok) {
          if (result.code === "CONFLICT") void crm.refresh();
          return result.error;
        }
        onSaved(result.result as ClientContext["relationship"]);
        crm.notify(t.contextFields.saved, "success");
        return null;
      }}
    >
      <p className="muted field-hint">{t.contextFields.sharedHint}</p>
      {(signals.length > 0 ||
        fields.some((field) => field.type === "datetime")) && (
        <label>
          {t.timezone}
          <select
            value={timeZone}
            onChange={(event) => changeTimeZone(event.target.value)}
          >
            {[...new Set([crm.timeZone, "UTC"])].map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        {t.summary}
        <textarea
          name="context"
          data-primary-field
          rows={3}
          maxLength={10000}
          placeholder={t.contextFields.summaryPlaceholder}
          defaultValue={isImported ? "" : original.context}
        />
      </label>
      {isImported && (
        <p className="muted field-hint">{t.contextFields.preserveHint}</p>
      )}
      {contextSectionKeys.map((key) => (
        <label key={key}>
          {t.contextFields.sections[key]}
          <textarea
            name={key}
            rows={key === "history" ? 4 : 2}
            maxLength={10000}
            defaultValue={details[key]}
          />
        </label>
      ))}
      <div className="context-heading">
        <h3>{t.contextFields.signals}</h3>
        <button
          type="button"
          className="small"
          disabled={signals.length >= 100}
          onClick={() =>
            setSignals([
              ...signals,
              {
                id: crypto.randomUUID(),
                title: "",
                description: "",
                kind: "other",
                classification: "hypothesis",
                sourceUrl: null,
                observedAt: null,
              },
            ])
          }
        >
          <Plus size={14} aria-hidden="true" />
          {t.contextFields.addSignal}
        </button>
      </div>
      {signals.map((signal, index) => (
        <fieldset key={signal.id} className="context-editor-card">
          <legend>
            {t.contextFields.signal} {index + 1}
          </legend>
          <label>
            {t.contextFields.title}
            <input
              required
              maxLength={200}
              value={signal.title}
              onChange={(event) =>
                updateSignal(signal.id, { title: event.target.value })
              }
            />
          </label>
          <label>
            {t.contextFields.description}
            <textarea
              rows={3}
              maxLength={10000}
              value={signal.description}
              onChange={(event) =>
                updateSignal(signal.id, { description: event.target.value })
              }
            />
          </label>
          <div className="context-form-row">
            <label>
              {t.contextFields.kind}
              <select
                value={signal.kind}
                onChange={(event) =>
                  updateSignal(signal.id, {
                    kind: event.target.value as RelationshipSignal["kind"],
                  })
                }
              >
                {signalKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {t.contextFields.kinds[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.contextFields.classification}
              <select
                value={signal.classification}
                onChange={(event) =>
                  updateSignal(signal.id, {
                    classification: event.target
                      .value as RelationshipSignal["classification"],
                  })
                }
              >
                <option value="hypothesis">{t.hypothesis}</option>
                <option value="fact">{t.fact}</option>
              </select>
            </label>
          </div>
          <label>
            {t.contextFields.sourceUrl}
            <input
              type="url"
              maxLength={2000}
              placeholder={t.contextFields.urlPlaceholder}
              value={signal.sourceUrl ?? ""}
              onChange={(event) =>
                updateSignal(signal.id, {
                  sourceUrl: event.target.value || null,
                })
              }
            />
          </label>
          <label>
            {t.contextFields.observedDate}
            <input
              type="datetime-local"
              step="0.001"
              aria-invalid={
                invalidDate(`signal:${signal.id}`, true) || undefined
              }
              aria-describedby={
                invalidDate(`signal:${signal.id}`, true)
                  ? `context-signal-date-error-${signal.id}`
                  : undefined
              }
              value={
                dateDrafts[`signal:${signal.id}`] ??
                (signal.observedAt
                  ? zonedInputValue(signal.observedAt, timeZone, true)
                  : "")
              }
              onChange={(event) => {
                const value = event.target.value;
                setDateDrafts((current) => ({
                  ...current,
                  [`signal:${signal.id}`]: value,
                }));
                const instant = instantFromZonedInput(value, timeZone);
                if (!value || instant)
                  updateSignal(signal.id, { observedAt: instant || null });
              }}
            />
          </label>
          {invalidDate(`signal:${signal.id}`, true) && (
            <p
              role="alert"
              id={`context-signal-date-error-${signal.id}`}
              className="field-hint"
            >
              {t.contextFields.invalidDatetime}
            </p>
          )}
          <button
            type="button"
            className="small"
            aria-label={`${t.contextFields.removeSignal} ${index + 1}`}
            onClick={() => {
              clearDateDraft(`signal:${signal.id}`);
              setSignals(signals.filter((item) => item.id !== signal.id));
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
            {t.contextFields.remove}
          </button>
        </fieldset>
      ))}
      <div className="context-heading">
        <h3>{t.contextFields.customFields}</h3>
        <button
          type="button"
          className="small"
          disabled={fields.length >= 50}
          onClick={() =>
            setFields([
              ...fields,
              { id: crypto.randomUUID(), label: "", type: "text", value: "" },
            ])
          }
        >
          <Plus size={14} aria-hidden="true" />
          {t.contextFields.addField}
        </button>
      </div>
      {fields.map((field, index) => (
        <fieldset key={field.id} className="context-editor-card">
          <legend>
            {t.contextFields.field} {index + 1}
          </legend>
          <label>
            {t.name}
            <input
              required
              maxLength={100}
              value={field.label}
              onChange={(event) =>
                updateField(field.id, { label: event.target.value })
              }
            />
          </label>
          <label>
            {t.contextFields.fieldType}
            <select
              value={field.type}
              onChange={(event) => {
                clearDateDraft(`field:${field.id}`);
                updateField(field.id, {
                  type: event.target.value as FieldDraft["type"],
                  value: event.target.value === "boolean" ? "false" : "",
                });
              }}
            >
              {fieldKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {t.contextFields.fieldTypes[kind]}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`context-field-${field.id}`}>
            {t.contextFields.value}
            {field.type === "boolean" ? (
              <select
                id={`context-field-${field.id}`}
                value={field.value}
                onChange={(event) =>
                  updateField(field.id, { value: event.target.value })
                }
              >
                <option value="true">{t.contextFields.yes}</option>
                <option value="false">{t.contextFields.no}</option>
              </select>
            ) : (
              <input
                id={`context-field-${field.id}`}
                required={field.type !== "text"}
                type={
                  field.type === "datetime"
                    ? "datetime-local"
                    : field.type === "text"
                      ? "text"
                      : field.type
                }
                step={
                  field.type === "number"
                    ? "any"
                    : field.type === "datetime"
                      ? "0.001"
                      : undefined
                }
                maxLength={field.type === "url" ? 2000 : 10000}
                aria-invalid={
                  (field.type === "datetime" &&
                    invalidDate(`field:${field.id}`)) ||
                  undefined
                }
                aria-describedby={
                  field.type === "datetime" && invalidDate(`field:${field.id}`)
                    ? `context-field-date-error-${field.id}`
                    : undefined
                }
                value={
                  field.type === "datetime"
                    ? (dateDrafts[`field:${field.id}`] ??
                      zonedInputValue(field.value, timeZone, true))
                    : field.value
                }
                onChange={(event) => {
                  const value = event.target.value;
                  if (field.type !== "datetime") {
                    updateField(field.id, { value });
                    return;
                  }
                  setDateDrafts((current) => ({
                    ...current,
                    [`field:${field.id}`]: value,
                  }));
                  const instant = instantFromZonedInput(value, timeZone);
                  if (instant) updateField(field.id, { value: instant });
                }}
              />
            )}
          </label>
          {field.type === "datetime" && invalidDate(`field:${field.id}`) && (
            <p
              role="alert"
              id={`context-field-date-error-${field.id}`}
              className="field-hint"
            >
              {t.contextFields.invalidDatetime}
            </p>
          )}
          <button
            type="button"
            className="small"
            aria-label={`${t.contextFields.removeField} ${index + 1}`}
            onClick={() => {
              clearDateDraft(`field:${field.id}`);
              setFields(fields.filter((item) => item.id !== field.id));
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
            {t.contextFields.remove}
          </button>
        </fieldset>
      ))}
    </RecordDialog>
  );
}
