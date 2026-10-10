// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { serialize } from "../packages/core/dto";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { CsvImportDialog } from "../src/components/records/csv-import-dialog";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));

const harness = installCrmHarness();

test("toolbar contains Import CSV button which opens the import dialog", async () => {
  await mountCrm(harness, "/people");
  const importBtn = await screen.findByRole("button", { name: t.importCsv });
  expect(importBtn).toBeDefined();

  fireEvent.click(importBtn);

  // Dialog mounts and displays title
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(t.csvImportTitle)).toBeDefined();
});

test("CsvImportDialog allows file selection, column mapping, preview with duplicate review, and import", async () => {
  await mountCrm(harness, "/people");
  const onImported = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();

  const snapshot = serialize(
    await harness.service.snapshot(
      { userId: "demo-you", source: "session" },
      { organizationId: demoId(1) },
    ),
  );

  const { container } = await act(async () => {
    return render(
      <CsvImportDialog
        data={snapshot}
        organizationId={demoId(1)}
        productId={demoId(10)}
        onClose={onClose}
        onImported={onImported}
      />,
    );
  });

  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(t.csvImportTitle)).toBeDefined();

  const fileInput = container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  expect(fileInput).toBeDefined();

  const sampleCsv = `Name,Email,Company,Domain
Mira Chen,person0@example.test,Northstar Labs,northstar-labs.example.test
Jane Fictional,jane.fictional@new-domain.invalid,New Tech,new-domain.invalid
`;
  const file = new File([sampleCsv], "contacts.csv", { type: "text/csv" });
  file.text = () => Promise.resolve(sampleCsv);

  await act(async () => {
    fireEvent.change(fileInput, { target: { files: [file] } });
  });

  // Preview button becomes active
  const previewBtn = within(dialog).getByRole("button", {
    name: new RegExp(t.previewCsvImport),
  });
  expect(previewBtn).toBeDefined();

  await act(async () => {
    fireEvent.click(previewBtn);
  });

  // Now in preview step: should display stats and duplicate tab
  await waitFor(() => {
    expect(
      within(dialog).getByText(new RegExp(t.duplicatesForReview)),
    ).toBeDefined();
  });

  // Switch to duplicates tab
  const duplicatesTab = within(dialog).getByRole("button", {
    name: new RegExp(t.duplicatesForReview),
  });
  await act(async () => {
    fireEvent.click(duplicatesTab);
  });

  // Verifies duplicate review notice and duplicate row reason are displayed
  expect(within(dialog).getByText(t.duplicateReviewNote)).toBeDefined();
  expect(
    within(dialog).getByText(
      /already belongs to Mira Chen in this organization/,
    ),
  ).toBeDefined();

  // Click Import valid contacts (skipping duplicates)
  const importValidBtn = within(dialog).getByRole("button", {
    name: new RegExp(t.importValidContacts),
  });
  await act(async () => {
    fireEvent.click(importValidBtn);
  });

  // Summary screen is shown
  await waitFor(() => {
    expect(within(dialog).getByText(t.importSummary)).toBeDefined();
  });
  expect(within(dialog).getByText(t.importedPeople)).toBeDefined();
  expect(onImported).toHaveBeenCalled();

  // Close button calls onClose
  const closeButtons = within(dialog).getAllByRole("button", { name: t.close });
  fireEvent.click(closeButtons[closeButtons.length - 1]);
  expect(onClose).toHaveBeenCalled();
});
