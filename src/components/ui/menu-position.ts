"use client";
import { type RefObject, useLayoutEffect, useState } from "react";
import { layerFor } from "../shell/workspace-menu";

export function menuPosition(
  rect: { left: number; top: number; bottom: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const gap = 8;
  const width = Math.min(size.width, Math.max(0, viewport.width - gap * 2));
  const below = viewport.height - rect.bottom - gap - 4;
  const above = rect.top - gap - 4;
  const flipped = below < size.height && above > below;
  const maxHeight = Math.max(0, flipped ? above : below);
  const height = Math.min(size.height, maxHeight);
  return {
    width,
    maxHeight,
    left: Math.max(gap, Math.min(rect.left, viewport.width - width - gap)),
    top: Math.max(gap, flipped ? rect.top - height - 4 : rect.bottom + 4),
  };
}
export function useMenuPosition(
  anchor: HTMLElement | null,
  popup: RefObject<HTMLDivElement | null>,
  width: number,
) {
  const [position, setPosition] = useState({
    left: 8,
    top: 8,
    width,
    maxHeight: 280,
  });
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const target = layerFor(anchor);
    if (layer !== target) setLayer(target);
    const place = () => {
      if (!anchor || !popup.current) return;
      setPosition(
        menuPosition(
          anchor.getBoundingClientRect(),
          { width, height: popup.current.scrollHeight },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    place();
    const observer = new ResizeObserver(place);
    if (popup.current) observer.observe(popup.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, popup, width, layer]);
  return { position, layer };
}
