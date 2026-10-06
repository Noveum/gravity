import { expect, it } from 'bun:test';
import { isFileInput } from '@/features/files/file-shortcuts.ts';

it('allows file shortcuts after checkbox selection while preserving typing in text inputs', () => {
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  expect(isFileInput(checkbox)).toBe(false);
  const text = document.createElement('input');
  text.type = 'text';
  expect(isFileInput(text)).toBe(true);
  expect(isFileInput(document.createElement('textarea'))).toBe(true);
});
