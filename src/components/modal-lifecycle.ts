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
    let edited = false;
    const markEdited = (event: Event) => {
      const field = event.target;
      if (
        (field instanceof HTMLInputElement &&
          field.type !== "search" &&
          !field.readOnly) ||
        (field instanceof HTMLTextAreaElement && !field.readOnly) ||
        field instanceof HTMLSelectElement
      )
        edited = true;
    };
    const backdrop = (event: MouseEvent) => {
      if (
        event.target !== dialog ||
        edited ||
        dialog.matches("[data-dirty='true']") ||
        dialog.querySelector("[data-dirty='true']")
      )
        return;
      const box = dialog.getBoundingClientRect();
      if (
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom
      )
        return;
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    };
    dialog.addEventListener("input", markEdited);
    dialog.addEventListener("change", markEdited);
    dialog.addEventListener("click", backdrop);
    if (!dialog.open) dialog.showModal();
    return () => {
      dialog.removeEventListener("input", markEdited);
      dialog.removeEventListener("change", markEdited);
      dialog.removeEventListener("click", backdrop);
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
    (!event.currentTarget.closest("dialog, [data-record-editor]") ||
      !plainSaveAllowed(event.target))
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
