"use client";
import t from "@crm/i18n/translations/en.json";
import { ChevronsUpDown, Keyboard, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { browserNavigation, errorText, requestJson } from "../client-api";
import { sectionPath } from "../routes";
import { initials, layerFor } from "./workspace-menu";

const menuWidth = 224;
const viewportGap = 8;

export async function signOut(demo: boolean) {
  if (!demo)
    await requestJson("/api/auth/sign-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  browserNavigation.assign("/sign-in");
}

export function UserMenu({
  name,
  detail,
  demo,
  onShortcuts,
  onNavigate,
  onError,
}: {
  name: string;
  detail: string;
  demo: boolean;
  onShortcuts: () => void;
  onNavigate: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ bottom: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const menuId = useId();
  function close(restoreFocus: boolean) {
    setOpen(false);
    setLayer(null);
    if (restoreFocus) trigger.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      setLayer(layerFor(trigger.current));
      setPosition({
        bottom: window.innerHeight - rect.top + 4,
        left: Math.max(
          viewportGap,
          Math.min(rect.left, window.innerWidth - menuWidth - viewportGap),
        ),
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  useEffect(() => {
    if (!open || !layer) return;
    popup.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !popup.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, layer]);
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const items = [
      ...(popup.current?.querySelectorAll<HTMLElement>(
        "[role=menuitem]:not(:disabled)",
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
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  }
  const floating = layer !== null && layer === document.body;
  const menu = (
    <div
      ref={popup}
      className="menu user-menu"
      style={
        floating
          ? {
              position: "fixed",
              bottom: `${position.bottom}px`,
              left: `${position.left}px`,
            }
          : { position: "absolute", bottom: "calc(100% + 4px)", left: 0 }
      }
    >
      <div className="menu-identity">
        <span className="avatar" aria-hidden>
          {initials(name)}
        </span>
        <span>
          <span className="menu-identity-name">{name}</span>
          <small>{detail}</small>
        </span>
      </div>
      <hr className="menu-separator" />
      <div
        id={menuId}
        role="menu"
        aria-label={t.account}
        tabIndex={-1}
        onKeyDown={navigate}
      >
        <Link
          className="menu-item"
          role="menuitem"
          href={sectionPath("settings")}
          onClick={() => {
            close(false);
            onNavigate();
          }}
        >
          <Settings size={14} aria-hidden />
          <span className="menu-item-label">{t.preferences}</span>
        </Link>
        <button
          type="button"
          className="menu-item"
          role="menuitem"
          onClick={() => {
            close(false);
            onShortcuts();
          }}
        >
          <Keyboard size={14} aria-hidden />
          <span className="menu-item-label">{t.keyboardHelp}</span>
        </button>
        <hr className="menu-separator" />
        <button
          type="button"
          className="menu-item"
          role="menuitem"
          disabled={leaving}
          onClick={async () => {
            setLeaving(true);
            try {
              await signOut(demo);
            } catch (error) {
              setLeaving(false);
              close(true);
              onError(errorText(error));
            }
          }}
        >
          <LogOut size={14} aria-hidden />
          <span className="menu-item-label">
            {leaving ? t.signingOut : t.signOut}
          </span>
        </button>
      </div>
    </div>
  );
  return (
    <div className="user-menu-anchor">
      <button
        ref={trigger}
        type="button"
        className="ghost user-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${t.account}: ${name}`}
        title={name}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span className="avatar" aria-hidden>
          {initials(name)}
        </span>
        <span className="workspace-name nav-label-text">{name}</span>
        <ChevronsUpDown size={13} aria-hidden className="nav-label-text" />
      </button>
      {open && layer && (floating ? createPortal(menu, layer) : menu)}
    </div>
  );
}
