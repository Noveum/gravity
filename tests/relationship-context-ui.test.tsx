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
import { emptyRelationshipDetails } from "../packages/core/relationship-context";
import * as s from "../packages/database/schema";
import { demoId, demoUser } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { ImportedContext } from "../src/components/records/imported-context";
import { contactTab } from "./support/contact-workspace";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const harness = installCrmHarness();

test("editing notes preserves existing signal timestamp precision and datetime instants", async () => {
  const observedAt = "2026-11-01T06:30:18.123456Z";
  const fieldValue = "2026-11-01T06:30:18.125Z";
  await harness.local.db
    .update(s.relationships)
    .set({
      contextDetails: {
        ...emptyRelationshipDetails(),
        signals: [
          {
            id: demoId(8980),
            title: "Fictional existing signal",
            description: "Existing precision remains source data.",
            kind: "other",
            classification: "fact",
            sourceUrl: null,
            observedAt,
          },
        ],
        fields: [
          {
            id: demoId(8981),
            label: "Fictional existing timestamp",
            type: "datetime",
            value: fieldValue,
          },
        ],
      },
    })
    .where(eq(s.relationships.id, demoId(300)));
  await mountCrm(harness, `/people/${demoId(200)}`);
  await contactTab(t.contactWorkspace.context);
  fireEvent.click(
    await screen.findByRole("button", { name: t.contextFields.edit }),
  );
  const editor = within(
    screen.getByRole("region", { name: t.contextFields.edit }),
  );
  fireEvent.change(editor.getByLabelText(t.contextFields.sections.needs), {
    target: { value: "Fictional updated notes" },
  });
  fireEvent.click(editor.getByRole("button", { name: t.save }));
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: t.contextFields.edit }),
    ).toBeNull(),
  );
  const [stored] = await harness.local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, demoId(300)));
  expect(stored.contextDetails.needs).toBe("Fictional updated notes");
  expect(stored.contextDetails.signals[0]?.observedAt).toBe(observedAt);
  expect(stored.contextDetails.fields[0]?.value).toBe(fieldValue);
});

test("context editor saves readable notes, signals and each custom field type on the full person record", async () => {
  await mountCrm(harness, `/people/${demoId(200)}`);
  await contactTab(t.contactWorkspace.context);
  fireEvent.click(
    await screen.findByRole("button", { name: t.contextFields.edit }),
  );
  const dialog = screen.getByRole("region", { name: t.contextFields.edit });
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
    target: { value: "2026-10-06T14:37:18.125" },
  });
  const examples = [
    { label: "Seats", type: "number", value: "0" },
    { label: "Verified", type: "boolean", value: "false" },
    { label: "Review date", type: "date", value: "2026-10-20" },
    {
      label: "Review time",
      type: "datetime",
      value: "2026-10-20T14:37:18.125",
    },
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
      screen.queryByRole("region", { name: t.contextFields.edit }),
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
    "2026-10-20T14:37:18.125Z",
    "https://example.test",
    "West",
  ]);
  expect(stored.contextDetails.signals[0]?.observedAt).toBe(
    "2026-10-06T14:37:18.125Z",
  );
  fireEvent.click(screen.getByRole("button", { name: t.contextFields.edit }));
  const reopened = within(
    screen.getByRole("region", { name: t.contextFields.edit }),
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
      screen.queryByRole("region", { name: t.contextFields.edit }),
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
  await contactTab(t.contactWorkspace.context);
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
    screen.getByRole("region", { name: t.contextFields.edit }),
  );
  expect(dialog.getByLabelText(t.summary)).toHaveProperty("value", "");
  fireEvent.change(dialog.getByLabelText(t.summary), {
    target: { value: "Readable replacement" },
  });
  fireEvent.click(dialog.getByRole("button", { name: t.save }));
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: t.contextFields.edit }),
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
  await contactTab(t.contactWorkspace.context);
  fireEvent.click(
    await screen.findByRole("button", { name: t.contextFields.edit }),
  );
  const dialog = within(
    screen.getByRole("region", { name: t.contextFields.edit }),
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

test("the default summary field saves directly through the authorized outreach operation", async () => {
  await mountCrm(harness, `/people/${demoId(200)}`);
  await contactTab(t.contactWorkspace.context);
  const summary = await screen.findByRole("textbox", {
    name: t.summary,
  });
  fireEvent.change(summary, {
    target: { value: "Updated directly in the record." },
  });
  const form = summary.closest("form");
  if (!form) throw new Error("Missing summary form");
  fireEvent.submit(form);
  await waitFor(() => expect(form.querySelector("[role=status]")).toBeTruthy());
  const [stored] = await harness.local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, demoId(300)));
  expect(stored.context).toBe("Updated directly in the record.");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("context editor protects inline notes and changes made only with field or signal buttons", async () => {
  await mountCrm(harness, "/people");
  fireEvent.click(screen.getByRole("link", { name: "Mira Chen" }));
  await contactTab(t.contactWorkspace.context);
  const summary = await screen.findByRole("textbox", {
    name: t.summary,
  });
  fireEvent.change(summary, {
    target: { value: "Unsaved preparation context" },
  });
  fireEvent.click(screen.getByRole("button", { name: t.contextFields.edit }));
  expect(
    screen.queryByRole("region", { name: t.contextFields.edit }),
  ).toBeNull();
  expect((summary as HTMLTextAreaElement).value).toBe(
    "Unsaved preparation context",
  );
  fireEvent.click(
    within(summary.closest("form") as HTMLFormElement).getByRole("button", {
      name: t.cancel,
    }),
  );
  for (const label of [t.contextFields.addField, t.contextFields.addSignal]) {
    fireEvent.click(screen.getByRole("button", { name: t.contextFields.edit }));
    const editor = screen.getByRole("region", { name: t.contextFields.edit });
    fireEvent.click(within(editor).getByRole("button", { name: label }));
    fireEvent.click(screen.getByRole("link", { name: t.companies }));
    expect(window.location.pathname).toBe("/people");
    expect(screen.getByRole("region", { name: t.contextFields.edit })).toBe(
      editor,
    );
    fireEvent.click(within(editor).getByRole("button", { name: t.cancel }));
  }
  fireEvent.click(screen.getByRole("link", { name: t.companies }));
  await waitFor(() => expect(window.location.pathname).toBe("/companies"));
});
