"use client";
import { createRefreshCoordinator } from "@crm/core/client-state";
import type { ClientSnapshot } from "@crm/core/dto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText, requestJson } from "../client-api";
import type { Notify } from "../ui/toaster";

export const accessErrors = ["FORBIDDEN", "UNAUTHORIZED"];
export const isAccessError = (error: unknown, codes = accessErrors) =>
  error instanceof Error && codes.includes(error.message);

export function useLiveSnapshot({
  initial,
  organizationId,
  notify,
  onAccessLost,
}: {
  initial: ClientSnapshot | null;
  organizationId: string;
  notify: Notify;
  onAccessLost: () => void;
}) {
  const [sourceData, setData] = useState(initial);
  const [loadFailed, setLoadFailed] = useState(false);
  const [syncState, setSyncState] = useState("reconnecting");
  const activeOrganization = useRef(organizationId);
  activeOrganization.current = organizationId;
  const fetchGeneration = useRef(0);
  const revision = useRef("");
  const accessLost = useRef(onAccessLost);
  accessLost.current = onAccessLost;
  const refreshCoordinator = useMemo(() => createRefreshCoordinator(), []);
  const refresh = useCallback(
    () =>
      refreshCoordinator(async () => {
        if (!organizationId || activeOrganization.current !== organizationId)
          return;
        const generation = ++fetchGeneration.current;
        const current = () =>
          activeOrganization.current === organizationId &&
          generation === fetchGeneration.current;
        try {
          const snapshot = await requestJson<ClientSnapshot>(
            `/api/crm?organizationId=${organizationId}&compact=true`,
          );
          if (current()) {
            setData(snapshot);
            setLoadFailed(false);
          }
        } catch (error) {
          if (current()) {
            setLoadFailed(true);
            notify(errorText(error), "danger");
            if (isAccessError(error)) {
              setData(null);
              accessLost.current();
            }
          }
        }
      }),
    [organizationId, refreshCoordinator, notify],
  );
  useEffect(() => {
    if (!organizationId) return;
    let stopped = false;
    const feed = new EventSource(
      `/api/events?organizationId=${organizationId}`,
    );
    function refreshForRevision(next: string) {
      if (!stopped && revision.current !== next) {
        revision.current = next;
        void refresh();
      }
    }
    feed.onopen = () => {
      if (!stopped) setSyncState("live");
    };
    feed.onerror = () => {
      if (!stopped) setSyncState("reconnecting");
    };
    feed.addEventListener("revision", (event) => {
      const result = JSON.parse((event as MessageEvent).data) as {
        revision: string;
      };
      refreshForRevision(result.revision);
    });
    feed.addEventListener("access-changed", () => {
      feed.close();
      if (!stopped) {
        setSyncState("reconnecting");
        void refresh();
      }
    });
    const recover = async () => {
      if (stopped) return;
      const previous = revision.current;
      try {
        const result = await requestJson<{ revision: string }>(
          `/api/crm?operation=revision&organizationId=${organizationId}`,
        );
        // A stream event that arrived during this request takes precedence.
        if (revision.current === previous) refreshForRevision(result.revision);
      } catch {
        if (!stopped && revision.current === previous) void refresh();
      }
    };
    // Either the stream or this read starts the first snapshot. When both
    // report the same revision, only one full workspace download is needed.
    void recover();
    const recoverIfVisible = () => {
      if (document.visibilityState === "visible") void recover();
    };
    const interval = setInterval(() => {
      if (feed.readyState !== EventSource.OPEN) recoverIfVisible();
    }, 5000);
    window.addEventListener("focus", recoverIfVisible);
    document.addEventListener("visibilitychange", recoverIfVisible);
    return () => {
      stopped = true;
      feed.close();
      clearInterval(interval);
      window.removeEventListener("focus", recoverIfVisible);
      document.removeEventListener("visibilitychange", recoverIfVisible);
    };
  }, [organizationId, refresh]);
  return {
    sourceData,
    setData,
    loadFailed,
    setLoadFailed,
    refresh,
    syncState,
    fetchGeneration,
    revision,
    activeOrganization,
  };
}
