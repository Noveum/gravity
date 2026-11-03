"use client";
import type { JsonValue } from "@crm/core/dto";
import type { DueTouches, OutreachQueue } from "@crm/core/outreach";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, RequestError, requestJson } from "../client-api";
import { useCrm } from "../crm/crm-context";

type Due = JsonValue<DueTouches>;
type Queue = JsonValue<OutreachQueue>;
export type DueTouch = Due["groups"][number]["touches"][number];
export type QueueTouch = Queue["drafts"][number];
export type PausedEnrollment = Queue["paused"][number];
export type Touch = DueTouch | QueueTouch;

interface Loaded {
  key: string;
  due: Due | null;
  queue: Queue | null;
  failed: boolean;
}

const remembered = new Map<string, Loaded>();

function distinct<T extends { id: string }>(rows: readonly T[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}
function distinctDue(due: Due): Due {
  const seen = new Set<string>();
  return {
    ...due,
    groups: due.groups.map((group) => ({
      ...group,
      touches: group.touches.filter((touch) => {
        if (seen.has(touch.id)) return false;
        seen.add(touch.id);
        return true;
      }),
    })),
  };
}
function distinctQueue(queue: Queue): Queue {
  return {
    ...queue,
    drafts: distinct(queue.drafts),
    approved: distinct(queue.approved),
    sent: distinct(queue.sent),
    paused: distinct(queue.paused),
  };
}

export type OutreachResult<T> =
  | { ok: true; result: T }
  | {
      ok: false;
      error: string;
      code: string;
      details: Record<string, string | number>;
    };

export function postOutreach<T>(body: object) {
  return requestJson<T>("/api/outreach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function useOutreachSend() {
  const crm = useCrm();
  return useCallback(
    async <T>(body: object): Promise<OutreachResult<T>> => {
      try {
        const result = await postOutreach<T>({
          organizationId: crm.organizationId,
          ...body,
        });
        void crm.refresh();
        return { ok: true, result };
      } catch (error) {
        return {
          ok: false,
          error: errorText(error, crm.timeZone),
          code: error instanceof Error ? error.message : "INTERNAL_ERROR",
          details: error instanceof RequestError ? error.details : {},
        };
      }
    },
    [crm.organizationId, crm.timeZone, crm.refresh],
  );
}

export function useOutreachData() {
  const { userId, organizationId, productId, sourceData, notify, timeZone } =
    useCrm();
  const asOf = sourceData?.asOf;
  const readableProducts = [
    ...(sourceData?.products.map((product) => product.id) ?? []),
    ...(sourceData?.archivedProducts.map((product) => product.id) ?? []),
  ]
    .sort()
    .join(",");
  const key = `${userId}/${organizationId}/${productId}/${readableProducts}`;
  const [loaded, setLoaded] = useState<Loaded>(
    () => remembered.get(key) ?? { key, due: null, queue: null, failed: false },
  );
  const generation = useRef(0);
  const reload = useCallback(async () => {
    if (!organizationId) return;
    const current = ++generation.current;
    const scope = new URLSearchParams({ organizationId });
    if (productId) scope.set("productId", productId);
    // Existing records load immediately, even when planning is slow or forbidden.
    const planning = postOutreach({
      operation: "advance",
      organizationId,
    }).then(
      () => true,
      (error) => {
        if (
          current === generation.current &&
          !(error instanceof RequestError && error.message === "FORBIDDEN")
        )
          notify(errorText(error, timeZone), "danger");
        return false;
      },
    );
    const read = async () => {
      try {
        const [due, queue] = await Promise.all([
          requestJson<Due>(`/api/outreach?operation=due&${scope}`),
          requestJson<Queue>(`/api/outreach?operation=queue&${scope}`),
        ]);
        if (current !== generation.current) return;
        const next = {
          key,
          due: distinctDue(due),
          queue: distinctQueue(queue),
          failed: false,
        };
        remembered.set(key, next);
        setLoaded(next);
      } catch (error) {
        if (current !== generation.current) return;
        notify(errorText(error, timeZone), "danger");
        setLoaded((previous) => ({
          ...(previous.key === key
            ? previous
            : (remembered.get(key) ?? { key, due: null, queue: null })),
          failed: true,
        }));
      }
    };
    await read();
    if ((await planning) && current === generation.current) await read();
  }, [organizationId, productId, key, notify, timeZone]);
  useEffect(() => {
    if (asOf) void reload();
    return () => {
      generation.current += 1;
    };
  }, [reload, asOf]);
  const current = loaded.key === key ? loaded : remembered.get(key);
  return {
    due: current?.due ?? null,
    queue: current?.queue ?? null,
    failed: current?.failed ?? false,
    reload,
  };
}
