import { EventEmitter } from "node:events";

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
  bus.on(organizationId, listener);
  return () => {
    bus.off(organizationId, listener);
  };
}
