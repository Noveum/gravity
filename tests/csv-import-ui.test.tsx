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
    within(dialog).getByText(t.csvIssues.PERSON_EMAIL_EXISTS),
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

test("Companies entry imports company-only CSV and displays its company summary", async () => {
  await mountCrm(harness, "/companies");
  fireEvent.click(await screen.findByRole("button", { name: t.importCsv }));
  const dialog = await screen.findByRole("dialog");
  const csv = "Company,Domain\nFictional UI Company,csv-ui-only.example.test";
  const file = new File([csv], "fictional-companies.csv", { type: "text/csv" });
  file.text = () => Promise.resolve(csv);
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: new RegExp(t.previewCsvImport),
      }),
    );
  });
  await waitFor(() => {
    expect(within(dialog).getByText("Fictional UI Company")).toBeDefined();
  });
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Import companies/ }),
    );
  });
  await waitFor(() => {
    expect(within(dialog).getByText(t.importSummary)).toBeDefined();
  });
  const [company] = await harness.local.db
    .select()
    .from((await import("../packages/database/schema")).companies)
    .where(
      (await import("drizzle-orm")).eq(
        (await import("../packages/database/schema")).companies.domain,
        "csv-ui-only.example.test",
      ),
    );
  expect(company?.name).toBe("Fictional UI Company");
});

test("CSV validation codes display localized invalid row explanations", async () => {
  await mountCrm(harness, "/people");
  fireEvent.click(await screen.findByRole("button", { name: t.importCsv }));
  const dialog = await screen.findByRole("dialog");
  const csv = `Name,Title\nFictional Person,${"T".repeat(151)}`;
  const file = new File([csv], "fictional-invalid.csv", { type: "text/csv" });
  file.text = () => Promise.resolve(csv);
  await act(async () => {
    fireEvent.change(
      dialog.querySelector('input[type="file"]') as HTMLInputElement,
      { target: { files: [file] } },
    );
  });
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: new RegExp(t.previewCsvImport),
      }),
    );
  });
  expect(
    await within(dialog).findByText(t.csvIssues.TITLE_TOO_LONG),
  ).toBeDefined();
  expect(
    within(dialog)
      .getByRole("button", { name: /Import contacts/ })
      .hasAttribute("disabled"),
  ).toBe(true);
});

test("malformed replacement CSV clears the prior file before another preview", async () => {
  await mountCrm(harness, "/people");
  fireEvent.click(await screen.findByRole("button", { name: t.importCsv }));
  const dialog = await screen.findByRole("dialog");
  for (const csv of ["Name\nValid Person", 'Name\n"unclosed']) {
    const file = new File([csv], "fictional.csv", { type: "text/csv" });
    file.text = () => Promise.resolve(csv);
    await act(async () => {
      fireEvent.change(
        dialog.querySelector('input[type="file"]') as HTMLInputElement,
        { target: { files: [file] } },
      );
    });
  }
  expect(
    await within(dialog).findByText(t.errors.CSV_STRUCTURE_INVALID),
  ).toBeDefined();
  expect(
    within(dialog)
      .getByRole("button", { name: new RegExp(t.previewCsvImport) })
      .hasAttribute("disabled"),
  ).toBe(true);
});
