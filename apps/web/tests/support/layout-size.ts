import { afterAll, beforeAll } from 'bun:test';

export type LayoutProperty = 'offsetWidth' | 'offsetHeight' | 'clientHeight' | 'scrollHeight';

export function stubLayoutProperty(name: LayoutProperty, value: number): void {
  const prototype = HTMLElement.prototype;
  let original: PropertyDescriptor | undefined;
  beforeAll(() => {
    original = Object.getOwnPropertyDescriptor(prototype, name);
    Object.defineProperty(prototype, name, { configurable: true, get: () => value });
  });
  afterAll(() => {
    if (original === undefined) Reflect.deleteProperty(prototype, name);
    else Object.defineProperty(prototype, name, original);
  });
}

export function stubLayoutSize(width: number, height: number): void {
  stubLayoutProperty('offsetWidth', width);
  stubLayoutProperty('offsetHeight', height);
}
