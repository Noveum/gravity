import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  readLocal: vi.fn(),
}));
vi.mock("@crm/auth/server", () => ({
  currentPrincipal: async () => ({ userId: "fixture", source: "session" }),
}));
vi.mock("@crm/database/client", () => ({
  getDatabase: async () => ({}),
}));
vi.mock("@crm/operations/catalog", () => ({
  apiOperation: () => ({ execute: mocks.execute }),
}));
vi.mock("@crm/files/storage", () => ({ readLocalObject: mocks.readLocal }));

import { GET } from "../src/app/api/files/route";

beforeEach(() => {
  vi.clearAllMocks();
});

test("signed download redirects cannot be cached after access changes", async () => {
  mocks.execute.mockResolvedValue({
    body: null,
    name: "Private.pdf",
    url: "https://storage.example.test/Private.pdf?signature=fixture",
  });
  const response = await GET(
    new Request("https://app.example.test/api/files?operation=download"),
  );
  expect(response.status).toBe(307);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Location")).toBe(
    "https://storage.example.test/Private.pdf?signature=fixture",
  );
});

test("a missing local object returns an error response without an unhandled rejection", async () => {
  mocks.execute.mockResolvedValue({
    body: null,
    name: "Missing.pdf",
    url: "local:fixture",
  });
  mocks.readLocal.mockRejectedValue(new Error("Object unavailable"));
  const response = await GET(
    new Request("https://app.example.test/api/files?operation=download"),
  );
  expect(response.status).toBe(500);
});
