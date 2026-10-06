// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import * as s from "../packages/database/schema";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));

const harness = installCrmHarness();
const aiTitle = "Thoughtful introduction · AI Platform";
const enrollmentsTable = () =>
  screen.findByRole("table", { name: `${t.enrollments}: ${aiTitle}` });
async function enrollment(id: number) {
  const [row] = await harness.local.db
    .select()
    .from(s.enrollments)
    .where(eq(s.enrollments.id, demoId(id)));
  return row;
}
async function sequence(id: number) {
  const [row] = await harness.local.db
    .select()
    .from(s.sequences)
    .where(eq(s.sequences.id, demoId(id)));
  return row;
}

describe("creating sequences", () => {
  test("New sequence creates a one-step sequence in the chosen product and opens its editor", async () => {
    await mountCrm(harness, "/outreach/sequences");
    fireEvent.click(await screen.findByRole("button", { name: t.newSequence }));
    const dialog = await screen.findByRole("dialog", { name: t.newSequence });
    fireEvent.change(within(dialog).getByLabelText(t.product), {
      target: { value: demoId(12) },
    });
    fireEvent.change(within(dialog).getByLabelText(t.sequenceName), {
      target: { value: "Renewal check-in" },
    });
    fireEvent.change(within(dialog).getByLabelText(t.firstStepChannel), {
      target: { value: "linkedin" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t.create }));
    await screen.findByText(
      t.sequenceCreated.replace("{name}", "Renewal check-in"),
    );
    expect(
      harness.posts.find((post) => post.operation === "create-sequence"),
    ).toMatchObject({
      productId: demoId(12),
      name: "Renewal check-in",
      steps: [
        {
          number: 1,
          name: t.firstStep,
          delayDays: 0,
          channel: "linkedin",
          followUp: 0,
        },
      ],
    });
    expect(
      await screen.findByRole("form", {
        name: `${t.editSteps}: Renewal check-in · Services`,
      }),
    ).toBeTruthy();
  });
});

describe("stopping enrollments", () => {
  test("Stop asks for confirmation, then stops the enrollment", async () => {
    await mountCrm(harness, "/outreach/sequences");
    const amara = within(await enrollmentsTable()).getByRole("row", {
      name: /Amara Stone/,
    });
    fireEvent.click(
      within(amara).getByRole("button", { name: `${t.stop}: Amara Stone` }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: t.stopEnrollmentTitle.replace("{name}", "Amara Stone"),
    });
    expect(dialog.textContent).toContain("Thoughtful introduction");
    expect((await enrollment(501))?.status).toBe("running");
    fireEvent.click(within(dialog).getByRole("button", { name: t.stop }));
    await screen.findByText(
      t.enrollmentStopped.replace("{name}", "Amara Stone"),
    );
    expect(await enrollment(501)).toMatchObject({ status: "stopped" });
    expect(
      harness.posts.find(
        (post) => post.operation === "enrollment" && post.command === "stop",
      ),
    ).toMatchObject({ enrollmentId: demoId(501) });
  });
});

describe("archiving sequences", () => {
  test("Archive confirms with the running count, archives, hides Resume and Restore brings it back", async () => {
    await mountCrm(harness, "/outreach/sequences");
    fireEvent.click(
      await screen.findByRole("button", {
        name: `${t.archiveSequence}: ${aiTitle}`,
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: t.archiveSequence,
    });
    expect(dialog.textContent).toContain(
      t.archiveSequenceDetail.replace("{count}", "2"),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: t.archive }));
    await screen.findByText(
      t.sequenceArchived.replace("{name}", "Thoughtful introduction"),
    );
    expect((await sequence(400))?.archivedAt).toBeInstanceOf(Date);
    const archived = await screen.findByRole("region", {
      name: t.archivedSequences,
    });
    await waitFor(() =>
      expect(within(archived).getByText(t.archivedFlag)).toBeTruthy(),
    );
    const table = within(archived).getByRole("table", {
      name: `${t.enrollments}: ${aiTitle}`,
    });
    expect(within(table).queryByRole("button", { name: /^Resume/ })).toBe(null);
    fireEvent.click(
      within(archived).getByRole("button", {
        name: `${t.restore}: ${aiTitle}`,
      }),
    );
    await screen.findByText(
      t.sequenceRestored.replace("{name}", "Thoughtful introduction"),
    );
    expect((await sequence(400))?.archivedAt).toBeNull();
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: t.archivedSequences }),
      ).toBeNull(),
    );
  });

  test("the enroll dialog does not offer an archived sequence", async () => {
    await harness.local.db
      .update(s.sequences)
      .set({ archivedAt: new Date() })
      .where(eq(s.sequences.id, demoId(402)));
    await mountCrm(harness, "/people");
    (await screen.findByRole("link", { name: /^Theo Grant/ })).focus();
    await userEvent.setup().keyboard("x");
    fireEvent.click(screen.getByRole("button", { name: t.enrollSelected }));
    const dialog = await screen.findByRole("dialog", { name: t.enrollTitle });
    const options = within(
      within(dialog).getByLabelText(t.sequenceLabel),
    ).getAllByRole("option");
    expect(options.map((option) => option.getAttribute("value"))).not.toContain(
      demoId(402),
    );
  });
});
