import { fireEvent, screen, within } from "@testing-library/react";

/** Pick an option through the rendered control, for both native and Radix selects. */
export async function chooseSelect(control: HTMLElement, label: string) {
  if (control instanceof HTMLSelectElement) {
    const option = within(control).getByRole("option", {
      name: label,
    }) as HTMLOptionElement;
    fireEvent.change(control, { target: { value: option.value } });
    return;
  }
  fireEvent.keyDown(control, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: label }));
}
