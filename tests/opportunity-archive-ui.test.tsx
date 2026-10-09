// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { eq } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import { RecordService } from "../packages/core/records";
import * as s from "../packages/database/schema";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { installCrmHarness, mountCrm, principal } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));

const harness = installCrmHarness();
const name = "Northstar evaluation project";
async function deal() {
  const [row] = await harness.local.db
    .select()
    .from(s.opportunities)
    .where(eq(s.opportunities.id, demoId(1101)));
  return row;
}
async function confirmArchive(container: HTMLElement) {
  const user = userEvent.setup();
  await user.click(
    within(container).getByRole("button", { name: t.contactWorkspace.more }),
  );
  await user.click(
    await screen.findByRole("menuitem", { name: t.archiveDeal }),
  );
  const confirmation = within(container).getByRole("group", {
    name: t.archiveDealConfirm,
  });
  expect((await deal()).archivedAt).toBeNull();
  fireEvent.click(
    within(confirmation).getByRole("button", {
      name: t.inlineEditing.confirmArchive,
    }),
  );
  await screen.findByText(t.dealArchived.replace("{name}", name));
}

test("list archive confirms, removes only the deal, and Undo restores the original deal", async () => {
  const original = await deal();
  await mountCrm(
    harness,
    "/opportunities?layout=list&sort=name_desc&status=open",
  );
  const row = await screen.findByRole("row", { name: new RegExp(name) });
  fireEvent.click(within(row).getByRole("button", { name }));
  const editor = await screen.findByRole("region", { name: t.editOpportunity });
  fireEvent.click(within(editor).getByRole("button", { name: t.cancel }));
  await confirmArchive(row);
  expect(screen.queryByRole("row", { name: new RegExp(name) })).toBeNull();
  expect(await deal()).toEqual({
    ...original,
    archivedAt: expect.any(Date),
    version: original.version + 1,
  });
  expect(
    harness.posts.find((post) => post.operation === "opportunity-delete"),
  ).toMatchObject({
    organizationId: demoId(1),
    productId: original.productId,
    opportunityId: original.id,
    version: original.version,
  });
  expect(
    harness.posts.find((post) => post.operation === "opportunity-delete"),
  ).not.toHaveProperty("archived");
  expect(
    harness.posts.some(
      (post) =>
        post.operation === "send-action" || post.operation === "send-touch",
    ),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: t.undo }));
  await screen.findByText(t.recordRestored.replace("{name}", name));
  await waitFor(() =>
    expect(screen.getByRole("row", { name: new RegExp(name) })).toBeTruthy(),
  );
  const retainedQuery = new URLSearchParams(window.location.search);
  expect(retainedQuery.get("layout")).toBe("list");
  expect(retainedQuery.get("sort")).toBe("name_desc");
  expect(retainedQuery.get("status")).toBe("open");
  expect(
    screen
      .getByRole("button", { name: t.inlineEditing.list })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(await deal()).toEqual({ ...original, version: original.version + 2 });
  expect(
    harness.posts.find((post) => post.operation === "opportunity-restore"),
  ).toMatchObject({
    opportunityId: original.id,
    version: original.version + 1,
  });
});

test("board archive retains edit and drag controls, and the Archived deals list restores it", async () => {
  await mountCrm(harness, "/opportunities");
  fireEvent.click(screen.getByRole("button", { name: t.inlineEditing.board }));
  const card = (await screen.findByRole("button", { name })).closest("article");
  if (!card) throw new Error("missing deal card");
  expect(card.draggable).toBe(true);
  expect(
    within(card).getByRole("button", { name: `${t.editOpportunity}: ${name}` }),
  ).toBeTruthy();
  await confirmArchive(card);
  expect(screen.queryByRole("button", { name })).toBeNull();
  const summary = await screen.findByText(t.archivedDeals);
  fireEvent.click(summary);
  const archived = summary.closest("details");
  if (!archived) throw new Error("missing archived deal list");
  fireEvent.click(
    within(archived).getByRole("button", { name: `${t.restore}: ${name}` }),
  );
  await screen.findByText(t.recordRestored.replace("{name}", name));
  expect((await deal()).archivedAt).toBeNull();
  await waitFor(() =>
    expect(screen.getByRole("button", { name })).toBeTruthy(),
  );
  expect(screen.queryByText(t.archivedDeals)).toBeNull();
});

test("restoring after a stage retires asks for a compatible replacement without changing the outcome", async () => {
  const original = await deal();
  const archived = await new RecordService(harness.local.db).archiveOpportunity(
    principal,
    {
      organizationId: demoId(1),
      opportunityId: original.id,
      version: original.version,
      archived: true,
    },
  );
  await harness.local.db
    .update(s.stages)
    .set({ archivedAt: new Date() })
    .where(eq(s.stages.id, original.stageId));
  await mountCrm(harness, "/opportunities");
  const summary = await screen.findByText(t.archivedDeals);
  fireEvent.click(summary);
  const list = summary.closest("details");
  if (!list) throw new Error("missing archived deal list");
  const restore = within(list).getByRole("button", {
    name: `${t.restore}: ${name}`,
  });
  expect(restore).toHaveProperty("disabled", true);
  const stage = within(list).getByRole("combobox", {
    name: `${t.stage}: ${name}`,
  });
  fireEvent.keyDown(stage, { key: "ArrowDown" });
  const choices = await screen.findAllByRole("option");
  // Only the remaining active open stages in this deal's product appear. The
  // retired original, closed outcomes and other-product stages stay excluded.
  expect(choices.map((option) => option.textContent)).toEqual([
    t.unspecified,
    "Discovery",
    "Proposal",
  ]);
  fireEvent.click(screen.getByRole("option", { name: "Discovery" }));
  fireEvent.click(restore);
  await screen.findByText(t.recordRestored.replace("{name}", name));
  expect(await deal()).toEqual({
    ...original,
    stageId: demoId(800),
    version: archived.version + 1,
  });
  expect(
    harness.posts.find((post) => post.operation === "opportunity-restore"),
  ).toMatchObject({ stageId: demoId(800) });
});
