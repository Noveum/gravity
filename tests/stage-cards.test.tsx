// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import t from "../packages/i18n/translations/en.json";
import { StageCards } from "../src/components/records/stage-cards";

afterEach(cleanup);

test("each board stage pages its own records without hiding another stage", () => {
  const rows = Array.from({ length: 123 }, (_, index) => ({
    id: `deal-${index}`,
  }));
  const view = render(
    <>
      <section aria-label="Discovery">
        <StageCards rows={rows} scope="discovery">
          {(items) =>
            items.map((row) => (
              <button type="button" key={row.id}>
                {row.id}
              </button>
            ))
          }
        </StageCards>
      </section>
      <section aria-label="Proposal">
        <StageCards rows={[{ id: "proposal-last" }]} scope="proposal">
          {(items) =>
            items.map((row) => (
              <button type="button" key={row.id}>
                {row.id}
              </button>
            ))
          }
        </StageCards>
      </section>
    </>,
  );
  const discovery = within(screen.getByRole("region", { name: "Discovery" }));
  expect(discovery.getByRole("button", { name: "deal-0" })).toBeTruthy();
  expect(discovery.queryByRole("button", { name: "deal-122" })).toBeNull();
  fireEvent.click(discovery.getByRole("button", { name: t.nextPage }));
  fireEvent.click(discovery.getByRole("button", { name: t.nextPage }));
  expect(discovery.getByRole("button", { name: "deal-122" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "proposal-last" })).toBeTruthy();
  expect(discovery.getByRole("button", { name: t.nextPage })).toHaveProperty(
    "disabled",
    true,
  );
  view.rerender(
    <section aria-label="Discovery">
      <StageCards rows={rows.slice(0, 100)} scope="discovery:filtered">
        {(items) =>
          items.map((row) => (
            <button type="button" key={row.id}>
              {row.id}
            </button>
          ))
        }
      </StageCards>
    </section>,
  );
  const filtered = within(screen.getByRole("region", { name: "Discovery" }));
  expect(filtered.getByRole("button", { name: "deal-0" })).toBeTruthy();
  expect(filtered.queryByRole("button", { name: "deal-99" })).toBeNull();
});
