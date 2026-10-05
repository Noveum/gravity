"use client";
import t from "@crm/i18n/translations/en.json";
import { Menu, Search } from "lucide-react";
import { Fragment } from "react";
import { GravityMark } from "../gravity-logo";
import { ThemeToggle } from "../preferences";
import type { Crumb } from "./navigation";

export function TopBar({
  crumbs,
  onSearch,
  onOpenNavigation,
}: {
  crumbs: Crumb[];
  onSearch: () => void;
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
                    {crumb.label}
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
          aria-label={t.commands}
          aria-keyshortcuts="Meta+K Control+K"
          onClick={onSearch}
        >
          <Search size={14} aria-hidden />
          <span className="search-pill-label">{t.searchShort}</span>
          <kbd>{t.keys.commandHint}</kbd>
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}
