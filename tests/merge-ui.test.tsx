// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import {
  CrmContext,
  type CrmContextValue,
} from "../src/components/crm/crm-context";
import { MergeDialog } from "../src/components/records/merge-dialog";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
});

const personA = {
  id: demoId(201),
  name: "Alice Canonical",
  title: "VP of Product",
  email: "alice.canonical@example.test",
  otherEmails: ["alice.home@example.test"],
  phone: "+1 555 0101",
  linkedinUrl: "https://linkedin.com/in/alice-canonical",
  companyId: demoId(101),
  summary: "Canonical summary notes.",
  doNotContact: false,
  version: 1,
};

const personB = {
  id: demoId(202),
  name: "Alice Duplicate",
  title: "Head of Product",
  email: "alice.dup@example.test",
  otherEmails: [],
  phone: "+1 555 0199",
  linkedinUrl: "",
  companyId: null,
  summary: "Secondary notes.",
  doNotContact: true,
  version: 2,
};

const mockSourceData = {
  people: [personA, personB],
  companies: [
    {
      id: demoId(101),
      name: "Acme Corp",
      domain: "acme.com",
      description: "Acme Corp description",
      version: 1,
    },
  ],
  relationships: [],
  actions: [],
  meetings: [],
  opportunities: [],
  archived: { people: [], companies: [], opportunities: [], sequences: [] },
  compact: false,
} as unknown as CrmContextValue["sourceData"];

function renderMergeDialog(overrides: Partial<CrmContextValue> = {}) {
  const send = vi.fn().mockResolvedValue({ ok: true });
  const go = vi.fn();
  const close = vi.fn();

  const ctx: CrmContextValue = {
    organizationId: demoId(1),
    productId: demoId(10),
    sourceData: mockSourceData,
    busy: false,
    send,
    go,
    ...overrides,
  } as unknown as CrmContextValue;

  render(
    <CrmContext.Provider value={ctx}>
      <MergeDialog
        entity="person"
        initialTargetId={personA.id}
        onClose={close}
      />
    </CrmContext.Provider>,
  );

  return { send, go, close };
}

describe("MergeDialog Review Screen UI", () => {
  test("shows candidate selection and filters candidates", async () => {
    renderMergeDialog();

    expect(screen.getByText(t.mergePerson)).toBeDefined();
    expect(screen.getByText(t.selectDuplicateRecord)).toBeDefined();
    expect(screen.getByText("Alice Duplicate")).toBeDefined();

    // Filter candidate
    const searchInput = screen.getByPlaceholderText(t.searchRecordPlaceholder);
    fireEvent.change(searchInput, { target: { value: "Nonexistent" } });
    expect(screen.getByText(t.noResults)).toBeDefined();

    fireEvent.change(searchInput, { target: { value: "Duplicate" } });
    expect(screen.getByText("Alice Duplicate")).toBeDefined();
  });

  test("side-by-side review screen highlights conflicts and lets user choose values", async () => {
    const { send, close, go } = renderMergeDialog();

    // Select Person B as duplicate
    fireEvent.click(screen.getByText("Alice Duplicate"));

    // Review screen is displayed
    expect(screen.getByText(t.canonicalRecord)).toBeDefined();
    expect(screen.getByText(t.duplicateRecord)).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "Alice Canonical" }),
    ).toBeDefined();

    // Notice about relationships and private conversations
    expect(screen.getByText(t.mergeNotice)).toBeDefined();

    // Title conflict: Alice Canonical ("VP of Product") vs Alice Duplicate ("Head of Product")
    expect(screen.getByText("VP of Product")).toBeDefined();
    const headOfProductOption = screen
      .getByText("Head of Product")
      .closest("button");
    expect(headOfProductOption).toBeDefined();

    // Pick Head of Product from duplicate
    if (headOfProductOption) fireEvent.click(headOfProductOption);

    // Click confirm & merge
    const submitBtn = screen.getByRole("button", { name: t.mergeSubmit });
    fireEvent.click(submitBtn);

    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "merge-records",
        organizationId: demoId(1),
        entity: "person",
        targetId: personA.id,
        targetVersion: 1,
        sourceId: personB.id,
        sourceVersion: 2,
        title: "Head of Product",
      }),
      t.recordsMerged,
      false,
    );

    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(go).toHaveBeenCalledWith(`/people/${personA.id}`);
  });

  test("allows swapping canonical record", async () => {
    const { send } = renderMergeDialog();

    // Select Person B as duplicate
    fireEvent.click(screen.getByText("Alice Duplicate"));

    // Click Swap
    const swapBtn = screen.getByRole("button", { name: t.swapCanonical });
    fireEvent.click(swapBtn);

    // Person B is now canonical
    const submitBtn = screen.getByRole("button", { name: t.mergeSubmit });
    fireEvent.click(submitBtn);

    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "merge-records",
        targetId: personB.id,
        targetVersion: 2,
        sourceId: personA.id,
        sourceVersion: 1,
      }),
      t.recordsMerged,
      false,
    );
  });
});
