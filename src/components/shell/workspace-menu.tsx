"use client";
import t from "@crm/i18n/translations/en.json";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Organization } from "../client-api";

export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

const menuWidth = 256;
const viewportGap = 8;

function layerFor(trigger: HTMLElement | null) {
  return trigger?.closest<HTMLElement>('[aria-modal="true"]') ?? document.body;
}

function anchoredTo(trigger: HTMLElement) {
  const rect = trigger.getBoundingClientRect();
  return {
    top: rect.bottom + 4,
    left: Math.max(
      viewportGap,
      Math.min(rect.left, window.innerWidth - menuWidth - viewportGap),
    ),
  };
}

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
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const labelId = useId();
  const current = organizations.find((org) => org.id === organizationId);
  const name = current?.name ?? t.workspace;
  function close(restoreFocus: boolean) {
    setOpen(false);
    setLayer(null);
    if (restoreFocus) trigger.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current) return;
      const target = layerFor(trigger.current);
      setLayer(target);
      setPosition(anchoredTo(trigger.current));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  useEffect(() => {
    if (!open || !layer) return;
    (
      menu.current?.querySelector<HTMLElement>("[aria-checked=true]") ??
      menu.current?.querySelector<HTMLElement>("[role^=menuitem]")
    )?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !popupRef.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, layer]);
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const items = [
      ...(menu.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ??
        []),
    ];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  }
  const floating = layer !== null && layer === document.body;
  const popup = (
    <div
      ref={popupRef}
      className="menu"
      style={
        floating
          ? {
              position: "fixed",
              top: `${position.top}px`,
              left: `${position.left}px`,
            }
          : { position: "absolute", top: "calc(100% + 4px)", left: 0 }
      }
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
      <div className="menu-label" id={labelId}>
        {t.organizations}
      </div>
      <div
        ref={menu}
        id={menuId}
        role="menu"
        aria-labelledby={labelId}
        tabIndex={-1}
        onKeyDown={navigate}
      >
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
        <hr className="menu-separator" />
        <a className="menu-item" role="menuitem" href="/onboarding">
          <Plus size={14} aria-hidden />
          <span className="menu-item-label">{t.createWorkspace}</span>
        </a>
      </div>
    </div>
  );
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
      {open && layer && (floating ? createPortal(popup, layer) : popup)}
    </div>
  );
}
