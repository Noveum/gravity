import { act, cleanup, render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { CrmService } from "../../packages/core/crm";
import { serialize } from "../../packages/core/dto";
import { DomainError, type Principal } from "../../packages/core/policy";
import { createLocalDatabase } from "../../packages/database/client";
import { demoId, demoUser, seedDemo } from "../../packages/database/seed";
import {
  apiOperation,
  type Operation,
} from "../../packages/operations/catalog";
import { RequestError, requestJson } from "../../src/components/client-api";
import { CrmApp } from "../../src/components/crm-app";
import { SettingsView } from "../../src/components/views/settings-view";
import { visit } from "./memory-router";

export interface Call {
  api: string;
  method: string;
  operation: string;
  body: Record<string, unknown>;
}
export interface SettingsHarness {
  local: Awaited<ReturnType<typeof createLocalDatabase>>;
  calls: Call[];
  principal: Principal;
}

async function respond(
  harness: SettingsHarness,
  url: string,
  init?: RequestInit,
) {
  const parsed = new URL(url, "http://localhost");
  const api = parsed.pathname.replace("/api/", "") as Operation["api"];
  const method = (init?.method ?? "GET") as Operation["method"];
  const body: Record<string, unknown> =
    method === "GET"
      ? Object.fromEntries(parsed.searchParams)
      : JSON.parse(String(init?.body ?? "{}"));
  const operation = apiOperation(api, method, body.operation);
  if (method !== "GET")
    harness.calls.push({ api, method, operation: operation.name, body });
  try {
    return serialize(
      await operation.execute(
        { db: harness.local.db, principal: harness.principal },
        body,
      ),
    );
  } catch (error) {
    if (error instanceof DomainError)
      throw new RequestError(error.code, error.details ?? {});
    throw error;
  }
}

export function installSettingsHarness() {
  const harness = { calls: [] } as unknown as SettingsHarness;
  const request = vi.mocked(requestJson);
  beforeAll(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "EventSource",
      class extends EventTarget {
        static OPEN = 1;
        readyState = 1;
        onopen = null;
        onerror = null;
        close() {}
      },
    );
    HTMLElement.prototype.scrollIntoView = vi.fn();
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
  });
  beforeEach(async () => {
    harness.local = await createLocalDatabase();
    await seedDemo(harness.local.db);
    harness.calls = [];
    harness.principal = { userId: demoUser, source: "session" };
    localStorage.clear();
    request.mockReset();
    request.mockImplementation((url, init) => respond(harness, url, init));
  });
  afterEach(async () => {
    cleanup();
    await harness.local.client.close();
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  return harness;
}

export async function mountSettings(
  harness: SettingsHarness,
  path: string,
  userId = demoUser,
  productId = "",
) {
  harness.principal = { userId, source: "session" };
  visit(path);
  const service = new CrmService(harness.local.db);
  const organizations = serialize(
    await service.organizations(harness.principal),
  );
  const snapshot = serialize(
    await service.snapshot(harness.principal, { organizationId: demoId(1) }),
  );
  render(
    <CrmApp
      initial={snapshot}
      organizations={organizations}
      initialOrganizationId={demoId(1)}
      initialProductId={productId}
      userId={userId}
      mcpEndpoint="https://gravity.example.test/mcp"
      demo={false}
    >
      <SettingsView />
    </CrmApp>,
  );
  await act(async () => {});
}

export const lastCall = (harness: SettingsHarness, name: string) =>
  harness.calls.filter((call) => call.operation === name).at(-1);
