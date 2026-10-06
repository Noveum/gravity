"use client";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { type SettingsSection, settingsPath } from "../routes";

export function SettingsNav({
  sections,
  current,
}: {
  sections: readonly SettingsSection[];
  current: SettingsSection;
}) {
  const nav = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const bar = nav.current;
    const active = bar?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!bar || !active || bar.scrollWidth <= bar.clientWidth) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < bar.scrollLeft) bar.scrollLeft = left;
    else if (right > bar.scrollLeft + bar.clientWidth)
      bar.scrollLeft = right - bar.clientWidth;
  });
  return (
    <nav ref={nav} aria-label={t.settingsNavigation} className="settings-nav">
      {sections.map((section) => (
        <Link
          key={section}
          href={settingsPath(section)}
          className="settings-nav-link"
          aria-current={section === current ? "page" : undefined}
        >
          {t.settingsSections[section]}
        </Link>
      ))}
    </nav>
  );
}
