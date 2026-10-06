"use client";
import { useEffect, useRef, useState } from "react";

function bound(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
export function usePanelLayout(collapsed = false) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1280);
  const [navigation, setNavigation] = useState(232);
  const [inspector, setInspector] = useState(480);
  useEffect(() => {
    try {
      const left = Number(localStorage.getItem("gravity-navigation-width"));
      if (Number.isFinite(left) && left >= 176 && left <= 340)
        setNavigation(left);
      const right = Number(localStorage.getItem("gravity-inspector-width"));
      if (Number.isFinite(right) && right >= 300 && right <= 960)
        setInspector(right);
    } catch {}
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const navigationMax = Math.max(176, Math.min(340, width - 660));
  const actualNavigation = bound(navigation, 176, navigationMax);
  const inspectorMax = Math.max(
    300,
    Math.min(
      960,
      width <= 900
        ? width - 16
        : width - (collapsed ? 56 : actualNavigation) - 320,
    ),
  );
  function resizeNavigation(value: number) {
    const next = bound(value, 176, navigationMax);
    setNavigation(next);
    try {
      localStorage.setItem("gravity-navigation-width", String(next));
    } catch {}
  }
  function resizeInspector(value: number) {
    const next = bound(value, 300, inspectorMax);
    setInspector(next);
    try {
      localStorage.setItem("gravity-inspector-width", String(next));
    } catch {}
  }
  return {
    frame,
    navigation: actualNavigation,
    navigationMax,
    resizeNavigation,
    inspector: bound(inspector, 300, inspectorMax),
    inspectorMax,
    resizeInspector,
  };
}
export function ResizeHandle({
  label,
  hint,
  value,
  min,
  max,
  direction,
  onChange,
  onReset,
  className,
  controls,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  direction: 1 | -1;
  onChange: (value: number) => void;
  onReset: () => void;
  className: string;
  controls: string;
}) {
  const drag = useRef<{ start: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    // biome-ignore lint/a11y/useSemanticElements: This focusable separator controls pane width rather than marking a thematic break.
    <div
      className={`resize-handle ${className}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      aria-controls={controls}
      title={hint}
      data-dragging={dragging || undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { start: event.clientX, width: value };
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current)
          onChange(
            drag.current.width +
              direction * (event.clientX - drag.current.start),
          );
      }}
      onPointerUp={(event) => {
        drag.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          onChange(
            value +
              direction *
                (event.key === "ArrowRight" ? 1 : -1) *
                (event.shiftKey ? 40 : 10),
          );
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          event.stopPropagation();
          onChange(event.key === "Home" ? min : max);
        }
      }}
    />
  );
}
