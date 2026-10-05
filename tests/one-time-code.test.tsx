// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, expect, test } from "vitest";
import t from "../packages/i18n/translations/en.json";
import { OneTimeCode } from "../src/components/one-time-code";

afterEach(cleanup);
function CodeForm({
  disabled = false,
  invalid = false,
}: {
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  return (
    <form>
      <p id="otp-instructions">{t.signInCode}</p>
      <OneTimeCode
        value={value}
        onChange={setValue}
        inputRef={ref}
        disabled={disabled}
        invalid={invalid}
      />
      <button type="button">{t.changeEmail}</button>
    </form>
  );
}

test("six visual slots retain one accessible keyboard field, leading zeros and native validity", async () => {
  const user = userEvent.setup();
  const { container } = render(<CodeForm />);
  const input = screen.getByLabelText(t.signInCode) as HTMLInputElement;
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(container.querySelectorAll(".auth-code-slot")).toHaveLength(6);
  expect(input.checkValidity()).toBe(false);
  await user.tab();
  expect(document.activeElement).toBe(input);
  await user.keyboard("01a2345");
  expect(input.value).toBe("012345");
  expect(input.checkValidity()).toBe(true);
  await user.keyboard("{Backspace}");
  expect(input.value).toBe("01234");
  expect(input.checkValidity()).toBe(false);
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: t.changeEmail }),
  );
});

test("paste and autofill normalize code formatting without converting it to a number", () => {
  const { container } = render(<CodeForm />);
  const input = screen.getByLabelText(t.signInCode) as HTMLInputElement;
  fireEvent.paste(input, { clipboardData: { getData: () => "012 345" } });
  expect(input.value).toBe("012345");
  expect(container.querySelector(".auth-code-slots")?.textContent).toBe(
    "012345",
  );
  fireEvent.change(input, { target: { value: "00-1234" } });
  expect(input.value).toBe("001234");
  expect(input.autocomplete).toBe("one-time-code");
  expect(input.inputMode).toBe("numeric");
  fireEvent.paste(input, { clipboardData: { getData: () => "no code here" } });
  expect(input.value).toBe("001234");
});

test("invalid and pending states stay accessible without adding six extra tab stops", () => {
  const { rerender } = render(<CodeForm invalid />);
  const input = screen.getByLabelText(t.signInCode) as HTMLInputElement;
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-describedby")).toBe("otp-instructions");
  rerender(<CodeForm disabled />);
  expect(input.disabled).toBe(true);
  expect(input.getAttribute("aria-invalid")).toBeNull();
});
