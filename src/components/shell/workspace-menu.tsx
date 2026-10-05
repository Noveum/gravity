"use client";
import t from "@crm/i18n/translations/en.json";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Organization } from "../client-api";

export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

export function WorkspaceMenu({
  organizations,
  organizationId,
  userName,
  userDetail,
  onSwitch,
}: {
  organizations: Organization[];
  organizationId: string;
  userName: string;
  userDetail: string;
  onSwitch: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const current = organizations.find((org) => org.id === organizationId);
  const name = current?.name ?? t.workspace;
  function close(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    menu.current
      ?.querySelector<HTMLElement>("[aria-checked=true], [role^=menuitem]")
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div className="workspace-menu">
      <button
        ref={trigger}
        type="button"
        className="ghost workspace-trigger"
        data-workspace-trigger
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${t.switchOrganization}: ${name}`}
        title={name}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="workspace-logo" aria-hidden>
          {initials(name)}
        </span>
        <span className="workspace-name nav-label-text">{name}</span>
        <ChevronsUpDown size={13} aria-hidden className="nav-label-text" />
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          className="menu"
          role="menu"
          aria-label={t.organizations}
          tabIndex={-1}
          onKeyDown={(event) => {
            const items = [
              ...(menu.current?.querySelectorAll<HTMLElement>(
                "[role^=menuitem]",
              ) ?? []),
            ];
            const index = items.indexOf(document.activeElement as HTMLElement);
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              items[(index + step + items.length) % items.length]?.focus();
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              items[event.key === "Home" ? 0 : items.length - 1]?.focus();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close(true);
            } else if (event.key === "Tab") close(false);
          }}
        >
          <div className="menu-identity">
            <span className="avatar" aria-hidden>
              {initials(userName)}
            </span>
            <span>
              <span className="menu-identity-name">{userName}</span>
              <small>{userDetail}</small>
            </span>
          </div>
          <hr className="menu-separator" />
          <div className="menu-label">{t.organizations}</div>
          {organizations.map((org) => (
            <button
              key={org.id}
              type="button"
              role="menuitemradio"
              aria-checked={org.id === organizationId}
              className="menu-item"
              onClick={() => {
                close(true);
                if (org.id !== organizationId) onSwitch(org.id);
              }}
            >
              <span className="workspace-logo small" aria-hidden>
                {initials(org.name)}
              </span>
              <span className="menu-item-label">{org.name}</span>
              {org.id === organizationId && <Check size={13} aria-hidden />}
            </button>
          ))}
          <a className="menu-item" role="menuitem" href="/onboarding">
            <Plus size={14} aria-hidden />
            <span className="menu-item-label">{t.createWorkspace}</span>
          </a>
        </div>
      )}
    </div>
  );
}
