// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { type ClientContext, serialize } from "../packages/core/dto";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { requestJson } from "../src/components/client-api";
import { ConversationHistory } from "../src/components/records/conversation-history";
import {
  ConversationThread,
  type ConversationThreadMessage,
} from "../src/components/records/conversation-thread";
import { installCrmHarness, principal } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));

const harness = installCrmHarness();
afterEach(cleanup);

function message(index: number): ClientContext["messages"][number] {
  return {
    id: `fictional-message-${index}`,
    conversationId: "fictional-conversation",
    direction: index % 2 ? "inbound" : "outbound",
    body: `Fictional message ${index}`,
    occurredAt: `2026-10-09T${String(index).padStart(2, "0")}:00:00.123Z`,
    providerMessageId: `fictional-source-${index}`,
    provenance: "provider",
    channel: index % 2 ? "gmail" : "linkedin",
  };
}

async function context() {
  const fixture = serialize(
    await harness.service.context(principal, demoId(1), demoId(300)),
  );
  if (!fixture.person) throw new Error("Missing fictional person fixture");
  return {
    ...fixture,
    person: { ...fixture.person, name: "Casey Morgan", summary: "" },
    messages: Array.from({ length: 10 }, (_, index) => message(9 - index)),
    messagesNextCursor: "fictional-earlier-cursor",
  };
}

function bodies(container: HTMLElement) {
  return [...container.querySelectorAll(".message-thread-body")].map(
    (element) => element.textContent,
  );
}

test("thread reads oldest to newest with two sides and compact times while retaining precise instants", () => {
  const messages: ConversationThreadMessage[] = [
    {
      ...message(2),
      body: "Fictional response.\n\nA second paragraph.",
      sourceId: "fictional-provider-id",
      sender: t.you,
    },
    { ...message(1), body: "A fictional incoming question." },
  ];
  const mounted = render(
    <ConversationThread
      messages={messages}
      personName="Casey Morgan"
      timeZone="UTC"
    />,
  );
  const articles = within(mounted.container).getAllByRole("article");
  expect(articles.map((article) => article.dataset.direction)).toEqual([
    "inbound",
    "outbound",
  ]);
  expect(within(articles[0]).getByText("Casey Morgan")).toBeTruthy();
  expect(within(articles[1]).getByText(t.you)).toBeTruthy();
  expect(within(articles[1]).queryByText(t.outgoing)).toBeNull();
  expect(articles[1].querySelectorAll(".message-thread-body p")).toHaveLength(
    2,
  );
  const time = articles[1].querySelector("time");
  expect(time?.dateTime).toBe(messages[0].occurredAt);
  expect(time?.title).toContain("00.123");
  expect(time?.textContent).toBe("2:00 AM");
  expect(articles[1].querySelector("details")?.open).toBe(false);
  expect(
    mounted.container.querySelectorAll(".message-thread-date"),
  ).toHaveLength(1);
});

test("outbound messages keep supplied sender names and use a neutral fallback for unknown ownership", () => {
  const mounted = render(
    <ConversationThread
      messages={[{ ...message(0), sender: "Jordan Lee" }, { ...message(2) }]}
      timeZone="UTC"
    />,
  );
  const articles = within(mounted.container).getAllByRole("article");
  expect(within(articles[0]).getByText("Jordan Lee")).toBeTruthy();
  expect(within(articles[1]).getByText(t.outgoing)).toBeTruthy();
  expect(within(mounted.container).queryByText(t.you)).toBeNull();
});

test("history labels account owners accurately and preserves imported outbound sender names", async () => {
  const fixture = await context();
  fixture.messages = [
    message(0),
    { ...message(2), conversationId: "fictional-shared-conversation" },
  ];
  fixture.conversations = [
    {
      id: "fictional-conversation",
      ownerId: "viewer",
      channel: "linkedin",
      provenance: "provider",
      visibility: "private",
      preview: null,
    },
    {
      id: "fictional-shared-conversation",
      ownerId: "coworker",
      channel: "linkedin",
      provenance: "provider",
      visibility: "product",
      preview: null,
    },
  ];
  fixture.person.summary =
    "SENT by Casey's colleague · 2026-10-08T09:00:00.000Z · fictional-source\nFictional imported message.";
  const mounted = render(
    <ConversationHistory
      context={fixture}
      timeZone="UTC"
      viewerId="viewer"
      memberName={(id) => (id === "coworker" ? "Jordan Lee" : "")}
    />,
  );
  const articles = within(mounted.container).getAllByRole("article");
  expect(
    articles.map((article) => article.querySelector("strong")?.textContent),
  ).toEqual(["Casey's colleague", t.you, "Jordan Lee"]);
});

test("date separators use the workspace timezone across a local midnight", () => {
  const mounted = render(
    <ConversationThread
      messages={[
        { ...message(0), occurredAt: "2026-10-09T18:29:00.000Z" },
        { ...message(1), occurredAt: "2026-10-09T18:31:00.000Z" },
      ]}
      timeZone="Asia/Kolkata"
    />,
  );
  expect(
    [...mounted.container.querySelectorAll(".message-thread-date")].map(
      (element) => element.textContent,
    ),
  ).toEqual(["Oct 9, 2026", "Oct 10, 2026"]);
});

test("history keeps the latest eight, search, channel filtering and import deduplication", async () => {
  const fixture = await context();
  fixture.person.summary =
    "SENT by Fictional Sender · 2026-10-09T02:00:00.123Z · fictional-duplicate\nFictional message 2";
  const mounted = render(
    <ConversationHistory context={fixture} timeZone="UTC" />,
  );
  expect(bodies(mounted.container)).toEqual(
    Array.from({ length: 8 }, (_, index) => `Fictional message ${index + 2}`),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: t.contactWorkspace.showAll.replace("{count}", "10"),
    }),
  );
  expect(bodies(mounted.container)).toHaveLength(10);
  expect(screen.getAllByText("Fictional message 2")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText(t.channel), {
    target: { value: "gmail" },
  });
  expect(bodies(mounted.container)).toEqual(
    [1, 3, 5, 7, 9].map((index) => `Fictional message ${index}`),
  );
  fireEvent.change(screen.getByLabelText(t.contactWorkspace.searchHistory), {
    target: { value: "message 7" },
  });
  expect(bodies(mounted.container)).toEqual(["Fictional message 7"]);
  fireEvent.change(screen.getByLabelText(t.channel), {
    target: { value: "linkedin" },
  });
  expect(screen.getByText(t.contactWorkspace.noMatchingHistory)).toBeTruthy();
});

test("loading earlier keeps organization and product scope, deduplicates pages and preserves local scroll", async () => {
  const fixture = await context();
  const older = {
    ...message(0),
    id: "fictional-earlier-message",
    body: "An earlier fictional message.",
    occurredAt: "2026-10-08T09:00:00.000Z",
  };
  vi.mocked(requestJson).mockResolvedValueOnce({
    messages: [message(2), older],
    nextCursor: null,
    accessibleHistoryOnly: true,
  });
  const mounted = render(
    <ConversationHistory context={fixture} timeZone="UTC" />,
  );
  const scroller = mounted.container.querySelector<HTMLElement>(
    ".conversation-history-scroll",
  );
  if (!scroller) throw new Error("Missing local conversation scroller");
  Object.defineProperty(scroller, "scrollHeight", {
    get: () => bodies(mounted.container).length * 100,
  });
  scroller.scrollTop = 200;
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: t.nativeIngestion.loadEarlier }),
    ),
  );
  const url = String(vi.mocked(requestJson).mock.calls.at(-1)?.[0]);
  const query = new URL(url, "http://localhost").searchParams;
  expect(Object.fromEntries(query)).toEqual({
    operation: "messages",
    organizationId: fixture.relationship.organizationId,
    productId: fixture.relationship.productId,
    relationshipId: fixture.relationship.id,
    cursor: "fictional-earlier-cursor",
  });
  expect(bodies(mounted.container)).toHaveLength(11);
  expect(bodies(mounted.container)[0]).toBe(older.body);
  expect(screen.getAllByText("Fictional message 2")).toHaveLength(1);
  expect(scroller.scrollTop).toBe(500);
  expect(
    screen.queryByRole("button", { name: t.nativeIngestion.loadEarlier }),
  ).toBeNull();
});

test("an earlier page arriving after the authorized context changes stays hidden", async () => {
  const fixture = await context();
  let resolve!: (value: unknown) => void;
  vi.mocked(requestJson).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const mounted = render(
    <ConversationHistory context={fixture} timeZone="UTC" />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: t.nativeIngestion.loadEarlier }),
  );
  mounted.rerender(
    <ConversationHistory
      context={{
        ...fixture,
        asOf: "2026-10-12T01:00:00.000Z",
        messages: [],
        messagesNextCursor: null,
      }}
      timeZone="UTC"
    />,
  );
  await act(async () =>
    resolve({
      messages: [{ ...message(0), body: "An obsolete private message." }],
      nextCursor: null,
    }),
  );
  expect(screen.queryByText("An obsolete private message.")).toBeNull();
  expect(bodies(mounted.container)).toEqual([]);
});
