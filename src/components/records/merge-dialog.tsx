"use client";
import t from "@crm/i18n/translations/en.json";
import { ArrowLeftRight, Check, GitMerge } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useCrm } from "../crm/crm-context";
import { useModalLifecycle } from "../modal-lifecycle";
import { companyPath, personPath } from "../routes";

type Entity = "person" | "company";

interface FieldComparison {
  key: string;
  label: string;
  targetVal: string | boolean;
  sourceVal: string | boolean;
  targetDisplay: string;
  sourceDisplay: string;
}

export function MergeDialog({
  entity,
  initialTargetId,
  onClose,
}: {
  entity: Entity;
  initialTargetId: string;
  onClose: () => void;
}) {
  const crm = useCrm();
  const modal = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useModalLifecycle(modal);

  const [targetId, setTargetId] = useState(initialTargetId);
  const [sourceId, setSourceId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldChoices, setFieldChoices] = useState<
    Record<string, "target" | "source">
  >({});

  const data = crm.sourceData;
  const companies = data?.companies ?? [];

  const targetPerson =
    entity === "person"
      ? data?.people.find((p) => p.id === targetId)
      : undefined;
  const targetCompany =
    entity === "company"
      ? data?.companies.find((c) => c.id === targetId)
      : undefined;

  const candidates =
    entity === "person"
      ? (data?.people.filter((p) => p.id !== targetId) ?? [])
      : (data?.companies.filter((c) => c.id !== targetId) ?? []);

  const filteredCandidates = candidates.filter((item) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    if (entity === "person") {
      const p = item as (typeof candidates)[number] & { email?: string | null };
      return (
        p.name.toLowerCase().includes(term) ||
        (p.email?.toLowerCase().includes(term) ?? false)
      );
    }
    const c = item as (typeof candidates)[number] & { domain?: string | null };
    return (
      c.name.toLowerCase().includes(term) ||
      (c.domain?.toLowerCase().includes(term) ?? false)
    );
  });

  const sourcePerson =
    entity === "person"
      ? data?.people.find((p) => p.id === sourceId)
      : undefined;
  const sourceCompany =
    entity === "company"
      ? data?.companies.find((c) => c.id === sourceId)
      : undefined;

  const targetRecord = targetPerson ?? targetCompany;
  const sourceRecord = sourcePerson ?? sourceCompany;

  function swapCanonical() {
    if (!sourceId) return;
    const newTarget = sourceId;
    const newSource = targetId;
    setTargetId(newTarget);
    setSourceId(newSource);
    setFieldChoices({});
  }

  const comparisons: FieldComparison[] = [];

  if (entity === "person" && targetPerson && sourcePerson) {
    const targetCompName =
      companies.find((c) => c.id === targetPerson.companyId)?.name ?? "";
    const sourceCompName =
      companies.find((c) => c.id === sourcePerson.companyId)?.name ?? "";

    comparisons.push(
      {
        key: "name",
        label: t.name,
        targetVal: targetPerson.name,
        sourceVal: sourcePerson.name,
        targetDisplay: targetPerson.name || "—",
        sourceDisplay: sourcePerson.name || "—",
      },
      {
        key: "title",
        label: t.roleTitle,
        targetVal: targetPerson.title,
        sourceVal: sourcePerson.title,
        targetDisplay: targetPerson.title || "—",
        sourceDisplay: sourcePerson.title || "—",
      },
      {
        key: "email",
        label: t.email,
        targetVal: targetPerson.email ?? "",
        sourceVal: sourcePerson.email ?? "",
        targetDisplay: targetPerson.email || "—",
        sourceDisplay: sourcePerson.email || "—",
      },
      {
        key: "otherEmails",
        label: t.otherEmails,
        targetVal: targetPerson.otherEmails.join(", "),
        sourceVal: sourcePerson.otherEmails.join(", "),
        targetDisplay: targetPerson.otherEmails.join(", ") || "—",
        sourceDisplay: sourcePerson.otherEmails.join(", ") || "—",
      },
      {
        key: "phone",
        label: t.phone,
        targetVal: targetPerson.phone,
        sourceVal: sourcePerson.phone,
        targetDisplay: targetPerson.phone || "—",
        sourceDisplay: sourcePerson.phone || "—",
      },
      {
        key: "linkedinUrl",
        label: t.linkedinUrl,
        targetVal: targetPerson.linkedinUrl,
        sourceVal: sourcePerson.linkedinUrl,
        targetDisplay: targetPerson.linkedinUrl || "—",
        sourceDisplay: sourcePerson.linkedinUrl || "—",
      },
      {
        key: "companyId",
        label: t.company,
        targetVal: targetPerson.companyId ?? "",
        sourceVal: sourcePerson.companyId ?? "",
        targetDisplay: targetCompName || "—",
        sourceDisplay: sourceCompName || "—",
      },
      {
        key: "summary",
        label: t.summary,
        targetVal: targetPerson.summary,
        sourceVal: sourcePerson.summary,
        targetDisplay: targetPerson.summary || "—",
        sourceDisplay: sourcePerson.summary || "—",
      },
      {
        key: "doNotContact",
        label: t.doNotContact,
        targetVal: targetPerson.doNotContact,
        sourceVal: sourcePerson.doNotContact,
        targetDisplay: targetPerson.doNotContact
          ? t.markedDoNotContact
          : t.contactAllowed,
        sourceDisplay: sourcePerson.doNotContact
          ? t.markedDoNotContact
          : t.contactAllowed,
      },
    );
  } else if (entity === "company" && targetCompany && sourceCompany) {
    comparisons.push(
      {
        key: "name",
        label: t.name,
        targetVal: targetCompany.name,
        sourceVal: sourceCompany.name,
        targetDisplay: targetCompany.name || "—",
        sourceDisplay: sourceCompany.name || "—",
      },
      {
        key: "domain",
        label: t.domain,
        targetVal: targetCompany.domain ?? "",
        sourceVal: sourceCompany.domain ?? "",
        targetDisplay: targetCompany.domain || "—",
        sourceDisplay: sourceCompany.domain || "—",
      },
      {
        key: "description",
        label: t.description,
        targetVal: targetCompany.description,
        sourceVal: sourceCompany.description,
        targetDisplay: targetCompany.description || "—",
        sourceDisplay: sourceCompany.description || "—",
      },
    );
  }

  async function handleMerge() {
    if (!targetRecord || !sourceRecord) return;
    setBusy(true);
    setError("");

    try {
      const payload: Record<string, unknown> = {
        operation: "merge-records",
        organizationId: crm.organizationId,
        entity,
        targetId: targetRecord.id,
        targetVersion: targetRecord.version,
        sourceId: sourceRecord.id,
        sourceVersion: sourceRecord.version,
      };

      if (entity === "person" && targetPerson && sourcePerson) {
        for (const comp of comparisons) {
          const choice =
            fieldChoices[comp.key] ??
            (comp.targetVal ? "target" : comp.sourceVal ? "source" : "target");
          if (choice === "source") {
            if (comp.key === "name") payload.name = sourcePerson.name;
            else if (comp.key === "title") payload.title = sourcePerson.title;
            else if (comp.key === "email") payload.email = sourcePerson.email;
            else if (comp.key === "otherEmails")
              payload.otherEmails = sourcePerson.otherEmails;
            else if (comp.key === "phone") payload.phone = sourcePerson.phone;
            else if (comp.key === "linkedinUrl")
              payload.linkedinUrl = sourcePerson.linkedinUrl;
            else if (comp.key === "companyId")
              payload.companyId = sourcePerson.companyId;
            else if (comp.key === "summary")
              payload.summary = sourcePerson.summary;
            else if (comp.key === "doNotContact")
              payload.doNotContact = sourcePerson.doNotContact;
          } else {
            if (comp.key === "name") payload.name = targetPerson.name;
            else if (comp.key === "title") payload.title = targetPerson.title;
            else if (comp.key === "email") payload.email = targetPerson.email;
            else if (comp.key === "otherEmails")
              payload.otherEmails = targetPerson.otherEmails;
            else if (comp.key === "phone") payload.phone = targetPerson.phone;
            else if (comp.key === "linkedinUrl")
              payload.linkedinUrl = targetPerson.linkedinUrl;
            else if (comp.key === "companyId")
              payload.companyId = targetPerson.companyId;
            else if (comp.key === "summary")
              payload.summary = targetPerson.summary;
            else if (comp.key === "doNotContact")
              payload.doNotContact = targetPerson.doNotContact;
          }
        }
      } else if (entity === "company" && targetCompany && sourceCompany) {
        for (const comp of comparisons) {
          const choice =
            fieldChoices[comp.key] ??
            (comp.targetVal ? "target" : comp.sourceVal ? "source" : "target");
          if (choice === "source") {
            if (comp.key === "name") payload.name = sourceCompany.name;
            else if (comp.key === "domain")
              payload.domain = sourceCompany.domain;
            else if (comp.key === "description")
              payload.description = sourceCompany.description;
          } else {
            if (comp.key === "name") payload.name = targetCompany.name;
            else if (comp.key === "domain")
              payload.domain = targetCompany.domain;
            else if (comp.key === "description")
              payload.description = targetCompany.description;
          }
        }
      }

      const result = await crm.send(payload, t.recordsMerged, false);
      if (result.ok) {
        onClose();
        if (entity === "person") {
          crm.go(personPath(targetRecord.id));
        } else {
          crm.go(companyPath(targetRecord.id));
        }
      } else {
        setError(result.error ?? t.errors.INTERNAL_ERROR);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={modal}
      className="dialog merge-dialog"
      aria-labelledby={titleId}
    >
      <div className="merge-dialog-content">
        <div className="merge-dialog-header">
          <h2 id={titleId}>
            <GitMerge size={20} aria-hidden />
            {entity === "person" ? t.mergePerson : t.mergeCompany}
          </h2>
          <p className="muted">{t.mergeRecordsSubtitle}</p>
        </div>

        {!sourceRecord ? (
          <div className="merge-select-step">
            <label>
              {t.selectDuplicateRecord}
              <input
                type="search"
                placeholder={t.searchRecordPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </label>
            <div className="candidate-list">
              {filteredCandidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="candidate-item"
                  onClick={() => setSourceId(c.id)}
                >
                  <span className="candidate-name">{c.name}</span>
                  <span className="candidate-detail muted">
                    {entity === "person"
                      ? (c as typeof c & { email?: string | null }).email ||
                        (c as typeof c & { title?: string }).title ||
                        ""
                      : (c as typeof c & { domain?: string | null }).domain ||
                        ""}
                  </span>
                </button>
              ))}
              {filteredCandidates.length === 0 && (
                <p className="muted empty-candidates">{t.noResults}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="merge-review-step">
            <div className="merge-records-header">
              <div className="record-header-card canonical">
                <span className="badge canonical-badge">
                  {t.canonicalRecord}
                </span>
                <h3>{targetRecord?.name}</h3>
              </div>
              <button
                type="button"
                className="button swap-button"
                title={t.swapCanonical}
                onClick={swapCanonical}
                disabled={busy}
              >
                <ArrowLeftRight size={16} aria-hidden />
                {t.swapCanonical}
              </button>
              <div className="record-header-card duplicate">
                <span className="badge duplicate-badge">
                  {t.duplicateRecord}
                </span>
                <h3>{sourceRecord?.name}</h3>
                <button
                  type="button"
                  className="link-button change-candidate-btn"
                  onClick={() => setSourceId("")}
                  disabled={busy}
                >
                  {t.edit}
                </button>
              </div>
            </div>

            <div className="field-comparisons-table">
              {comparisons.map((comp) => {
                const isConflict =
                  String(comp.targetVal).trim() !==
                  String(comp.sourceVal).trim();
                const defaultChoice = comp.targetVal
                  ? "target"
                  : comp.sourceVal
                    ? "source"
                    : "target";
                const currentChoice = fieldChoices[comp.key] ?? defaultChoice;

                return (
                  <div
                    key={comp.key}
                    className={`comparison-row ${isConflict ? "conflict" : ""}`}
                  >
                    <div className="field-label">
                      <span>{comp.label}</span>
                      {isConflict && (
                        <span className="conflict-tag">
                          {t.mergeFieldConflict}
                        </span>
                      )}
                    </div>
                    <div className="field-options">
                      <button
                        type="button"
                        className={`field-option target ${currentChoice === "target" ? "selected" : ""}`}
                        onClick={() =>
                          setFieldChoices((prev) => ({
                            ...prev,
                            [comp.key]: "target",
                          }))
                        }
                        disabled={busy}
                      >
                        {currentChoice === "target" && (
                          <Check size={14} aria-hidden />
                        )}
                        <span className="option-value">
                          {comp.targetDisplay}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`field-option source ${currentChoice === "source" ? "selected" : ""}`}
                        onClick={() =>
                          setFieldChoices((prev) => ({
                            ...prev,
                            [comp.key]: "source",
                          }))
                        }
                        disabled={busy}
                      >
                        {currentChoice === "source" && (
                          <Check size={14} aria-hidden />
                        )}
                        <span className="option-value">
                          {comp.sourceDisplay}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="callout merge-notice" role="note">
              <p>{t.mergeNotice}</p>
            </div>
          </div>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {t.cancel}
          </button>
          {sourceRecord && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={handleMerge}
            >
              {busy ? t.saving : t.mergeSubmit}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
