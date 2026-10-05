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
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { ShortcutHint } from "../ui/shortcut-hint";

const focusableSelector =
  "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

function focusableIn(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) =>
      !element.closest("[hidden], [inert]") &&
      (typeof element.checkVisibility !== "function" ||
        element.checkVisibility()),
  );
}

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
      : [item.label, item.hint].filter(Boolean).join(" · "),
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
      {item.hint && !collapsed && (
        <ShortcutHint
          keys={item.hint}
          className="nav-shortcut nav-label-text"
        />
      )}
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
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (drawerOpen && panel.current) focusableIn(panel.current)[0]?.focus();
  }, [drawerOpen]);
  function trapFocus(event: KeyboardEvent<HTMLElement>) {
    if (!drawerOpen || !panel.current) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCloseDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = focusableIn(panel.current);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  return (
    <aside
      ref={panel}
      className="sidebar"
      id="navigation-panel"
      data-drawer={drawerOpen ? "open" : "closed"}
      {...(drawerOpen
        ? {
            role: "dialog",
            "aria-modal": true,
            "aria-label": t.navigationDrawer,
          }
        : {})}
      onKeyDown={trapFocus}
    >
      <div className="sidebar-top">
        {workspace}
        <button
          type="button"
          className="ghost icon-button sidebar-collapse"
          aria-label={t.toggleSidebar}
          aria-expanded={!collapsed}
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
        <ShortcutHint className="nav-label-text" keys={t.keys.commands} />
      </button>
      <nav className="sidebar-nav" aria-label={t.mainNavigation}>
        <div className="sidebar-scroll">
          {groups.map((group) => (
            <Section key={group.id} group={group} collapsed={collapsed} />
          ))}
        </div>
        <div className="sidebar-pinned">
          {pinned.map((item) => (
            <NavItem key={item.id} item={item} collapsed={collapsed} />
          ))}
        </div>
      </nav>
      {footer && <div className="sidebar-footer">{footer}</div>}
    </aside>
  );
}
