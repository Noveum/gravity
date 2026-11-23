"use client";
import { createRefreshCoordinator } from "@crm/core/client-state";
import type { ClientSnapshot } from "@crm/core/dto";
import { useEffect, useMemo, useRef, useState } from "react";
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
  // A denied snapshot needs a successful revision check before automatic retry.
  const revision = useRef<string | null>("");
  const retrySnapshot = useRef(false);
  // A snapshot that keeps failing is retried after 5 s, doubling to 60 s.
  const retryDelay = useRef(0);
  const retryAfter = useRef(0);
  const accessLost = useRef(onAccessLost);
  accessLost.current = onAccessLost;
  const refresh = useMemo(() => {
    // A slow request in the previous workspace must not queue the new one behind it.
    const refreshCoordinator = createRefreshCoordinator();
    return () =>
      refreshCoordinator(async () => {
        if (!organizationId || activeOrganization.current !== organizationId)
          return;
        const generation = ++fetchGeneration.current;
        const requestedRevision = revision.current;
        const current = () =>
          activeOrganization.current === organizationId &&
          generation === fetchGeneration.current;
        try {
          const snapshot = await requestJson<ClientSnapshot>(
            `/api/crm?organizationId=${organizationId}&compact=true`,
          );
          if (current()) {
            retrySnapshot.current = false;
            retryDelay.current = 0;
            setData(snapshot);
            setLoadFailed(false);
          }
        } catch (error) {
          if (current()) {
            retrySnapshot.current =
              revision.current === requestedRevision && !isAccessError(error);
            const repeated = retrySnapshot.current && retryDelay.current > 0;
            retryDelay.current = retrySnapshot.current
              ? Math.min(repeated ? retryDelay.current * 2 : 5000, 60000)
              : 0;
            retryAfter.current = Date.now() + retryDelay.current;
            setLoadFailed(true);
            if (!repeated) notify(errorText(error), "danger");
            if (isAccessError(error)) {
              revision.current = null;
              setData(null);
              accessLost.current();
            }
          }
        }
      });
  }, [organizationId, notify]);
  useEffect(() => {
    if (!organizationId) return;
    let stopped = false;
    const feed = new EventSource(
      `/api/events?organizationId=${organizationId}`,
    );
    function refreshForRevision(next: string, retryNow: boolean) {
      const retry =
        retrySnapshot.current && (retryNow || Date.now() >= retryAfter.current);
      if (!stopped && (revision.current !== next || retry)) {
        retrySnapshot.current = false;
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
      refreshForRevision(result.revision, false);
    });
    feed.addEventListener("access-changed", () => {
      feed.close();
      if (!stopped) {
        setSyncState("reconnecting");
        void refresh();
      }
    });
    const recover = async (retryNow = true) => {
      if (stopped) return;
      const previous = revision.current;
      try {
        const result = await requestJson<{ revision: string }>(
          `/api/crm?operation=revision&organizationId=${organizationId}`,
        );
        // A stream event that arrived during this request takes precedence.
        if (revision.current === previous)
          refreshForRevision(result.revision, retryNow);
      } catch {
        if (!stopped && previous !== null && revision.current === previous)
          void refresh();
      }
    };
    // Either the stream or this read starts the first snapshot. When both
    // report the same revision, only one full workspace download is needed.
    void recover();
    const recoverIfVisible = (retryNow = true) => {
      if (document.visibilityState === "visible") void recover(retryNow);
    };
    const onReturn = () => recoverIfVisible();
    const interval = setInterval(() => {
      if (
        feed.readyState !== EventSource.OPEN ||
        (retrySnapshot.current && Date.now() >= retryAfter.current)
      )
        recoverIfVisible(false);
    }, 5000);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      stopped = true;
      feed.close();
      clearInterval(interval);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
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
