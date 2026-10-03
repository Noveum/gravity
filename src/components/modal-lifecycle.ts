"use client";
import { type RefObject, useEffect, useLayoutEffect } from "react";

export function useModalLifecycle(
  ref: RefObject<HTMLDialogElement | null>,
  active = true,
) {
  useLayoutEffect(() => {
    if (!active || !ref.current) return;
    const dialog = ref.current;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (previous?.isConnected && !document.querySelector("dialog[open]"))
        previous.focus();
    };
  }, [ref, active]);
}

export function submitOnModEnter(event: React.KeyboardEvent<HTMLFormElement>) {
  if (
    event.key === "Enter" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.nativeEvent.isComposing
  ) {
    event.preventDefault();
    event.currentTarget.requestSubmit();
  }
}

export function useReadyFocus(
  ref: RefObject<HTMLDialogElement | null>,
  loading: boolean,
) {
  useEffect(() => {
    const dialog = ref.current;
    if (
      !loading &&
      dialog?.open &&
      (document.activeElement === dialog ||
        document.activeElement?.hasAttribute("data-modal-cancel"))
    )
      dialog
        .querySelector<HTMLElement>("[data-primary-field]:not(:disabled)")
        ?.focus();
  }, [ref, loading]);
}
