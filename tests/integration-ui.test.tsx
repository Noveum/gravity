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
    screen
      .getByRole("button", { name: "Connect LinkedIn" })
      .matches(":disabled"),
  ).toBe(true);
  expect(screen.getByText(t.unipileSetupRequired)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Connect Gmail" }));
  expect(screen.getByRole("dialog").textContent).toContain(t.googleConnectNote);
  expect(screen.getByLabelText(t.defaultProduct)).toBeTruthy();
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
