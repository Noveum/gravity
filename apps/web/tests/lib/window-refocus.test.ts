import { describe, expect, test } from 'bun:test';
import { isWindowRefocus, watchWindowRefocus } from '@/lib/window-refocus.ts';

watchWindowRefocus();

describe('isWindowRefocus', () => {
  test('a focus from outside the document right after the window blurred is a refocus, once', () => {
    window.dispatchEvent(new Event('blur'));
    expect(isWindowRefocus({ relatedTarget: null })).toBe(true);
    expect(isWindowRefocus({ relatedTarget: null })).toBe(false);
  });

  test('a focus moved from another element is never a refocus', () => {
    window.dispatchEvent(new Event('blur'));
    expect(isWindowRefocus({ relatedTarget: document.body })).toBe(false);
  });

  test('a click or key press after the blur means the user is choosing the focus', () => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('pointerdown'));
    expect(isWindowRefocus({ relatedTarget: null })).toBe(false);
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(isWindowRefocus({ relatedTarget: null })).toBe(false);
  });
});
