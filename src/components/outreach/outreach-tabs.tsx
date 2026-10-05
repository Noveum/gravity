"use client";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";
import { type OutreachTab, outreachPath, outreachTabs } from "../routes";

export function OutreachTabs({
  tab,
  counts,
}: {
  tab: OutreachTab;
  counts: Partial<Record<OutreachTab, number>>;
}) {
  return (
    <nav aria-label={t.outreachTabsLabel} className="outreach-tabs">
      {outreachTabs.map((id) => {
        const count = counts[id];
        return (
          <Link
            key={id}
            href={outreachPath(id)}
            className="outreach-tab"
            aria-current={id === tab ? "page" : undefined}
          >
            {t.outreachTabs[id]}
            {count !== undefined && count > 0 && (
              <span className="outreach-tab-count"> {count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
