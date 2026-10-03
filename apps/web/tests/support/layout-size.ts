import { afterAll, beforeAll } from 'bun:test';

export function stubLayoutSize(width: number, height: number): void {
  const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const realHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => width,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => height,
    });
  });
  afterAll(() => {
    if (realWidth !== undefined) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realWidth);
    }
    if (realHeight !== undefined) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realHeight);
    }
  });
}
