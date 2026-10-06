// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { eq } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import { OutreachService } from "../packages/core/outreach";
import * as s from "../packages/database/schema";
import { demoId, demoUser } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { ImportedContext } from "../src/components/records/imported-context";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const harness = installCrmHarness();

test("context editor saves readable notes, signals and each custom field type on the full person record", async () => {
  await mountCrm(harness, `/people/${demoId(200)}`);
  fireEvent.click(
    await screen.findByRole("button", { name: t.contextFields.edit }),
  );
  const dialog = screen.getByRole("dialog", { name: t.contextFields.edit });
  const ui = within(dialog);
  fireEvent.change(ui.getByLabelText(t.summary), {
    target: { value: "A fictional evaluation with a clear next step." },
  });
  fireEvent.change(ui.getByLabelText(t.contextFields.sections.history), {
    target: { value: "Introduced by a fictional partner." },
  });
  fireEvent.click(ui.getByRole("button", { name: t.contextFields.addSignal }));
  const signal = within(
    ui.getByRole("group", { name: `${t.contextFields.signal} 1` }),
  );
  fireEvent.change(signal.getByLabelText(t.contextFields.title), {
    target: { value: "New hiring plan" },
  });
  fireEvent.change(signal.getByLabelText(t.contextFields.sourceUrl), {
    target: { value: "https://example.test/careers" },
  });
  fireEvent.change(signal.getByLabelText(t.contextFields.observedDate), {
    target: { value: "2026-10-06" },
  });
  const examples = [
    { label: "Seats", type: "number", value: "0" },
    { label: "Verified", type: "boolean", value: "false" },
    { label: "Review date", type: "date", value: "2026-10-20" },
    { label: "Website", type: "url", value: "https://example.test" },
    { label: "Region", type: "text", value: "West" },
  ];
  for (const [index, item] of examples.entries()) {
    fireEvent.click(ui.getByRole("button", { name: t.contextFields.addField }));
    const field = within(
      ui.getByRole("group", { name: `${t.contextFields.field} ${index + 1}` }),
    );
    fireEvent.change(field.getByLabelText(t.name), {
      target: { value: item.label },
    });
    fireEvent.change(field.getByLabelText(t.contextFields.fieldType), {
      target: { value: item.type },
    });
    fireEvent.change(field.getByLabelText(t.contextFields.value), {
      target: { value: item.value },
    });
  }
  await userEvent.setup().click(ui.getByRole("button", { name: t.save }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: t.contextFields.edit }),
    ).toBeNull(),
  );
  expect(await screen.findByText("New hiring plan")).toBeTruthy();
  expect(
    await screen.findByText("Introduced by a fictional partner."),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: t.contextFields.source })
      .getAttribute("rel"),
  ).toBe("noopener noreferrer");
  expect(screen.getByText(t.contextFields.no)).toBeTruthy();
  const [stored] = await harness.local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, demoId(300)));
  expect(stored.contextDetails.fields.map((field) => field.value)).toEqual([
    0,
    false,
    "2026-10-20",
    "https://example.test",
    "West",
  ]);
  expect(stored.contextDetails.signals[0]?.observedAt).toBe(
    "2026-10-06T00:00:00Z",
  );
  fireEvent.click(screen.getByRole("button", { name: t.contextFields.edit }));
  const reopened = within(
    screen.getByRole("dialog", { name: t.contextFields.edit }),
  );
  fireEvent.click(
    reopened.getByRole("button", { name: `${t.contextFields.removeSignal} 1` }),
  );
  fireEvent.click(
    reopened.getByRole("button", { name: `${t.contextFields.removeField} 1` }),
  );
  fireEvent.click(reopened.getByRole("button", { name: t.save }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: t.contextFields.edit }),
    ).toBeNull(),
  );
  expect(screen.queryByText("New hiring plan")).toBeNull();
});

test("legacy JSON is lazy readable source data, survives editing, and cannot create HTML or unsafe links", async () => {
  const source = JSON.stringify({
    history: { last_contact: "Fictional conversation", permission: false },
    website: "javascript:alert(1)",
    markup: "<img src=x onerror=alert(1)>",
    count: 0,
    records: [{ note: "Nested note" }],
  });
  await harness.local.db
    .update(s.relationships)
    .set({ context: source })
    .where(eq(s.relationships.id, demoId(300)));
  await mountCrm(harness, `/people/${demoId(200)}`);
  const heading = await screen.findByText(t.contextFields.importedSource);
  expect(screen.queryByText("Fictional conversation")).toBeNull();
  fireEvent.click(heading);
  const imported = heading.closest("details");
  if (!imported) throw new Error("Missing source disclosure");
  imported.open = true;
  fireEvent(imported, new Event("toggle"));
  expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  expect(document.querySelector(".imported-context img")).toBeNull();
  expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  const nested = screen
    .getByText(`${t.contextFields.properties} · 2`)
    .closest("details");
  if (!nested) throw new Error("Missing nested disclosure");
  nested.open = true;
  fireEvent(nested, new Event("toggle"));
  expect(await screen.findByText("Fictional conversation")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: t.contextFields.edit }));
  const dialog = within(
    screen.getByRole("dialog", { name: t.contextFields.edit }),
  );
  expect(dialog.getByLabelText(t.summary)).toHaveProperty("value", "");
  fireEvent.change(dialog.getByLabelText(t.summary), {
    target: { value: "Readable replacement" },
  });
  fireEvent.click(dialog.getByRole("button", { name: t.save }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: t.contextFields.edit }),
    ).toBeNull(),
  );
  expect(await screen.findByText("Readable replacement")).toBeTruthy();
  const [stored] = await harness.local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, demoId(300)));
  expect(stored.contextSource).toBe(source);
});

test("an agent edit while the dialog is open rejects a stale save and keeps the user's draft", async () => {
  await mountCrm(harness, `/people/${demoId(200)}`);
  fireEvent.click(
    await screen.findByRole("button", { name: t.contextFields.edit }),
  );
  const dialog = within(
    screen.getByRole("dialog", { name: t.contextFields.edit }),
  );
  fireEvent.change(dialog.getByLabelText(t.summary), {
    target: { value: "Unsaved user notes" },
  });
  const [record] = await harness.local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, demoId(300)));
  await new OutreachService(harness.local.db).changeRelationship(
    { userId: demoUser, source: "session" },
    {
      organizationId: demoId(1),
      relationshipId: record.id,
      version: record.version,
      contextDetails: { budget: "Agent-reviewed budget" },
    },
  );
  fireEvent.click(dialog.getByRole("button", { name: t.save }));
  expect(await dialog.findByText(t.errors.CONFLICT)).toHaveProperty(
    "textContent",
    t.errors.CONFLICT,
  );
  expect(dialog.getByLabelText(t.summary)).toHaveProperty(
    "value",
    "Unsaved user notes",
  );
  const [stored] = await harness.local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, demoId(300)));
  expect(stored.contextDetails.budget).toBe("Agent-reviewed budget");
  expect(stored.context).not.toBe("Unsaved user notes");
  fireEvent.click(dialog.getByRole("button", { name: t.cancel }));
});

test("all imported fields are reachable through bounded pages", async () => {
  render(
    <ImportedContext
      source={JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 65 }, (_, index) => [
            `field_${index}`,
            `Fictional value ${index}`,
          ]),
        ),
      )}
    />,
  );
  fireEvent.click(screen.getByText(t.contextFields.importedSource));
  expect(await screen.findByText("Fictional value 0")).toBeTruthy();
  expect(screen.queryByText("Fictional value 64")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: t.contextFields.nextFields }),
  );
  expect(await screen.findByText("Fictional value 30")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: t.contextFields.nextFields }),
  );
  expect(await screen.findByText("Fictional value 64")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: t.contextFields.nextFields }),
  ).toHaveProperty("disabled", true);
  fireEvent.click(
    screen.getByRole("button", { name: t.contextFields.previousFields }),
  );
  expect(await screen.findByText("Fictional value 30")).toBeTruthy();
});
