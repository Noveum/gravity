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
export function RecordText({ value }: { value: string }) {
  const { summary, source } = splitRecordText(value);
  return (
    <>
      {summary && <p className="context-summary">{summary}</p>}
      {source && (
        <details className="source-details">
          <summary>{t.importedSourceData}</summary>
          <pre>{source}</pre>
        </details>
      )}
    </>
  );
}
