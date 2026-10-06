import t from "@crm/i18n/translations/en.json";

export function splitRecordText(value: string) {
  for (
    let index = value.indexOf("{");
    index >= 0;
    index = value.indexOf("{", index + 1)
  ) {
    try {
      const parsed: unknown = JSON.parse(value.slice(index));
      if (parsed && typeof parsed === "object")
        return {
          summary: value.slice(0, index).trim(),
          source: JSON.stringify(parsed, null, 2),
        };
    } catch {}
  }
  return { summary: value, source: "" };
}
export function RecordText({
  value,
  limit = 320,
  title = t.fullNotes,
}: {
  value: string;
  limit?: number;
  title?: string;
}) {
  const { summary, source } = splitRecordText(value);
  const long = summary.length > limit;
  const preview = summary
    .slice(0, limit)
    .replace(/\s+\S*$/, "")
    .trimEnd();
  return (
    <div className="record-text">
      {summary && (
        <p className="context-summary record-text-preview">
          {long ? `${preview || summary.slice(0, limit)}…` : summary}
        </p>
      )}
      {long && (
        <details className="record-text-details">
          <summary>{title}</summary>
          <p className="context-summary">{summary}</p>
        </details>
      )}
      {source && (
        <details className="source-details">
          <summary>{t.importedSourceData}</summary>
          <pre>{source}</pre>
        </details>
      )}
    </div>
  );
}
