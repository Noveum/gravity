"use client";
import t from "@crm/i18n/translations/en.json";
import { Check } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const menuWidth = 240;
const gap = 8;

export interface StageChoice {
  id: string;
  name: string;
  category: keyof typeof t.stageCategory;
}

function placement(anchor: HTMLElement | null) {
  if (!anchor) return { top: 120, left: gap };
  const rect = anchor.getBoundingClientRect();
  return {
    top: Math.max(gap, Math.min(rect.bottom + 4, window.innerHeight - 320)),
    left: Math.max(
      gap,
      Math.min(rect.left, window.innerWidth - menuWidth - gap),
    ),
  };
}

export function StageMenu({
  label,
  stages,
  current,
  anchor,
  onChoose,
  onClose,
}: {
  label: string;
  stages: readonly StageChoice[];
  current: string;
  anchor: HTMLElement | null;
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const position = placement(anchor);
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
    if (["ArrowDown", "ArrowUp", "j", "k"].includes(event.key)) {
      event.preventDefault();
      const step = event.key === "ArrowDown" || event.key === "j" ? 1 : -1;
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
      className="menu stage-menu"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
    >
      <div className="menu-label" aria-hidden>
        {label}
      </div>
      <div
        ref={menu}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={navigate}
      >
        {stages.map((stage) => (
          <button
            key={stage.id}
            type="button"
            role="menuitemradio"
            aria-checked={stage.id === current}
            className="menu-item"
            onClick={() => onChoose(stage.id)}
          >
            <span className="menu-item-label">{stage.name}</span>
            {stage.category !== "open" && (
              <span className="menu-item-hint">
                {t.stageCategory[stage.category]}
              </span>
            )}
            {stage.id === current && <Check size={13} aria-hidden />}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
