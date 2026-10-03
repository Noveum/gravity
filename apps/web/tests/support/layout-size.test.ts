import { describe, expect, test } from 'bun:test';
import { stubLayoutProperty, stubLayoutSize } from './layout-size.ts';

function ownDescriptor(name: string): PropertyDescriptor | undefined {
  return Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
}

const originalWidth = ownDescriptor('offsetWidth');
const originalHeight = ownDescriptor('offsetHeight');
const originalScrollHeight = ownDescriptor('scrollHeight');

describe('stubLayoutSize', () => {
  stubLayoutSize(320, 240);
  stubLayoutProperty('scrollHeight', 900);

  test('every element reports the stubbed size', () => {
    const element = document.createElement('div');
    expect(element.offsetWidth).toBe(320);
    expect(element.offsetHeight).toBe(240);
    expect(element.scrollHeight).toBe(900);
  });
});

test('the original descriptors are back afterwards, absent ones included', () => {
  expect(originalScrollHeight).toBeUndefined();
  expect(ownDescriptor('scrollHeight')).toBeUndefined();
  expect(document.createElement('div').scrollHeight).toBe(0);
  expect(ownDescriptor('offsetWidth')).toEqual(originalWidth);
  expect(ownDescriptor('offsetHeight')).toEqual(originalHeight);
});
