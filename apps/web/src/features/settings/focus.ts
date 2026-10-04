const FOCUSABLE = 'button:not(:disabled), a[href]';

export function focusNeighbourOf(row: Element | null, fallback: HTMLElement | null): void {
  const neighbour = row?.nextElementSibling ?? row?.previousElementSibling ?? null;
  const target = neighbour?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
  (target ?? fallback)?.focus();
}
