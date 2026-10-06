"use client";
import t from "@crm/i18n/translations/en.json";
import { Check } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { initials } from "../shell/workspace-menu";
import { useMenuPosition } from "../ui/menu-position";

export function AssignMenu({
  members,
  current,
  anchor,
  onAssign,
  onClose,
}: {
  members: { id: string; name: string }[];
  current: string;
  anchor: HTMLElement | null;
  onAssign: (id: string) => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const { position, layer } = useMenuPosition(anchor, popup, 256);
  useEffect(() => {
    (
      menu.current?.querySelector<HTMLElement>("[aria-checked=true]") ??
      menu.current?.querySelector<HTMLElement>("[role=menuitemradio]")
    )?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !popup.current?.contains(event.target)
      )
        onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [onClose]);
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const items = [
      ...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ??
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
      onClose();
    }
  }
  return createPortal(
    <div
      ref={popup}
      className="menu assign-menu"
      style={{ ...position, overflowY: "auto" }}
    >
      <div className="menu-label" id={labelId}>
        {t.assignTo}
      </div>
      <div
        ref={menu}
        role="menu"
        aria-labelledby={labelId}
        tabIndex={-1}
        onKeyDown={navigate}
      >
        {members.map((member) => (
          <button
            key={member.id}
            type="button"
            role="menuitemradio"
            aria-checked={member.id === current}
            className="menu-item"
            onClick={() => onAssign(member.id)}
          >
            <span className="row-avatar" aria-hidden>
              {initials(member.name)}
            </span>
            <span className="menu-item-label">{member.name}</span>
            {member.id === current && <Check size={13} aria-hidden />}
          </button>
        ))}
      </div>
    </div>,
    layer ?? document.body,
  );
}
