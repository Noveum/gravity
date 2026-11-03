// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { parseMoney } from "../packages/core/analytics";
import t from "../packages/i18n/translations/en.json";
import {
  ValueFilter,
  type ValueFilters,
} from "../src/components/records/value-filter";
import { chooseSelect } from "./support/select-control";

const empty: ValueFilters = {
  minimum: "",
  maximum: "",
  currency: "",
  size: "",
};

function Picker({
  initial = empty,
  maximum = 10000,
  changed = () => {},
}: {
  initial?: ValueFilters;
  maximum?: number;
  changed?: (change: Partial<ValueFilters>) => void;
}) {
  const [filters, setFilters] = useState(initial);
  let invalid = false;
  try {
    const minimum = parseMoney(filters.minimum, filters.currency || "USD");
    const maximum = parseMoney(filters.maximum, filters.currency || "USD");
    invalid = minimum !== null && maximum !== null && minimum > maximum;
  } catch {
    invalid = true;
  }
  return (
    <ValueFilter
      filters={filters}
      amountMaximum={maximum}
      currencies={["USD", "JPY", "KWD"]}
      invalid={invalid}
      onChange={(change) => {
        changed(change);
        setFilters((current) => ({ ...current, ...change }));
      }}
    />
  );
}

const trigger = () =>
  screen.getByRole("button", { name: t.uiRefresh.dealValue });
const popup = () => screen.getByRole("dialog", { name: t.uiRefresh.dealValue });
function open() {
  fireEvent.click(trigger());
  return within(popup());
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("empty defaults use numeric hints without applying a range or selecting a currency", () => {
  const changed = vi.fn();
  render(<Picker changed={changed} maximum={7500} />);
  expect(trigger().textContent).toBe(t.uiRefresh.dealValue);
  const controls = open();
  const minimum = controls.getByLabelText(t.minimumDealSize);
  const maximum = controls.getByLabelText(t.maximumDealSize);
  expect(minimum).toHaveProperty("value", "");
  expect(maximum).toHaveProperty("value", "");
  expect(minimum.getAttribute("placeholder")).toBe("0");
  expect(maximum.getAttribute("placeholder")).toBe("7500");
  expect(controls.getByRole("combobox", { name: t.currency }).textContent).toBe(
    t.allCurrencies,
  );
  expect(changed).not.toHaveBeenCalled();
  expect(
    controls.getByRole("button", { name: t.uiRefresh.resetValue }),
  ).toHaveProperty("disabled", true);
});

test("keyboard sliders emit one atomic range update and restoring the full range clears both bounds", async () => {
  const changed = vi.fn();
  render(<Picker changed={changed} />);
  const controls = open();
  const minimum = controls.getByRole("slider", {
    name: t.uiRefresh.minimumSlider,
  });
  const maximum = controls.getByRole("slider", {
    name: t.uiRefresh.maximumSlider,
  });
  const keyboard = userEvent.setup();
  minimum.focus();
  await keyboard.keyboard("{ArrowRight}");
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenLastCalledWith({
    minimum: "100.00",
    maximum: "",
  });
  maximum.focus();
  await keyboard.keyboard("{ArrowLeft}");
  expect(changed).toHaveBeenCalledTimes(2);
  expect(changed).toHaveBeenLastCalledWith({
    minimum: "100.00",
    maximum: "9900.00",
  });
  minimum.focus();
  await keyboard.keyboard("{Home}");
  maximum.focus();
  await keyboard.keyboard("{End}");
  expect(changed).toHaveBeenLastCalledWith({ minimum: "", maximum: "" });
  expect(controls.getByLabelText(t.minimumDealSize)).toHaveProperty(
    "value",
    "",
  );
  expect(controls.getByLabelText(t.maximumDealSize)).toHaveProperty(
    "value",
    "",
  );
});

test.each([
  { currency: "JPY", step: "1", minimum: "125", maximum: "999" },
  { currency: "USD", step: "0.01", minimum: "125.50", maximum: "999.99" },
  { currency: "KWD", step: "0.001", minimum: "125.501", maximum: "999.999" },
])(
  "exact $currency inputs retain their currency's precision",
  ({ currency, step, minimum, maximum }) => {
    const changed = vi.fn();
    render(<Picker initial={{ ...empty, currency }} changed={changed} />);
    const controls = open();
    const minimumInput = controls.getByLabelText(t.minimumDealSize);
    const maximumInput = controls.getByLabelText(t.maximumDealSize);
    expect(minimumInput.getAttribute("step")).toBe(step);
    expect(maximumInput.getAttribute("step")).toBe(step);
    fireEvent.change(minimumInput, { target: { value: minimum } });
    expect(changed).toHaveBeenLastCalledWith({ minimum });
    fireEvent.change(maximumInput, { target: { value: maximum } });
    expect(changed).toHaveBeenLastCalledWith({ maximum });
    expect(minimumInput).toHaveProperty("value", minimum);
    expect(maximumInput).toHaveProperty("value", maximum);
    expect(minimumInput.getAttribute("aria-invalid")).toBe("false");
    expect(maximumInput.getAttribute("aria-invalid")).toBe("false");
    fireEvent.change(minimumInput, { target: { value: "" } });
    fireEvent.change(maximumInput, { target: { value: "" } });
    expect(changed).toHaveBeenLastCalledWith({ maximum: "" });
    expect(minimumInput).toHaveProperty("value", "");
    expect(maximumInput).toHaveProperty("value", "");
  },
);

test("invalid bounds disable slider changes and Reset removes the range, currency and size together", async () => {
  const changed = vi.fn();
  render(
    <Picker
      initial={{
        minimum: "900",
        maximum: "100",
        currency: "USD",
        size: "known",
      }}
      changed={changed}
    />,
  );
  expect(trigger().textContent).toBe(t.uiRefresh.invalidRange);
  const controls = open();
  const minimum = controls.getByRole("slider", {
    name: t.uiRefresh.minimumSlider,
  });
  minimum.focus();
  await userEvent.setup().keyboard("{ArrowRight}");
  expect(changed).not.toHaveBeenCalled();
  expect(
    controls.getByLabelText(t.minimumDealSize).getAttribute("aria-invalid"),
  ).toBe("true");
  fireEvent.click(
    controls.getByRole("button", { name: t.uiRefresh.resetValue }),
  );
  expect(changed).toHaveBeenCalledExactlyOnceWith(empty);
  expect(trigger().textContent).toBe(t.uiRefresh.dealValue);
  expect(controls.getByLabelText(t.minimumDealSize)).toHaveProperty(
    "value",
    "",
  );
  expect(controls.getByLabelText(t.maximumDealSize)).toHaveProperty(
    "value",
    "",
  );
});

test("nested currency selection leaves the popover open and Escape closes one layer at a time with focus restoration", async () => {
  render(<Picker />);
  const controls = open();
  const currency = controls.getByRole("combobox", { name: t.currency });
  await chooseSelect(currency, "KWD");
  expect(popup()).toBeTruthy();
  expect(currency.textContent).toBe("KWD");
  currency.focus();
  fireEvent.keyDown(currency, { key: "ArrowDown" });
  expect(await screen.findByRole("listbox")).toBeTruthy();
  const keyboard = userEvent.setup();
  await keyboard.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  expect(popup()).toBeTruthy();
  expect(document.activeElement).toBe(currency);
  await keyboard.keyboard("{Escape}");
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: t.uiRefresh.dealValue }),
    ).toBeNull(),
  );
  expect(document.activeElement).toBe(trigger());
});

test("compact KWD summaries distinguish valid bounds that differ by one minor unit", () => {
  render(
    <Picker
      initial={{
        ...empty,
        currency: "KWD",
        minimum: "0.123",
        maximum: "0.124",
      }}
    />,
  );
  expect(trigger().textContent).toContain("0.123");
  expect(trigger().textContent).toContain("0.124");
  const controls = open();
  expect(controls.getByLabelText(t.minimumDealSize)).toHaveProperty(
    "value",
    "0.123",
  );
  expect(controls.getByLabelText(t.maximumDealSize)).toHaveProperty(
    "value",
    "0.124",
  );
});

test("an oversized invalid amount retains a finite disabled slider and can be reset", () => {
  const changed = vi.fn();
  render(<Picker initial={{ ...empty, minimum: "1e308" }} changed={changed} />);
  expect(trigger().textContent).toBe(t.uiRefresh.invalidRange);
  const controls = open();
  const maximum = controls.getByRole("slider", {
    name: t.uiRefresh.maximumSlider,
  });
  expect(Number(maximum.getAttribute("aria-valuemax"))).toBe(10000);
  fireEvent.click(
    controls.getByRole("button", { name: t.uiRefresh.resetValue }),
  );
  expect(changed).toHaveBeenCalledExactlyOnceWith(empty);
  expect(trigger().textContent).toBe(t.uiRefresh.dealValue);
});

test("a legal large JPY amount never lets a slider edit exceed the supported minor-unit ceiling", async () => {
  const changed = vi.fn();
  render(
    <Picker
      initial={{ ...empty, currency: "JPY" }}
      maximum={2147483647}
      changed={changed}
    />,
  );
  const controls = open();
  const maximum = controls.getByRole("slider", {
    name: t.uiRefresh.maximumSlider,
  });
  expect(Number(maximum.getAttribute("aria-valuemax"))).toBeLessThanOrEqual(
    2147483647,
  );
  maximum.focus();
  await userEvent.setup().keyboard("{ArrowLeft}");
  const maximumInput = controls.getByLabelText(
    t.maximumDealSize,
  ) as HTMLInputElement;
  expect(maximumInput.getAttribute("aria-invalid")).toBe("false");
  expect(Number(maximumInput.value)).toBeLessThanOrEqual(2147483647);
  expect(changed).toHaveBeenCalledTimes(1);
  await userEvent.setup().keyboard("{End}");
  expect(changed).toHaveBeenLastCalledWith({ minimum: "", maximum: "" });
  expect(maximumInput).toHaveProperty("value", "");
});
