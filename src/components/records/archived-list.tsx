"use client";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";
import { Pagination, useListPage } from "./list-browser";

export function ArchivedList({
  records,
}: {
  records: { id: string; name: string; detail: string; href: string }[];
}) {
  const page = useListPage(
    records,
    records.map((record) => record.id).join("/"),
  );
  if (!records.length) return null;
  return (
    <details className="archived-list">
      <summary>
        {t.archivedRecords}
        <span>{records.length}</span>
      </summary>
      <ul>
        {page.items.map((record) => (
          <li key={record.id}>
            <Link href={record.href} className="text-button">
              {record.name}
            </Link>
            {record.detail && <small>{record.detail}</small>}
          </li>
        ))}
      </ul>
      <Pagination page={page} />
    </details>
  );
}
