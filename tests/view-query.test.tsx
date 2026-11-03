// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useInsertionEffect } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import t from "../packages/i18n/translations/en.json";
import {
  ValueFilter,
  type ValueFilters,
} from "../src/components/records/value-filter";
import {
  currentViewQuery,
  replaceViewQuery,
  useViewQuery,
} from "../src/components/view-query";

const router = vi.hoisted(() => ({ search: "" }));

// Model Next's delayed native-history echo: router props remain at the initial URL.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(router.search),
}));

function RangePicker() {
  const query = useViewQuery();
  const filters: ValueFilters = {
    minimum: query.get("minimum") ?? "",
    maximum: query.get("maximum") ?? "",
    currency: "",
    size: "",
  };
  return (
    <>
      <ValueFilter
        filters={filters}
        amountMaximum={5000}
        currencies={["USD"]}
        invalid={false}
        onChange={(values) => {
          const next = currentViewQuery();
          for (const [key, value] of Object.entries(values)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          replaceViewQuery(next);
        }}
      />
      <button
        type="button"
        onClick={() => replaceViewQuery(new URLSearchParams())}
      >
        Clear all
      </button>
      <output>
        {Number(filters.minimum || 0) <= 5000 &&
        Number(filters.maximum || Infinity) >= 5000
          ? "Cedar"
          : "No matches"}
      </output>
    </>
  );
}

beforeEach(() => {
  router.search = "";
  window.history.replaceState(null, "", "/opportunities");
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

function openRange() {
  render(<RangePicker />);
  fireEvent.click(screen.getByRole("button", { name: t.uiRefresh.dealValue }));
  return within(screen.getByRole("dialog", { name: t.uiRefresh.dealValue }));
}

test("a numeric upper bound immediately drives the next slider step before Next echoes the URL", async () => {
  const controls = openRange();
  fireEvent.change(controls.getByLabelText(t.maximumDealSize), {
    target: { value: "6000" },
  });
  fireEvent.change(controls.getByLabelText(t.minimumDealSize), {
    target: { value: "1000" },
  });
  controls.getByRole("slider", { name: t.uiRefresh.maximumSlider }).focus();
  await userEvent.setup().keyboard("{ArrowLeft}");
  expect(currentViewQuery().get("minimum")).toBe("1000");
  expect(currentViewQuery().get("maximum")).toBe("5940.00");
  expect(controls.getByLabelText(t.maximumDealSize)).toHaveProperty(
    "value",
    "5940.00",
  );
  expect(screen.getByRole("status").textContent).toBe("Cedar");
});

test("clearing back to the original URL and browser navigation reset controlled range values without an echo", () => {
  const controls = openRange();
  fireEvent.change(controls.getByLabelText(t.minimumDealSize), {
    target: { value: "1000" },
  });
  expect(controls.getByLabelText(t.minimumDealSize)).toHaveProperty(
    "value",
    "1000",
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
  expect(controls.getByLabelText(t.minimumDealSize)).toHaveProperty(
    "value",
    "",
  );
  act(() => {
    window.history.replaceState(
      null,
      "",
      "/opportunities?minimum=2000&maximum=7000",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(controls.getByLabelText(t.minimumDealSize)).toHaveProperty(
    "value",
    "2000",
  );
  expect(controls.getByLabelText(t.maximumDealSize)).toHaveProperty(
    "value",
    "7000",
  );
});

test("router navigation rechecks the URL after Next commits browser history", () => {
  function RouteCommit({ search }: { search: string }) {
    useInsertionEffect(() => {
      window.history.replaceState(
        null,
        "",
        `/opportunities${search ? `?${search}` : ""}`,
      );
    }, [search]);
    return <RangePicker />;
  }
  const view = render(<RouteCommit search="" />);
  fireEvent.click(screen.getByRole("button", { name: t.uiRefresh.dealValue }));
  const controls = within(
    screen.getByRole("dialog", { name: t.uiRefresh.dealValue }),
  );
  router.search = "minimum=2000&maximum=7000";
  view.rerender(<RouteCommit search={router.search} />);
  expect(controls.getByLabelText(t.minimumDealSize)).toHaveProperty(
    "value",
    "2000",
  );
  expect(controls.getByLabelText(t.maximumDealSize)).toHaveProperty(
    "value",
    "7000",
  );
});

test("navigation clears a native edit even when Next has not echoed it and its search snapshot stays unchanged", () => {
  function RouteCommit({ path }: { path: string }) {
    useInsertionEffect(() => {
      window.history.replaceState(null, "", path);
    }, [path]);
    return <RangePicker />;
  }
  const view = render(<RouteCommit path="/opportunities" />);
  fireEvent.click(screen.getByRole("button", { name: t.uiRefresh.dealValue }));
  const controls = within(
    screen.getByRole("dialog", { name: t.uiRefresh.dealValue }),
  );
  fireEvent.change(controls.getByLabelText(t.minimumDealSize), {
    target: { value: "1000" },
  });
  expect(controls.getByLabelText(t.minimumDealSize)).toHaveProperty(
    "value",
    "1000",
  );
  view.rerender(<RouteCommit path="/people" />);
  expect(controls.getByLabelText(t.minimumDealSize)).toHaveProperty(
    "value",
    "",
  );
});
