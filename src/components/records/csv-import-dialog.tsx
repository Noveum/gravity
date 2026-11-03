"use client";
import { detectColumnMapping, parseCsv } from "@crm/core/csv";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useRef, useState } from "react";
import { errorText, requestJson } from "../client-api";
import { useModalLifecycle } from "../modal-lifecycle";
import { Select } from "../ui/select";
import { LoadingState } from "../ui/states";

export type {
  ImportResult as ImportResponse,
  PreviewResult as PreviewResponse,
} from "@crm/core/csv-import";

import type {
  ImportResult as ImportResponse,
  PreviewResult as PreviewResponse,
} from "@crm/core/csv-import";

const issueText = (code: string) =>
  t.csvIssues[code as keyof typeof t.csvIssues] ?? t.errors.INVALID_INPUT;

export const mappingFieldOptions = [
  { value: "ignore", label: t.doNotImport },
  { value: "name", label: t.fieldPersonName },
  { value: "email", label: t.fieldEmail },
  { value: "title", label: t.fieldTitle },
  { value: "phone", label: t.fieldPhone },
  { value: "linkedinUrl", label: t.fieldLinkedin },
  { value: "summary", label: t.fieldSummary },
  { value: "companyName", label: t.fieldCompanyName },
  { value: "companyDomain", label: t.fieldCompanyDomain },
  { value: "companyDescription", label: t.fieldCompanyDescription },
];

export function CsvImportDialog({
  data,
  organizationId,
  productId: defaultProductId,
  onClose,
  onImported,
  initialMode = "contacts",
}: {
  data: ClientSnapshot;
  organizationId: string;
  productId: string;
  onClose: () => void;
  onImported: () => Promise<void>;
  initialMode?: "contacts" | "companies";
}) {
  const modal = useRef<HTMLDialogElement>(null);
  useModalLifecycle(modal);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [productId, setProductId] = useState(
    defaultProductId || data.products[0]?.id || "",
  );
  const [mode, setMode] = useState<"contacts" | "companies">(initialMode);
  const [purpose, setPurpose] = useState<"buyer" | "partner">("buyer");
  const [headers, setHeaders] = useState<string[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>(
    {},
  );
  const [step, setStep] = useState<"upload" | "preview" | "summary">("upload");
  const [previewTab, setPreviewTab] = useState<
    "valid" | "duplicates" | "invalid"
  >("valid");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [summary, setSummary] = useState<ImportResponse | null>(null);

  function readFileText(f: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (typeof f.text === "function") {
        try {
          const res = f.text();
          if (res && typeof res.then === "function") {
            return resolve(res);
          }
        } catch {}
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () =>
        reject(reader.error || new Error("FILE_READ_ERROR"));
      reader.readAsText(f);
    });
  }

  async function handleFileSelect(selectedFile: File) {
    setError("");
    setFile(selectedFile);
    try {
      const text = await readFileText(selectedFile);
      const parsed = parseCsv(text);
      setCsvText(text);
      setHeaders(parsed.headers);
      setTotalRows(parsed.rows.length);
      const detected = detectColumnMapping(parsed.headers);
      setColumnMapping(detected);
    } catch (err) {
      setFile(null);
      setCsvText("");
      setHeaders([]);
      setColumnMapping({});
      setTotalRows(0);
      setError(errorText(err));
    }
  }

  async function runPreview(currentMapping?: Record<string, string>) {
    if (!csvText) {
      setError(t.selectFilePrompt);
      return;
    }
    if (!productId) {
      setError(t.selectProductPrompt);
      return;
    }
    const mapping = currentMapping || columnMapping;
    const hasNameMapping = Object.values(mapping).includes("name");
    if (mode === "contacts" && !hasNameMapping) {
      setError(t.csvRequiredNameMissing);
      return;
    }

    if (
      mode === "companies" &&
      !Object.values(mapping).some(
        (field) => field === "companyName" || field === "companyDomain",
      )
    ) {
      setError(t.csvRequiredCompanyMissing);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await requestJson<PreviewResponse>("/api/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "csv-import-preview",
          organizationId,
          productId,
          csvText,
          columnMapping: mapping,
          purpose,
          mode,
        }),
      });
      setPreview(res);
      setStep("preview");
      if (res.summary.validCount > 0) {
        setPreviewTab("valid");
      } else if (res.summary.duplicateCount > 0) {
        setPreviewTab("duplicates");
      } else {
        setPreviewTab("invalid");
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  async function executeImport(skipDuplicates: boolean) {
    if (!csvText || !productId) return;
    setLoading(true);
    setError("");
    try {
      const res = await requestJson<ImportResponse>("/api/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "csv-import",
          organizationId,
          productId,
          csvText,
          columnMapping,
          purpose,
          mode,
          skipDuplicates,
          label: file?.name || t.importCsv,
        }),
      });
      setSummary(res);
      setStep("summary");
      await onImported();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <dialog
      ref={modal}
      className="dialog import-dialog"
      aria-labelledby="import-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-header">
        <div>
          <h2 id="import-dialog-title">{t.csvImportTitle}</h2>
          <p className="muted">{t.csvImportDescription}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t.close}
          onClick={onClose}
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      {error && (
        <div className="banner error" role="alert">
          <AlertTriangle size={16} aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {loading && <LoadingState />}

      {!loading && step === "upload" && (
        <div className="import-step-upload">
          <div className="import-settings-grid">
            <div className="field">
              <span>{t.csvMode}</span>
              <Select
                label={t.csvMode}
                value={mode}
                options={[
                  { value: "contacts", label: t.csvModeContacts },
                  { value: "companies", label: t.csvModeCompanies },
                ]}
                onChange={(value) => setMode(value as "contacts" | "companies")}
              />
            </div>
            <div className="field">
              <span>{t.selectProduct}</span>
              <Select
                label={t.selectProduct}
                value={productId}
                disabled={data.products.length <= 1}
                options={data.products.map((p) => ({
                  value: p.id,
                  label: p.name,
                }))}
                onChange={setProductId}
              />
            </div>

            {mode === "contacts" && (
              <div className="field">
                <span>{t.relationshipPurpose}</span>
                <Select
                  label={t.relationshipPurpose}
                  value={purpose}
                  options={[
                    { value: "buyer", label: t.purposeBuyer },
                    { value: "partner", label: t.purposePartner },
                  ]}
                  onChange={(val) => setPurpose(val as "buyer" | "partner")}
                />
              </div>
            )}
          </div>

          {file ? (
            <div className="file-drop-zone has-file">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  if (picked) void handleFileSelect(picked);
                }}
              />
              <div className="file-info">
                <FileSpreadsheet size={32} className="accent-icon" />
                <div>
                  <strong>{file.name}</strong>
                  <span className="muted">
                    {t.csvFileSizeRows
                      .replace("{size}", (file.size / 1024).toFixed(1))
                      .replace("{count}", String(totalRows))}
                  </span>
                </div>
                <button
                  type="button"
                  className="chip"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t.changeFile}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="file-drop-zone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dropped = e.dataTransfer.files[0];
                if (dropped) void handleFileSelect(dropped);
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  if (picked) void handleFileSelect(picked);
                }}
              />
              <div className="upload-prompt">
                <Upload size={32} className="muted-icon" />
                <p>
                  <strong>{t.chooseFile}</strong>
                </p>
                <p className="muted">{t.dragCsvHere}</p>
              </div>
            </button>
          )}

          {headers.length > 0 && (
            <div className="mapping-section">
              <h3>{t.mapColumns}</h3>
              <div className="table-scroll" style={{ maxHeight: "240px" }}>
                <table>
                  <thead>
                    <tr>
                      <th>{t.csvColumn}</th>
                      <th>{t.mapsToField}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {headers.map((header) => (
                      <tr key={header}>
                        <td>
                          <code>{header}</code>
                        </td>
                        <td>
                          <Select
                            label={header}
                            value={columnMapping[header] || "ignore"}
                            options={mappingFieldOptions.filter(
                              (option) =>
                                mode === "contacts" ||
                                option.value === "ignore" ||
                                option.value.startsWith("company"),
                            )}
                            onChange={(val) => {
                              setColumnMapping((prev) => ({
                                ...prev,
                                [header]: val,
                              }));
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              {t.cancel}
            </button>
            <button
              type="button"
              className="primary"
              disabled={!file}
              onClick={() => void runPreview()}
            >
              {t.previewCsvImport} <ArrowRight size={14} aria-hidden />
            </button>
          </div>
        </div>
      )}

      {!loading && step === "preview" && preview && (
        <div className="import-step-preview">
          <div className="preview-stat-cards">
            <div className="stat-card">
              <span className="stat-value">{preview.summary.totalRows}</span>
              <span className="stat-label">{t.totalRows}</span>
            </div>
            <div className="stat-card success">
              <span className="stat-value">{preview.summary.validCount}</span>
              <span className="stat-label">{t.validRowsCount}</span>
            </div>
            <div
              className={`stat-card ${preview.summary.duplicateCount > 0 ? "warning" : ""}`}
            >
              <span className="stat-value">
                {preview.summary.duplicateCount}
              </span>
              <span className="stat-label">{t.duplicatesCount}</span>
            </div>
            <div
              className={`stat-card ${preview.summary.invalidCount > 0 ? "danger" : ""}`}
            >
              <span className="stat-value">{preview.summary.invalidCount}</span>
              <span className="stat-label">{t.invalidCount}</span>
            </div>
          </div>

          <div className="tabs">
            <button
              type="button"
              aria-pressed={previewTab === "valid"}
              onClick={() => setPreviewTab("valid")}
            >
              <CheckCircle2 size={14} aria-hidden />
              {t.readyToImport} ({preview.summary.validCount})
            </button>
            <button
              type="button"
              aria-pressed={previewTab === "duplicates"}
              onClick={() => setPreviewTab("duplicates")}
            >
              <AlertTriangle size={14} aria-hidden />
              {t.duplicatesForReview} ({preview.summary.duplicateCount})
            </button>
            <button
              type="button"
              aria-pressed={previewTab === "invalid"}
              onClick={() => setPreviewTab("invalid")}
            >
              <XCircle size={14} aria-hidden />
              {t.invalidRows} ({preview.summary.invalidCount})
            </button>
          </div>

          <div className="preview-tab-content">
            {previewTab === "valid" && (
              <div className="table-scroll" style={{ maxHeight: "280px" }}>
                {preview.validRows.length === 0 ? (
                  <p className="muted empty-cell">{t.csvNoValidRows}</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>{t.rowIndex}</th>
                        <th>{t.name}</th>
                        {mode === "contacts" && <th>{t.email}</th>}
                        <th>
                          {mode === "companies"
                            ? t.fieldCompanyDomain
                            : t.company}
                        </th>
                        {mode === "contacts" && <th>{t.title}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.validRows.slice(0, 100).map((row) => (
                        <tr key={row.rowIndex}>
                          <td>{row.rowIndex}</td>
                          <td>
                            <strong>
                              {mode === "companies"
                                ? row.company?.name || row.company?.domain
                                : row.person.name}
                            </strong>
                          </td>
                          {mode === "contacts" && (
                            <td>{row.person.email || "—"}</td>
                          )}
                          <td>
                            {mode === "companies"
                              ? row.company?.domain || "—"
                              : row.company?.name || row.company?.domain || "—"}
                          </td>
                          {mode === "contacts" && (
                            <td>{row.person.title || "—"}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {preview.validRows.length > 100 && (
                  <p className="muted" style={{ padding: "8px" }}>
                    {t.csvFirstRows.replace(
                      "{count}",
                      String(preview.validRows.length),
                    )}
                  </p>
                )}
              </div>
            )}

            {previewTab === "duplicates" && (
              <div className="duplicates-view">
                <div className="banner warning" role="status">
                  <AlertTriangle size={16} aria-hidden />
                  <span>{t.duplicateReviewNote}</span>
                </div>
                <div className="table-scroll" style={{ maxHeight: "240px" }}>
                  {preview.duplicateRows.length === 0 ? (
                    <p className="muted empty-cell">{t.noDuplicatesFound}</p>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>{t.rowIndex}</th>
                          <th>{t.name}</th>
                          {mode === "contacts" && <th>{t.email}</th>}
                          <th>
                            {mode === "companies"
                              ? t.fieldCompanyDomain
                              : t.company}
                          </th>
                          <th>{t.reason}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.duplicateRows.map((row) => (
                          <tr key={row.rowIndex}>
                            <td>{row.rowIndex}</td>
                            <td>
                              {mode === "companies"
                                ? row.company?.name || row.company?.domain
                                : row.person.name}
                            </td>
                            {mode === "contacts" && (
                              <td>{row.person.email || "—"}</td>
                            )}
                            <td>
                              {mode === "companies"
                                ? row.company?.domain || "—"
                                : row.company?.name ||
                                  row.company?.domain ||
                                  "—"}
                            </td>
                            <td>
                              <ul className="reasons-list">
                                {row.reasons.map((reason) => (
                                  <li key={reason.code}>
                                    <span className="import-badge warning">
                                      {issueText(reason.code)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {previewTab === "invalid" && (
              <div className="invalid-view">
                <div className="table-scroll" style={{ maxHeight: "280px" }}>
                  {preview.invalidRows.length === 0 ? (
                    <p className="muted empty-cell">{t.noInvalidRows}</p>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>{t.rowIndex}</th>
                          <th>{t.importReason}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.invalidRows.map((row) => (
                          <tr key={row.rowIndex}>
                            <td>{row.rowIndex}</td>
                            <td>
                              <ul className="reasons-list">
                                {row.errors.map((err) => (
                                  <li key={issueText(err)}>
                                    <span className="import-badge danger">
                                      {issueText(err)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="dialog-actions">
            <button
              type="button"
              onClick={() => {
                setStep("upload");
              }}
            >
              {t.back}
            </button>
            {preview.summary.duplicateCount > 0 ? (
              <button
                type="button"
                className="primary"
                disabled={preview.summary.validCount === 0}
                onClick={() => void executeImport(true)}
              >
                {mode === "companies"
                  ? t.importValidCompanies
                  : t.importValidContacts}{" "}
                ({preview.summary.validCount})
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                disabled={preview.summary.validCount === 0}
                onClick={() => void executeImport(false)}
              >
                {mode === "companies" ? t.importCompanies : t.importContacts} (
                {preview.summary.validCount})
              </button>
            )}
          </div>
        </div>
      )}

      {!loading && step === "summary" && summary && (
        <div className="import-step-summary">
          <div className="summary-card">
            <CheckCircle2 size={40} className="success-icon" />
            <h3>{t.importSummary}</h3>
            <p className="summary-headline">
              {(mode === "companies"
                ? t.importedCompaniesSuccess
                : t.importedSuccess
              ).replace("{count}", String(summary.importedCount))}
            </p>

            <div className="summary-breakdown">
              <div className="summary-row">
                <span>{t.importedPeople}</span>
                <strong>{summary.peopleCreated}</strong>
              </div>
              <div className="summary-row">
                <span>{t.importedCompanies}</span>
                <strong>{summary.companiesCreated}</strong>
              </div>
              <div className="summary-row">
                <span>{t.skippedDuplicates}</span>
                <strong>{summary.duplicateCount}</strong>
              </div>
              <div className="summary-row">
                <span>{t.invalidCount}</span>
                <strong>{summary.invalidCount}</strong>
              </div>
            </div>
          </div>

          <div className="dialog-actions">
            <button type="button" className="primary" onClick={onClose}>
              {t.close}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
