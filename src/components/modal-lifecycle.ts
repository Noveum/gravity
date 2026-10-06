"use client";
import { shortcutFor } from "@crm/core/shortcuts";
import { type RefObject, useEffect, useLayoutEffect } from "react";
import { isEditable, keyInput } from "./keyboard-navigation";

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

const plainKeyControls =
  "a[href], button, input, select, textarea, summary, [role='button'], [role='link'], [role='checkbox'], [role='radio'], [role='switch'], [role='menuitem'], [role='tab']";
function plainSaveAllowed(target: EventTarget) {
  if (!(target instanceof Element)) return true;
  const control = target.closest(plainKeyControls);
  return (
    !control ||
    (control instanceof HTMLButtonElement && control.type === "submit")
  );
}
export function submitOnSaveKey(event: React.KeyboardEvent<HTMLFormElement>) {
  const editing = isEditable(event.target);
  const id = shortcutFor(keyInput(event), ["dialog"], editing);
  if (id !== "save") return;
  const modified = event.metaKey || event.ctrlKey;
  if (
    !modified &&
    (!event.currentTarget.closest("dialog") || !plainSaveAllowed(event.target))
  )
    return;
  event.preventDefault();
  if (!event.repeat) event.currentTarget.requestSubmit();
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
