import { mock } from 'bun:test';

export function setViewport(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: mock(),
      removeEventListener: mock(),
      addListener: mock(),
      removeListener: mock(),
      dispatchEvent: mock(),
    }),
  });
}

const MIN_WIDTH = /\(min-width:\s*(\d+)px\)/;

export function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: Number(MIN_WIDTH.exec(query)?.[1] ?? Number.POSITIVE_INFINITY) <= width,
      media: query,
      onchange: null,
      addEventListener: mock(),
      removeEventListener: mock(),
      addListener: mock(),
      removeListener: mock(),
      dispatchEvent: mock(),
    }),
  });
}
