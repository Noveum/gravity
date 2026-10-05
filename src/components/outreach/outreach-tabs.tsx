"use client";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { type OutreachTab, outreachPath, outreachTabs } from "../routes";

export function OutreachTabs({
  tab,
  counts,
}: {
  tab: OutreachTab;
  counts: Partial<Record<OutreachTab, number>>;
}) {
  const nav = useRef<HTMLElement>(null);
  const shown = useRef<OutreachTab | null>(null);
  useLayoutEffect(() => {
    const bar = nav.current;
    const current = bar?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!bar || !current || shown.current === tab) return;
    shown.current = tab;
    const left = current.offsetLeft;
    const right = left + current.offsetWidth;
    if (left < bar.scrollLeft) bar.scrollLeft = left;
    else if (right > bar.scrollLeft + bar.clientWidth)
      bar.scrollLeft = right - bar.clientWidth;
  });
  return (
    <nav ref={nav} aria-label={t.outreachTabsLabel} className="outreach-tabs">
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
