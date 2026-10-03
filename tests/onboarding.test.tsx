// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import type { ClientSnapshot } from "../packages/core/dto";
import t from "../packages/i18n/translations/en.json";
import { Authorization, Consent, SignIn } from "../src/components/auth-forms";
import { requestJson } from "../src/components/client-api";
import { Connections } from "../src/components/connections";
import { WorkspaceSetup } from "../src/components/workspace-setup";

let query = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => query }));
vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const request = vi.mocked(requestJson);
const products = (id: string, name: string) => ({ products: [{ id, name }] });
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
beforeAll(() => {
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  request.mockReset();
  query = new URLSearchParams();
  vi.restoreAllMocks();
});

test("workspace setup validates required fields, locks one pending submission and preserves a failed name", async () => {
  const saved = deferred();
  request.mockReturnValueOnce(saved.promise);
  const onCreated = vi.fn(async () => {});
  render(<WorkspaceSetup onCreated={onCreated} />);
  const org = screen.getByLabelText(t.organizationName) as HTMLInputElement;
  const product = screen.getByLabelText(t.firstProduct) as HTMLInputElement;
  const form = org.closest("form") as HTMLFormElement;
  expect(form.checkValidity()).toBe(false);
  fireEvent.keyDown(org, { key: "Enter", metaKey: true });
  expect(request).not.toHaveBeenCalled();
  fireEvent.change(org, { target: { value: "Fictional workspace" } });
  fireEvent.change(product, { target: { value: "Fictional product" } });
  fireEvent.change(screen.getByLabelText(t.organizationTimezone), {
    target: { value: "UTC" },
  });
  fireEvent.keyDown(product, { key: "Enter", ctrlKey: true });
  fireEvent.submit(form);
  expect(request).toHaveBeenCalledOnce();
  expect(org.matches(":disabled")).toBe(true);
  expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
    operation: "workspace",
    name: "Fictional workspace",
    productName: "Fictional product",
    timezone: "UTC",
  });
  await act(async () =>
    saved.resolve({ organizationId: "org", productId: "product" }),
  );
  expect(onCreated).toHaveBeenCalledExactlyOnceWith({
    organizationId: "org",
    productId: "product",
  });
  request.mockRejectedValueOnce(new Error("CONFLICT"));
  fireEvent.submit(form);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(t.errors.CONFLICT),
  );
  expect(org.value).toBe("Fictional workspace");
  expect(product.value).toBe("Fictional product");
  expect(org.matches(":disabled")).toBe(false);
});

test("opening authorization or consent without an assistant request offers recovery and makes no grants", () => {
  const view = render(<Authorization />);
  expect(screen.getByText(t.authFlowMissing)).toBeTruthy();
  expect(
    screen.getByRole("link", { name: t.backToWorkspace }).getAttribute("href"),
  ).toBe("/");
  view.rerender(<Consent />);
  expect(screen.getByText(t.authFlowMissing)).toBeTruthy();
  expect(screen.queryByRole("button", { name: t.accept })).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

test("organization changes discard old products and ignore a late product response", async () => {
  query = new URLSearchParams("sig=signed&client_id=assistant");
  const late = deferred();
  const fresh = deferred();
  request.mockResolvedValueOnce([
    { id: "a", name: "Org A" },
    { id: "b", name: "Org B" },
  ]);
  request.mockReturnValueOnce(late.promise).mockReturnValueOnce(fresh.promise);
  render(<Authorization />);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByLabelText(t.workspace), {
    target: { value: "b" },
  });
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(request.mock.calls[1][1]?.signal?.aborted).toBe(true);
  await act(async () => late.resolve(products("old", "Old product")));
  expect(screen.queryByLabelText("Old product")).toBeNull();
  expect(
    (screen.getByRole("button", { name: t.continue }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await act(async () => fresh.resolve(products("new", "New product")));
  expect(
    (screen.getByLabelText("New product") as HTMLInputElement).checked,
  ).toBe(false);
  expect(screen.queryByLabelText("Old product")).toBeNull();
});

test("grant submission captures one selection, locks pending fields and never continues a replaced OAuth request", async () => {
  query = new URLSearchParams("sig=first&client_id=assistant");
  request
    .mockResolvedValueOnce([{ id: "org", name: "Org" }])
    .mockResolvedValueOnce(products("p", "Product"));
  const pending = deferred();
  request.mockReturnValueOnce(pending.promise);
  const view = render(<Authorization />);
  await waitFor(() => expect(screen.getByLabelText("Product")).toBeTruthy());
  fireEvent.click(screen.getByLabelText("Product"));
  const form = screen
    .getByLabelText(t.workspace)
    .closest("form") as HTMLFormElement;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(
    request.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  expect(screen.getByLabelText(t.workspace).matches(":disabled")).toBe(true);
  expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toEqual({
    organizationId: "org",
    productIds: ["p"],
    oauth_query: "sig=first&client_id=assistant",
  });
  query = new URLSearchParams("sig=second&client_id=assistant");
  view.rerender(<Authorization />);
  await act(async () => pending.resolve({}));
  expect(
    request.mock.calls.some(([url]) => url === "/api/auth/oauth2/continue"),
  ).toBe(false);
});

test("consent cannot accept an old grant while a different request is loading", async () => {
  query = new URLSearchParams("sig=first&client_id=assistant");
  request.mockResolvedValueOnce({
    organization: "Old org",
    products: ["Old product"],
    clientName: "Old assistant",
  });
  const next = deferred();
  request.mockReturnValueOnce(next.promise);
  const view = render(<Consent />);
  await waitFor(() => expect(screen.getByText("Old assistant")).toBeTruthy());
  query = new URLSearchParams("sig=second&client_id=assistant");
  view.rerender(<Consent />);
  expect(screen.queryByText("Old assistant")).toBeNull();
  expect(
    (screen.getByRole("button", { name: t.accept }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: t.accept }));
  expect(
    request.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(0);
  await act(async () =>
    next.resolve({
      organization: "New org",
      products: ["New product"],
      clientName: "New assistant",
    }),
  );
  const accepted = deferred();
  request.mockReturnValueOnce(accepted.promise);
  fireEvent.click(screen.getByRole("button", { name: t.accept }));
  fireEvent.click(screen.getByRole("button", { name: t.decline }));
  expect(
    request.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  expect(JSON.parse(String(request.mock.calls[2][1]?.body)).oauth_query).toBe(
    "sig=second&client_id=assistant",
  );
  await act(async () => accepted.resolve({ url: "javascript:invalid" }));
  expect(screen.getByRole("alert").textContent).toBe(t.errors.INVALID_INPUT);
});

test("social login blocks duplicate clicks and rejects unsafe callback origins", async () => {
  query = new URLSearchParams("callbackURL=https://elsewhere.example/path");
  const pending = deferred();
  request.mockReturnValueOnce(pending.promise);
  render(<SignIn providers={["google", "github"]} demo={false} />);
  fireEvent.click(screen.getByRole("button", { name: t.googleSignIn }));
  fireEvent.click(screen.getByRole("button", { name: t.githubSignIn }));
  expect(request).toHaveBeenCalledOnce();
  expect(JSON.parse(String(request.mock.calls[0][1]?.body)).callbackURL).toBe(
    "/",
  );
  await act(async () => pending.resolve({ url: "javascript:invalid" }));
  expect(screen.getByRole("alert").textContent).toBe(t.errors.INVALID_INPUT);
});

const connectionData = {
  products: [{ id: "p", name: "Product" }],
  grants: [{ id: "g", productIds: ["p"] }],
} as unknown as ClientSnapshot;
test("connections render a canonical endpoint on the server, disclose offline providers and copy with visible recovery", async () => {
  const endpoint = "https://gravity.example.test/mcp";
  const props = {
    data: connectionData,
    endpoint,
    demo: true,
    onRevoke: vi.fn(async () => true),
  };
  expect(renderToString(<Connections {...props} />)).toContain(endpoint);
  const writeText = vi
    .fn()
    .mockRejectedValueOnce(new Error("Clipboard unavailable"))
    .mockResolvedValueOnce(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<Connections {...props} />);
  expect(screen.getByRole("heading", { name: t.calendar })).toBeTruthy();
  expect(screen.getAllByText(t.notConnected)).toHaveLength(4);
  expect((screen.getByLabelText(t.mcpEndpoint) as HTMLInputElement).value).toBe(
    endpoint,
  );
  expect(screen.getByText(t.mcpOffline)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: t.copyMcpEndpoint }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(t.copyFailed),
  );
  fireEvent.click(screen.getByRole("button", { name: t.copyMcpEndpoint }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(t.copied),
  );
  expect(writeText).toHaveBeenLastCalledWith(endpoint);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("assistant grant revocation is single-flight and releases its control after failure", async () => {
  const pending = deferred<boolean>();
  const onRevoke = vi.fn(() => pending.promise);
  render(
    <Connections
      data={connectionData}
      endpoint="https://gravity.example.test/mcp"
      demo={false}
      onRevoke={onRevoke}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: t.revoke }));
  fireEvent.click(screen.getByRole("button", { name: t.saving }));
  expect(onRevoke).toHaveBeenCalledExactlyOnceWith("g");
  await act(async () => pending.resolve(false));
  expect(
    (screen.getByRole("button", { name: t.revoke }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

test("first-time assistant setup preserves its request through onboarding instead of dropping the flow", async () => {
  query = new URLSearchParams(
    "sig=original&client_id=assistant&redirect_uri=https%3A%2F%2Fclient.example.test%2Fcallback",
  );
  request.mockResolvedValueOnce([]);
  render(<Authorization />);
  await waitFor(() =>
    expect(screen.getByRole("link", { name: t.createWorkspace })).toBeTruthy(),
  );
  const destination = new URL(
    screen
      .getByRole("link", { name: t.createWorkspace })
      .getAttribute("href") ?? "",
    "https://gravity.example.test",
  );
  expect(destination.pathname).toBe("/onboarding");
  expect(destination.searchParams.get("oauth_query")).toBe(query.toString());
  const { workspaceDestination } = await import(
    "../src/components/workspace-destination"
  );
  const result = { organizationId: "org", productId: "product" };
  expect(
    workspaceDestination(
      result,
      destination.searchParams.get("oauth_query") ?? "",
    ),
  ).toBe(`/authorize?${query.toString()}`);
  expect(workspaceDestination(result)).toBe(
    "/?organizationId=org&productId=product",
  );
  expect(
    workspaceDestination(result, "redirect_uri=https://evil.example"),
  ).toBe("/?organizationId=org&productId=product");
});
