"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { useEffect } from "react";
import { useCrm } from "./crm-context";
import { useDraftBufferActions, useDraftBuffers } from "./draft-buffers";

type Action = ClientSnapshot["actions"][number];

export function useDraft(action: Action | undefined) {
  const { mutating, notify } = useCrm();
  const buffers = useDraftBuffers();
  const { save, drop } = useDraftBufferActions();
  const buffer = action ? buffers.get(action.id) : undefined;
  const version = buffer?.version ?? action?.version ?? 0;
  const stale = !!buffer && buffer.version !== action?.version;
  const actionId = action?.id;
  const actionVersion = action?.version;
  useEffect(() => {
    if (stale && actionId && actionVersion !== undefined && !mutating.current)
      notify(t.errors.CONFLICT, "danger");
  }, [stale, actionId, actionVersion, mutating, notify]);
  return {
    draft: buffer?.text ?? action?.draft ?? "",
    version,
    edit(text: string) {
      if (action) save(action.id, { text, version });
    },
    reload() {
      if (action) drop(action.id);
    },
  };
}
