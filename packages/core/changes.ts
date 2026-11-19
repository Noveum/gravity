import { EventEmitter } from "node:events";
import { isWorkersRuntime } from "../database/client";

const runtime = globalThis as typeof globalThis & {
  gravityChanges?: EventEmitter;
};
const bus = runtime.gravityChanges ?? new EventEmitter();
runtime.gravityChanges = bus;
bus.setMaxListeners(0);
// This is a wake-up hint only. Never transport records without querying current permissions.
export function publishChange(organizationId: string) {
  bus.emit(organizationId);
}
export function subscribeChanges(organizationId: string, listener: () => void) {
  // A Workers listener would run inside the publishing request, which cannot
  // touch another request's stream; subscribers there rely on reconciliation.
  if (isWorkersRuntime) return () => {};
  bus.on(organizationId, listener);
  return () => {
    bus.off(organizationId, listener);
  };
}
