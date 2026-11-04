import t from "@crm/i18n/translations/en.json";
import { RecordText } from "./record-text";

/** This history contains only product-shared relationship data. */
export function MergeHistory({
  entries,
}: {
  entries: Record<string, unknown>[];
}) {
  if (!entries.length) return null;
  return (
    <details className="record-section">
      <summary>{t.mergeHistoryTitle}</summary>
      <p className="muted">{t.mergeHistoryHint}</p>
      {entries.map((entry) => (
        <article key={`${String(entry.id)}-${String(entry.mergedAt)}`}>
          <HistoryValue value={entry} />
        </article>
      ))}
    </details>
  );
}

function HistoryValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "")
    return <span>—</span>;
  if (Array.isArray(value))
    return (
      <ol>
        {value.map((item, index) => (
          <li
            key={
              typeof item === "object" && item && "id" in item
                ? String(item.id)
                : String(index)
            }
          >
            <HistoryValue value={item} />
          </li>
        ))}
      </ol>
    );
  if (typeof value === "object")
    return (
      <dl>
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt>
              {t.mergeHistoryFields[key as keyof typeof t.mergeHistoryFields] ??
                key}
            </dt>
            <dd>
              <HistoryValue value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return (
    <RecordText
      value={
        typeof value === "boolean"
          ? value
            ? t.contextFields.yes
            : t.contextFields.no
          : String(value)
      }
    />
  );
}
