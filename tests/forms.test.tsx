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
import { PersonDialog } from "../src/components/person-dialog";
import { SettingsForm } from "../src/components/settings-form";

vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const request = vi.mocked(requestJson);
// Minimal authorized DTO for form options; database integrity is exercised by the SQL suites.
const snapshot = {
  products: [{ id: "product", name: "Fictional Product" }],
  people: [],
  companies: [],
  relationships: [],
} as unknown as ClientSnapshot;
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
    this.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  request.mockReset();
});
function person(onClose = vi.fn(), onCreated = vi.fn(async () => {})) {
  return {
    onClose,
    onCreated,
    ...render(
      <PersonDialog
        data={snapshot}
        organizationId="org"
        productId="product"
        onClose={onClose}
        onCreated={onCreated}
      />,
    ),
  };
}

test("a person form focuses its primary field after scope loads and retains values on a failed save", async () => {
  let loaded!: (data: ClientSnapshot) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        loaded = resolve;
      }),
  );
  request.mockRejectedValueOnce(new Error("CONFLICT"));
  const { onClose } = person();
  expect((screen.getByLabelText(t.name) as HTMLInputElement).disabled).toBe(
    false,
  ); // fieldset owns disabling
  expect(screen.getByLabelText(t.name).matches(":disabled")).toBe(true);
  await act(async () => loaded(snapshot));
  const name = screen.getByLabelText(t.name) as HTMLInputElement;
  expect(document.activeElement).toBe(name);
  fireEvent.change(name, { target: { value: "Fictional Test Buyer" } });
  fireEvent.keyDown(name, { key: "Enter", ctrlKey: true });
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(t.errors.CONFLICT),
  );
  expect(name.value).toBe("Fictional Test Buyer");
  expect(name.matches(":disabled")).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
});

test("failed scope reads block submission until retry succeeds", async () => {
  request.mockRejectedValueOnce(new Error("FORBIDDEN"));
  person();
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(t.errors.FORBIDDEN),
  );
  expect(screen.getByLabelText(t.name).matches(":disabled")).toBe(true);
  fireEvent.submit(
    screen.getByLabelText(t.name).closest("form") as HTMLFormElement,
  );
  expect(request).toHaveBeenCalledTimes(1);
  request.mockResolvedValueOnce(snapshot);
  fireEvent.click(screen.getByRole("button", { name: t.retry }));
  await waitFor(() =>
    expect(screen.getByLabelText(t.name).matches(":disabled")).toBe(false),
  );
});

test("double submission creates one person, locks fields, and invokes creation once", async () => {
  request.mockResolvedValueOnce(snapshot);
  let saved!: (value: unknown) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        saved = resolve;
      }),
  );
  const { onClose, onCreated } = person();
  await waitFor(() =>
    expect(screen.getByLabelText(t.name).matches(":disabled")).toBe(false),
  );
  const name = screen.getByLabelText(t.name);
  fireEvent.change(name, { target: { value: "Fictional Buyer" } });
  const form = name.closest("form") as HTMLFormElement;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(
    request.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  expect(name.matches(":disabled")).toBe(true);
  await act(async () =>
    saved({ relationshipId: "relationship", productId: "product" }),
  );
  expect(onCreated).toHaveBeenCalledExactlyOnceWith({
    relationshipId: "relationship",
    productId: "product",
  });
  expect(onClose).toHaveBeenCalledOnce();
});

test("organization settings preserve values and prevent overlapping submissions", async () => {
  let finish: (success: boolean) => void = () => {};
  const mutate = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const reload = vi.fn(async () => {});
  render(
    <SettingsForm
      organization={{
        id: "org",
        name: "Northstar",
        slug: "northstar",
        timezone: "UTC",
      }}
      disabled={false}
      mutate={mutate}
      onOrganizations={reload}
    />,
  );
  const name = screen.getByLabelText(t.organizationName) as HTMLInputElement;
  fireEvent.change(name, { target: { value: "Fictional correction" } });
  const form = name.closest("form") as HTMLFormElement;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mutate).toHaveBeenCalledOnce();
  expect(mutate).toHaveBeenCalledWith({
    operation: "organization-settings",
    organizationId: "org",
    name: "Fictional correction",
    timezone: "UTC",
  });
  expect(name.matches(":disabled")).toBe(true);
  await act(async () => finish(false));
  expect(name.value).toBe("Fictional correction");
  expect(reload).not.toHaveBeenCalled();
  fireEvent.submit(form);
  await act(async () => finish(true));
  expect(name.value).toBe("Fictional correction");
  expect(reload).toHaveBeenCalledOnce();
});

test("a dialog shows the shared loading state while its scope loads", async () => {
  let loaded!: (data: ClientSnapshot) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        loaded = resolve;
      }),
  );
  person();
  const loading = screen.getByRole("status");
  expect(loading.getAttribute("aria-busy")).toBe("true");
  expect(loading.classList.contains("loading-state")).toBe(true);
  expect(loading.textContent).toBe(t.loading);
  await act(async () => loaded(snapshot));
  expect(screen.queryByRole("status")).toBeNull();
});
