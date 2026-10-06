// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import type { ClientSnapshot } from "../packages/core/dto";
import t from "../packages/i18n/translations/en.json";
import { requestJson } from "../src/components/client-api";
import { IntegrationCards } from "../src/components/integration-cards";

vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const request = vi.mocked(requestJson);
const data = {
  asOf: 1,
  products: [{ id: "p", name: "Fictional product" }],
  people: [],
  relationships: [],
} as unknown as ClientSnapshot;
const overview = {
  configured: { gmail: true, calendar: true, linkedin: false, fireflies: true },
  connections: [],
  items: [],
};
const props = {
  data,
  organizationId: "org",
  productId: "p",
  demo: false,
  initialNotice: "",
  onChanged: vi.fn(async () => {}),
};
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  request.mockReset();
  vi.restoreAllMocks();
});
test("configured providers have working connect buttons and unavailable LinkedIn explains the missing setup", async () => {
  request.mockResolvedValue(overview);
  render(<IntegrationCards {...props} />);
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Connect Gmail" })
        .matches(":disabled"),
    ).toBe(false),
  );
  expect(
    screen.getByRole("button", { name: t.unipileSetUp }).matches(":disabled"),
  ).toBe(false);
  expect(screen.getByText(t.unipileSetupRequired)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Connect Gmail" }));
  expect(screen.getByRole("dialog").textContent).toContain(t.googleConnectNote);
  expect(screen.getByLabelText(t.defaultProduct)).toBeTruthy();
  const allowSending = screen.getByLabelText(
    t.gmailSendingConsent,
  ) as HTMLInputElement;
  expect(allowSending.checked).toBe(true);
  fireEvent.click(allowSending);
  expect(allowSending.checked).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: t.cancel }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
test("Fireflies validates its API key, locks pending submission and reveals a signing secret only once", async () => {
  request.mockResolvedValue(overview);
  render(<IntegrationCards {...props} />);
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Connect Fireflies" })
        .matches(":disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Connect Fireflies" }));
  const key = screen.getByLabelText(t.firefliesApiKey) as HTMLInputElement;
  const form = key.closest("form") as HTMLFormElement;
  expect(form.checkValidity()).toBe(false);
  expect(key.type).toBe("password");
  fireEvent.change(key, { target: { value: "fictional-api-key" } });
  let resolve!: (value: unknown) => void;
  request.mockImplementation((url) =>
    url === "/api/integrations"
      ? new Promise((done) => {
          resolve = done;
        })
      : Promise.resolve(overview),
  );
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(
    request.mock.calls.filter((call) => call[1]?.method === "POST"),
  ).toHaveLength(1);
  expect(key.matches(":disabled")).toBe(true);
  await act(async () =>
    resolve({
      webhookUrl: "https://example.test/webhook",
      signingSecret: "fictional-secret",
    }),
  );
  expect(
    (screen.getByLabelText(t.signingSecret) as HTMLInputElement).type,
  ).toBe("password");
  expect(screen.queryByLabelText(t.firefliesApiKey)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: t.done }));
  expect(screen.queryByDisplayValue("fictional-secret")).toBeNull();
});
test("a slow earlier overview response cannot overwrite newer connection state", async () => {
  let resolve!: (value: unknown) => void;
  request.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(<IntegrationCards {...props} />);
  request.mockResolvedValue(overview);
  view.rerender(
    <IntegrationCards
      {...props}
      data={{ ...data, asOf: 2 } as unknown as ClientSnapshot}
    />,
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Connect Gmail" })
        .matches(":disabled"),
    ).toBe(false),
  );
  await act(async () =>
    resolve({
      ...overview,
      configured: { ...overview.configured, gmail: false },
    }),
  );
  expect(
    screen.getByRole("button", { name: "Connect Gmail" }).matches(":disabled"),
  ).toBe(false);
});

test("review navigation reaches older items, resets for search and sources, and keeps filters after review", async () => {
  const item = (id: string) => ({
    id,
    connectionId: "c",
    productId: "p",
    record: {
      title: `Fictional import ${id}`,
      occurredAt: "2026-10-01T00:00:00Z",
      participants: ["person@example.test"],
      body: "Fictional private preview",
    },
  });
  const base = {
    ...overview,
    connections: [
      {
        id: "c",
        provider: "gmail",
        displayName: "Fictional account",
        status: "connected",
        productId: "p",
        lastSyncedAt: null,
        errorCode: null,
        more: false,
      },
    ],
    reviewTotal: 41,
  };
  request.mockImplementation(async (url, options) => {
    if (options?.method === "POST") return { ok: true };
    const query = new URL(String(url), "https://example.test").searchParams;
    const filtered = query.has("reviewQuery") || query.has("reviewProvider");
    return {
      ...base,
      items: [
        item(
          query.has("reviewCursor") ? "older" : filtered ? "filtered" : "newer",
        ),
      ],
      nextReviewCursor:
        query.has("reviewCursor") || filtered ? null : "fictional-cursor",
    };
  });
  render(<IntegrationCards {...props} />);
  await screen.findByText("Fictional import newer");
  expect(
    screen
      .getByRole("button", { name: t.previousImports })
      .matches(":disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: t.nextImports }));
  await screen.findByText("Fictional import older");
  expect(String(request.mock.calls.at(-1)?.[0])).toContain(
    "reviewCursor=fictional-cursor",
  );
  expect(
    screen.getByRole("button", { name: t.nextImports }).matches(":disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: t.previousImports }));
  await screen.findByText("Fictional import newer");
  fireEvent.click(screen.getByRole("button", { name: t.nextImports }));
  await screen.findByText("Fictional import older");
  fireEvent.change(screen.getByRole("searchbox", { name: t.searchImports }), {
    target: { value: "person@example.test" },
  });
  await screen.findByText("Fictional import filtered");
  const query = new URL(
    String(request.mock.calls.at(-1)?.[0]),
    "https://example.test",
  ).searchParams;
  expect(query.get("reviewQuery")).toBe("person@example.test");
  expect(query.has("reviewCursor")).toBe(false);
  fireEvent.change(screen.getByLabelText(t.importProvider), {
    target: { value: "fireflies" },
  });
  await waitFor(() =>
    expect(String(request.mock.calls.at(-1)?.[0])).toContain(
      "reviewProvider=fireflies",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: t.ignoreImport }));
  await waitFor(() =>
    expect(request.mock.calls.some((call) => call[1]?.method === "POST")).toBe(
      true,
    ),
  );
  await waitFor(() =>
    expect(String(request.mock.calls.at(-1)?.[0])).toContain(
      "reviewProvider=fireflies",
    ),
  );
  expect(String(request.mock.calls.at(-1)?.[0])).toContain(
    "reviewQuery=person%40example.test",
  );
});

test("connection sync and imported context use the organization's time zone", async () => {
  request.mockResolvedValue({
    ...overview,
    connections: [
      {
        id: "c",
        provider: "gmail",
        displayName: "Fictional account",
        status: "connected",
        productId: "p",
        lastSyncedAt: "2026-10-01T04:00:00Z",
        errorCode: null,
        more: false,
      },
    ],
    items: [
      {
        id: "i",
        connectionId: "c",
        productId: "p",
        record: {
          title: "Fictional meeting",
          occurredAt: "2026-10-01T04:00:00Z",
          participants: [],
          body: "",
        },
      },
    ],
    reviewTotal: 1,
    nextReviewCursor: null,
  });
  render(<IntegrationCards {...props} timeZone="Asia/Kolkata" />);
  await screen.findByText("Fictional meeting");
  expect(
    screen.getByText(t.lastSynced.replace("{time}", "Oct 1, 9:30 AM")),
  ).toBeTruthy();
  expect(screen.getByText("Oct 1, 9:30 AM ·")).toBeTruthy();
  expect(
    screen.getByText(t.integrationTimeZone.replace("{zone}", "Asia/Kolkata")),
  ).toBeTruthy();
});

test("personal Unipile setup verifies a masked key, advances to the unique webhook, and guards duplicate submissions", async () => {
  const { UnipileSettings } = await import(
    "../src/components/unipile-settings"
  );
  let finish: (value: unknown) => void = () => {};
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const onChanged = vi.fn(async () => {});
  const onClose = vi.fn();
  render(
    <UnipileSettings
      organizationId="org"
      configuration={null}
      onChanged={onChanged}
      onClose={onClose}
    />,
  );
  const input = screen.getByLabelText(t.unipileApiKey) as HTMLInputElement;
  expect(input.type).toBe("password");
  expect(input.placeholder).toBe(t.unipileKeyPlaceholder);
  expect(screen.getByText(t.unipileOwnership)).toBeTruthy();
  fireEvent.change(input, { target: { value: "fictional-user-key" } });
  const form = input.closest("form");
  if (!form) throw new Error("FORM_MISSING");
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(request).toHaveBeenCalledTimes(1);
  const body = JSON.parse(String(request.mock.calls[0][1]?.body));
  expect(body).toEqual({
    operation: "configure-unipile",
    organizationId: "org",
    apiKey: "fictional-user-key",
  });
  expect(input.disabled).toBe(true);
  await act(async () =>
    finish({
      id: "setup",
      webhookReady: false,
      webhookUrl:
        "https://crm.example.test/api/webhooks/unipile?configurationId=setup",
    }),
  );
  expect(screen.queryByLabelText(t.unipileApiKey)).toBeNull();
  expect(
    (screen.getByLabelText(t.webhookUrl) as HTMLInputElement).readOnly,
  ).toBe(true);
  const secret = screen.getByLabelText(t.signingSecret) as HTMLInputElement;
  expect(secret.type).toBe("password");
  expect(document.activeElement).toBe(secret);
  request.mockResolvedValueOnce({
    id: "setup",
    webhookReady: true,
    webhookUrl:
      "https://crm.example.test/api/webhooks/unipile?configurationId=setup",
  });
  fireEvent.change(secret, { target: { value: "fictional-webhook-secret" } });
  const webhookForm = secret.closest("form");
  if (!webhookForm) throw new Error("FORM_MISSING");
  fireEvent.submit(webhookForm);
  await waitFor(() => expect(screen.getByText(t.unipileReady)).toBeTruthy());
  expect(screen.queryByLabelText(t.signingSecret)).toBeNull();
  expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({
    operation: "configure-unipile",
    organizationId: "org",
    configurationId: "setup",
    signingSecret: "fictional-webhook-secret",
  });
  expect(onChanged).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: t.done }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("Unipile setup removal requires explicit confirmation and reports provider errors", async () => {
  const { UnipileSettings } = await import(
    "../src/components/unipile-settings"
  );
  const onClose = vi.fn();
  request.mockRejectedValueOnce(new Error("PROVIDER_UNAVAILABLE"));
  render(
    <UnipileSettings
      organizationId="org"
      configuration={{
        id: "owned",
        webhookReady: true,
        webhookUrl: "https://crm.example.test/hook",
      }}
      onChanged={async () => {}}
      onClose={onClose}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: t.unipileRemove }));
  expect(request).not.toHaveBeenCalled();
  expect(screen.getByText(t.unipileRemoveWarning)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: t.unipileConfirmRemove }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      t.errors.PROVIDER_UNAVAILABLE,
    ),
  );
  expect(onClose).not.toHaveBeenCalled();
  request.mockResolvedValueOnce({ ok: true });
  fireEvent.click(screen.getByRole("button", { name: t.unipileConfirmRemove }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(request.mock.calls.at(-1)?.[1]?.body))).toEqual({
    operation: "remove-unipile",
    organizationId: "org",
    configurationId: "owned",
  });
});

test("multiple accounts remain visible with a clear add-another-account control", async () => {
  request.mockResolvedValue({
    ...overview,
    connections: ["one", "two"].map((name, index) => ({
      id: name,
      provider: "gmail",
      displayName: `${name}@example.test`,
      status: "connected",
      productId: index ? "p2" : "p",
      lastSyncedAt: null,
      errorCode: null,
      more: false,
      canSend: true,
    })),
  });
  render(
    <IntegrationCards
      {...props}
      data={{
        ...data,
        products: [
          ...data.products,
          { ...data.products[0], id: "p2", name: "Other product" },
        ],
      }}
    />,
  );
  await screen.findByText("one@example.test");
  expect(screen.getByText("two@example.test")).toBeTruthy();
  expect(screen.getByText(t.accountPrivacyNote)).toBeTruthy();
  const card = screen.getByRole("article", { name: t.gmail });
  expect(card.textContent).toContain(
    t.connectedAccountCount.replace("{count}", "2"),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: t.addProviderAccount.replace("{provider}", t.gmail),
    }),
  );
  expect(screen.getByRole("dialog").textContent).toContain(t.googleConnectNote);
});
