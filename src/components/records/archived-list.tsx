"use client";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";

export function ArchivedList({
  records,
}: {
  records: { id: string; name: string; detail: string; href: string }[];
}) {
  if (!records.length) return null;
  return (
    <details className="archived-list">
      <summary>
        {t.archivedRecords}
        <span>{records.length}</span>
      </summary>
      <ul>
        {records.map((record) => (
          <li key={record.id}>
            <Link href={record.href} className="text-button">
              {record.name}
            </Link>
            {record.detail && <small>{record.detail}</small>}
          </li>
        ))}
      </ul>
    </details>
  );
}
