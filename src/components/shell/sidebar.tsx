"use client";
import t from "@crm/i18n/translations/en.json";
import {
  ChevronRight,
  type LucideIcon,
  PanelLeft,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";

export interface SidebarItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  dot?: string;
  count?: number;
  hint?: string;
  active: boolean;
  kind?: "page" | "view" | "filter";
  href?: string;
  onSelect: () => void;
}
export interface SidebarGroup {
  id: string;
  title: string;
  items: SidebarItem[];
}

function NavItem({
  item,
  collapsed,
}: {
  item: SidebarItem;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  const shared = {
    className: "nav-item",
    "data-nav-item": item.id,
    "aria-label": collapsed ? item.label : undefined,
    title: collapsed
      ? [item.label, item.hint].filter(Boolean).join(" ")
      : item.hint || undefined,
    onClick: item.onSelect,
  };
  const content = (
    <>
      {Icon ? (
        <Icon size={15} strokeWidth={1.75} aria-hidden className="nav-icon" />
      ) : (
        <span className="nav-dot-slot" aria-hidden>
          <span
            className="product-dot"
            style={item.dot ? { background: item.dot } : undefined}
          />
        </span>
      )}
      <span className="nav-label-text">{item.label}</span>
      {item.count !== undefined && (
        <span className="nav-count nav-label-text">{item.count}</span>
      )}
    </>
  );
  if (item.href)
    return (
      <Link
        href={item.href}
        aria-current={
          item.active ? (item.kind === "view" ? "true" : "page") : undefined
        }
        {...shared}
      >
        {content}
      </Link>
    );
  return (
    <button type="button" aria-pressed={item.active} {...shared}>
      {content}
    </button>
  );
}

function Section({
  group,
  collapsed,
}: {
  group: SidebarGroup;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(true);
  if (!group.items.length) return null;
  const listId = `sidebar-section-${group.id}`;
  return (
    <div className="sidebar-section" data-section={group.id}>
      <button
        type="button"
        className="sidebar-section-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{group.title}</span>
        <ChevronRight size={12} aria-hidden className="section-chevron" />
      </button>
      <div
        id={listId}
        className="sidebar-section-items"
        hidden={!open && !collapsed}
      >
        {group.items.map((item) => (
          <NavItem key={item.id} item={item} collapsed={collapsed} />
        ))}
      </div>
    </div>
  );
}

export function Sidebar({
  groups,
  pinned,
  workspace,
  footer,
  collapsed,
  drawerOpen,
  onToggleCollapsed,
  onCloseDrawer,
  onSearch,
}: {
  groups: SidebarGroup[];
  pinned: SidebarItem[];
  workspace: ReactNode;
  footer?: ReactNode;
  collapsed: boolean;
  drawerOpen: boolean;
  onToggleCollapsed: () => void;
  onCloseDrawer: () => void;
  onSearch: () => void;
}) {
  return (
    <aside
      className="sidebar"
      id="navigation-panel"
      data-drawer={drawerOpen ? "open" : "closed"}
    >
      <div className="sidebar-top">
        {workspace}
        <button
          type="button"
          className="ghost icon-button sidebar-collapse"
          aria-label={t.toggleSidebar}
          aria-expanded={!collapsed}
          aria-controls="navigation-panel"
          aria-keyshortcuts="["
          title={`${t.toggleSidebar} [`}
          onClick={onToggleCollapsed}
        >
          <PanelLeft size={15} aria-hidden />
        </button>
        <button
          type="button"
          className="ghost icon-button sidebar-close"
          aria-label={t.closeNavigation}
          onClick={onCloseDrawer}
        >
          <X size={17} aria-hidden />
        </button>
      </div>
      <button
        type="button"
        className="sidebar-search"
        aria-label={collapsed ? t.searchShort : undefined}
        title={collapsed ? t.searchShort : undefined}
        onClick={onSearch}
      >
        <Search size={14} aria-hidden />
        <span className="nav-label-text">{t.searchShort}</span>
        <kbd className="nav-label-text">{t.keys.commandHint}</kbd>
      </button>
      <nav className="sidebar-scroll" aria-label={t.myWork}>
        {groups.map((group) => (
          <Section key={group.id} group={group} collapsed={collapsed} />
        ))}
      </nav>
      <div className="sidebar-bottom">
        {pinned.map((item) => (
          <NavItem key={item.id} item={item} collapsed={collapsed} />
        ))}
        {footer}
      </div>
    </aside>
  );
}
