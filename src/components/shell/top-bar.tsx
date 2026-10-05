"use client";
import t from "@crm/i18n/translations/en.json";
import { Keyboard, Menu, Search } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { GravityMark } from "../gravity-logo";
import { ThemeToggle } from "../preferences";
import { ShortcutHint } from "../ui/shortcut-hint";
import type { Crumb } from "./navigation";

export function TopBar({
  crumbs,
  onSearch,
  onHelp,
  onOpenNavigation,
}: {
  crumbs: Crumb[];
  onSearch: () => void;
  onHelp: () => void;
  onOpenNavigation: () => void;
}) {
  return (
    <header className="topbar">
      <button
        type="button"
        className="ghost icon-button drawer-trigger"
        aria-label={t.openNavigation}
        onClick={onOpenNavigation}
      >
        <Menu size={17} aria-hidden />
      </button>
      <span className="topbar-brand" title={`${t.brand} · ${t.brandSub}`}>
        <GravityMark size={18} />
        <span className="sr-only">{t.brand}</span>
      </span>
      <nav aria-label={t.breadcrumb} className="breadcrumbs">
        <ol>
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.id}>
              {index > 0 && (
                <li aria-hidden className="crumb-separator">
                  /
                </li>
              )}
              <li className={`crumb crumb-${crumb.id}`}>
                {crumb.heading ? (
                  <h1 tabIndex={-1} className="view-title">
                    {crumb.href ? (
                      <Link href={crumb.href}>{crumb.label}</Link>
                    ) : (
                      crumb.label
                    )}
                  </h1>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </li>
            </Fragment>
          ))}
        </ol>
      </nav>
      <div className="topbar-actions">
        <button
          type="button"
          className="search-pill"
          aria-label={t.searchShort}
          aria-keyshortcuts="Meta+K Control+K"
          onClick={onSearch}
        >
          <Search size={14} aria-hidden />
          <span className="search-pill-label">{t.searchShort}</span>
          <ShortcutHint keys={t.keys.commands} />
        </button>
        <button
          type="button"
          className="ghost keyboard-help-button"
          aria-label={t.keyboardHelp}
          aria-keyshortcuts="Shift+/"
          title={`${t.keyboardHelp} (${t.keys.help})`}
          onClick={onHelp}
        >
          <Keyboard size={15} aria-hidden />
          <ShortcutHint keys={t.keys.help} />
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}
