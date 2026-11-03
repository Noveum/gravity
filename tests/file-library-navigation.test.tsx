// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { command } from "../src/components/files/file-api";
import { FileLibrary } from "../src/components/files/file-library";
import { fileFixture } from "./support/file-fixture";

const rootId = "00000000-0000-4000-8000-000000000010";
const nestedId = "00000000-0000-4000-8000-000000000011";
const route = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(route.search),
}));
vi.mock("../src/components/crm/crm-context", () => ({
  useWorkspaceData: () => ({
    organizationId: "org",
    productId: "product",
    userId: "owner",
    data: { products: [{ id: "product" }], members: [] },
    sourceData: { asOf: "stable" },
    canLeaveEditor: () => true,
    registerCreate: () => () => {},
    openFile: () => {},
  }),
}));
vi.mock("../src/components/files/file-preview", () => ({
  FilePreview: () => null,
}));
vi.mock("../src/components/files/markdown-preview", () => ({
  MarkdownPreview: () => null,
}));
vi.mock("../src/components/files/file-api", () => ({
  command: vi.fn(async (_scope, _operation, input) => ({
    entries: [
      fileFixture({
        name: "Copied notes.txt",
        parentId: input.parentId,
        syncId: 2,
      }),
    ],
  })),
  listFiles: vi.fn(async (_scope, parentId) => {
    const root = fileFixture({ id: rootId, name: "Root", kind: "folder" });
    const nested = fileFixture({
      id: nestedId,
      parentId: rootId,
      name: "Nested",
      kind: "folder",
    });
    return parentId === nestedId
      ? {
          entries: [
            fileFixture({ name: "Copied notes.txt", parentId: nestedId }),
          ],
          ancestors: [root, nested],
        }
      : parentId === rootId
        ? { entries: [nested], ancestors: [root] }
        : { entries: [root], ancestors: [] };
  }),
  detail: vi.fn(),
  reserve: vi.fn(),
  fileUrl: () => "/api/files",
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("paste targets the new parent even while Next search params still describe the nested folder", async () => {
  route.search = `folder=${nestedId}`;
  window.history.replaceState(null, "", `/files?${route.search}`);
  render(<FileLibrary />);
  const checkbox = await screen.findByRole("checkbox", {
    name: "Select Copied notes.txt",
  });
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("button", { name: "Cut" }));
  fireEvent.click(screen.getByRole("button", { name: "Go to parent folder" }));
  expect(new URLSearchParams(window.location.search).get("folder")).toBe(
    rootId,
  );
  // Next's context deliberately remains stale until its deferred transition commits.
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Paste" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Paste" }));
  await waitFor(() => expect(command).toHaveBeenCalled());
  expect(command).toHaveBeenCalledWith(
    expect.anything(),
    "transfer",
    expect.objectContaining({ operation: "move", parentId: rootId }),
  );
});
