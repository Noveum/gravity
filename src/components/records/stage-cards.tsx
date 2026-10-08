"use client";
import t from "@crm/i18n/translations/en.json";
import type { ReactNode } from "react";
import { Pagination, useListPage } from "./list-browser";

export function StageCards<T>({
  rows,
  scope,
  revealId = "",
  children,
}: {
  rows: T[];
  scope: string;
  revealId?: string;
  children: (rows: T[]) => ReactNode;
}) {
  const page = useListPage(rows, scope, revealId);
  return (
    <>
      <div className="stage-cards">
        {children(page.items)}
        {!rows.length && (
          <p className="stage-empty muted">{t.inlineEditing.noStageDeals}</p>
        )}
      </div>
      {page.total > page.size && <Pagination page={page} />}
    </>
  );
}
