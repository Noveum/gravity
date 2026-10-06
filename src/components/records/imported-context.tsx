"use client";
import {
  importedContext,
  safeContextUrl,
} from "@crm/core/relationship-context";
import t from "@crm/i18n/translations/en.json";
import { Download, FileJson } from "lucide-react";
import { useMemo, useState } from "react";

function fieldLabel(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
function ImportedEntries({ value, depth }: { value: object; depth: number }) {
  const [page, setPage] = useState(0);
  const entries = Object.entries(value);
  const start = page * 30;
  return (
    <>
      <dl className="imported-fields">
        {entries.slice(start, start + 30).map(([key, item]) => (
          <div key={key}>
            <dt>{Array.isArray(value) ? Number(key) + 1 : fieldLabel(key)}</dt>
            <dd>
              <ImportedValue value={item} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
      {entries.length > 30 && (
        <div className="source-pagination">
          <button
            type="button"
            className="small"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            {t.contextFields.previousFields}
          </button>
          <span>
            {t.contextFields.page
              .replace("{start}", String(start + 1))
              .replace("{end}", String(Math.min(start + 30, entries.length)))
              .replace("{total}", String(entries.length))}
          </span>
          <button
            type="button"
            className="small"
            disabled={start + 30 >= entries.length}
            onClick={() => setPage(page + 1)}
          >
            {t.contextFields.nextFields}
          </button>
        </div>
      )}
    </>
  );
}
function ImportedValue({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  const [open, setOpen] = useState(false);
  if (value === null)
    return <span className="muted">{t.contextFields.notProvided}</span>;
  if (typeof value === "boolean")
    return <span>{value ? t.contextFields.yes : t.contextFields.no}</span>;
  if (typeof value !== "object") {
    const text = String(value);
    const url = safeContextUrl(text);
    if (url)
      return (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {text}
        </a>
      );
    if (text.length > 800)
      return (
        <details>
          <summary>{text.slice(0, 160)}…</summary>
          <p>{text}</p>
        </details>
      );
    return <span>{text || t.contextFields.notProvided}</span>;
  }
  const count = Object.keys(value).length;
  return (
    <details
      onToggle={(event) => {
        if (event.target === event.currentTarget)
          setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        {Array.isArray(value)
          ? t.contextFields.items
          : t.contextFields.properties}{" "}
        · {count}
      </summary>
      {open &&
        (depth >= 20 ? (
          <p className="muted">{t.contextFields.sourceOverflow}</p>
        ) : (
          <ImportedEntries value={value} depth={depth} />
        ))}
    </details>
  );
}
export function ImportedContext({
  source,
  title = t.contextFields.importedSource,
}: {
  source: string;
  title?: string;
}) {
  const parsed = useMemo(() => importedContext(source), [source]);
  const [open, setOpen] = useState(false);
  return (
    <details
      className="imported-context"
      onToggle={(event) => {
        if (event.target === event.currentTarget)
          setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <FileJson size={14} aria-hidden="true" />
        {title}
      </summary>
      {open && (
        <>
          <p className="muted">{t.contextFields.importedHint}</p>
          {parsed ? (
            <ImportedEntries value={parsed} depth={0} />
          ) : (
            <p className="source-text">
              {source.slice(0, 10000)}
              {source.length > 10000 && t.contextFields.sourceOverflow}
            </p>
          )}
          <button
            type="button"
            className="small"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([source], { type: "text/plain;charset=utf-8" }),
              );
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = "relationship-source.txt";
              anchor.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <Download size={14} aria-hidden="true" />
            {t.contextFields.downloadSource}
          </button>
        </>
      )}
    </details>
  );
}
