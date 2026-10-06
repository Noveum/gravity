// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";
import * as s from "../packages/database/schema";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { requestJson } from "../src/components/client-api";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));

const harness = installCrmHarness();
const gmail = demoId(1950);
const linkedin = demoId(1951);
const readinessCalls: URLSearchParams[] = [];
const sends: Record<string, unknown>[] = [];
let readiness: Record<string, unknown>;
let delivery: Record<string, unknown>;

beforeEach(() => {
  readinessCalls.length = 0;
  sends.length = 0;
  readiness = {
    ready: true,
    blockedBy: null,
    recipient: "person4@example.test",
    channel: "gmail",
    conversationId: null,
    policy: { allowed: true, sendAfter: null, reasons: [] },
  };
  delivery = { id: demoId(1960), status: "sent", errorCode: null };
  const harnessed = vi.mocked(requestJson).getMockImplementation();
  vi.mocked(requestJson).mockImplementation(async (url, init) => {
    const address = String(url);
    if (address.startsWith("/api/integrations"))
      return {
        connections: [
          {
            id: gmail,
            provider: "gmail",
            status: "connected",
            displayName: "you@example.test",
            canSend: true,
          },
          {
            id: linkedin,
            provider: "linkedin",
            status: "connected",
            displayName: "LinkedIn account",
            canSend: true,
          },
        ],
      };
    if (address.startsWith("/api/outreach?operation=send-readiness")) {
      readinessCalls.push(new URL(address, "http://localhost").searchParams);
      return readiness;
    }
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (body.operation === "send-touch" || body.operation === "send-action") {
        sends.push(body);
        await new Promise((resolve) => setTimeout(resolve, 30));
        return delivery;
      }
    }
    if (!harnessed) throw new Error("harness");
    return harnessed(url, init);
  });
});

async function openSendFromApproved() {
  await mountCrm(harness, "/outreach/approved", { demo: false });
  fireEvent.click(
    await screen.findByRole("button", {
      name: `${t.touchVerbs.send}: Amara Stone`,
    }),
  );
  return screen.findByRole("dialog", {
    name: t.sendTitle.replace("{name}", "Amara Stone"),
  });
}

describe("sending an approved touch", () => {
  test("the confirmation names recipient, account and channel from readiness and a double click sends once", async () => {
    const dialog = await openSendFromApproved();
    await within(dialog).findByText("person4@example.test");
    expect(within(dialog).getByText("you@example.test")).toBeTruthy();
    expect(within(dialog).getByText(t.gmail)).toBeTruthy();
    expect(readinessCalls[0]?.get("touchId")).toBe(demoId(1304));
    expect(readinessCalls[0]?.get("connectionId")).toBe(gmail);
    expect(readinessCalls[0]?.get("version")).toBe("1");
    const confirm = within(dialog).getByRole("button", { name: t.sendNow });
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await screen.findByText(t.messageSent.replace("{name}", "Amara Stone"));
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      operation: "send-touch",
      touchId: demoId(1304),
      connectionId: gmail,
      version: 1,
    });
    expect(String(sends[0]?.idempotencyKey)).toMatch(/^[a-zA-Z0-9_-]{16,128}$/);
  });

  test("a retry after a lost response reuses the same idempotency key", async () => {
    const dialog = await openSendFromApproved();
    const confirm = within(dialog).getByRole("button", { name: t.sendNow });
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );
    const harnessed = vi.mocked(requestJson).getMockImplementation();
    let failed = false;
    vi.mocked(requestJson).mockImplementation(async (url, init) => {
      if (!failed && init?.method === "POST") {
        failed = true;
        sends.push(JSON.parse(String(init.body)));
        throw new Error("NETWORK_ERROR");
      }
      if (!harnessed) throw new Error("harness");
      return harnessed(url, init);
    });
    fireEvent.click(confirm);
    await within(dialog).findByRole("alert");
    fireEvent.click(within(dialog).getByRole("button", { name: t.sendNow }));
    await screen.findByText(t.messageSent.replace("{name}", "Amara Stone"));
    expect(sends).toHaveLength(2);
    expect(sends[1]?.idempotencyKey).toBe(sends[0]?.idempotencyKey);
  });

  test("a blocked touch shows why and cannot be sent", async () => {
    readiness = {
      ...readiness,
      ready: false,
      blockedBy: "TOUCH_NOT_DUE",
    };
    const dialog = await openSendFromApproved();
    await within(dialog).findByText(t.errors.TOUCH_NOT_DUE);
    expect(
      (
        within(dialog).getByRole("button", {
          name: t.sendNow,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  test("no keyboard shortcut sends from the confirmation", async () => {
    const dialog = await openSendFromApproved();
    const confirm = within(dialog).getByRole("button", { name: t.sendNow });
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );
    const keys = userEvent.setup();
    within(dialog).getByLabelText(t.sendAccount).focus();
    await keys.keyboard("{Meta>}{Enter}{/Meta}");
    await keys.keyboard("{Control>}{Enter}{/Control}");
    await keys.keyboard("e");
    await keys.keyboard("{Enter}");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(sends).toHaveLength(0);
    expect(dialog.hasAttribute("open")).toBe(true);
  });

  test("an unknown outcome says to check the delivery instead of resending", async () => {
    delivery = { ...delivery, status: "unknown" };
    const dialog = await openSendFromApproved();
    const confirm = within(dialog).getByRole("button", { name: t.sendNow });
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(confirm);
    await screen.findByText(
      t.sendOutcomeUnknown.replace("{name}", "Amara Stone"),
    );
  });

  test("the touch drawer offers Send for an approved touch", async () => {
    await mountCrm(harness, "/outreach/approved", { demo: false });
    fireEvent.click(
      await screen.findByRole("button", {
        name: `${t.touchVerbs.edit}: Amara Stone`,
      }),
    );
    const drawer = await screen.findByRole("dialog", {
      name: t.draftEditorTitle.replace("{name}", "Amara Stone"),
    });
    fireEvent.click(
      within(drawer).getByRole("button", { name: t.touchVerbs.send }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: t.sendTitle.replace("{name}", "Amara Stone"),
      }),
    ).toBeTruthy();
  });

  test("the demo workspace never offers a send", async () => {
    await mountCrm(harness, "/outreach/approved");
    fireEvent.click(
      await screen.findByRole("button", {
        name: `${t.touchVerbs.send}: Amara Stone`,
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: t.sendTitle.replace("{name}", "Amara Stone"),
    });
    expect(within(dialog).getByText(t.sendDemoUnavailable)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: t.sendNow })).toBe(
      null,
    );
    expect(readinessCalls).toHaveLength(0);
  });
});

describe("sending an approved follow-up", () => {
  test("the draft panel sends an approved action through send_action", async () => {
    await harness.local.db
      .update(s.actions)
      .set({
        draft: "Subject: Pilot scope\n\nHere is the fictional scope.",
        draftHash: "fixture",
        approvedHash: "fixture",
      })
      .where(eq(s.actions.id, demoId(602)));
    readiness = { ...readiness, recipient: "person2@example.test" };
    await mountCrm(
      harness,
      `/people/${demoId(202)}?relationship=${demoId(302)}&action=${demoId(602)}`,
      { demo: false },
    );
    fireEvent.click(await screen.findByRole("button", { name: t.draft }));
    fireEvent.click(
      await screen.findByRole("button", { name: t.touchVerbs.send }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: t.sendTitle.replace("{name}", "Leena Rao"),
    });
    await within(dialog).findByText("person2@example.test");
    expect(readinessCalls[0]?.get("actionId")).toBe(demoId(602));
    const confirm = within(dialog).getByRole("button", { name: t.sendNow });
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(confirm);
    await screen.findByText(t.messageSent.replace("{name}", "Leena Rao"));
    expect(sends[0]).toMatchObject({
      operation: "send-action",
      actionId: demoId(602),
      connectionId: gmail,
    });
  });
});
