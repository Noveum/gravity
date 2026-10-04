import { describe, expect, test } from 'bun:test';
import { byteOrderMarks, controlBytes, describeMark, isCodeSource } from '../check-source-bytes.ts';

const encoder = new TextEncoder();

describe('byteOrderMarks', () => {
  test('finds a mark at the start of a file and inside a string, with its line', () => {
    const data = encoder.encode("\u{FEFF}const a = 1;\nconst b = '\u{FEFF}';\n");
    const found = byteOrderMarks(data);
    expect(found.map((entry) => [entry.line, entry.offset])).toEqual([
      [1, 0],
      [2, 27],
    ]);
  });

  test('ignores the escape written in source and other multibyte text', () => {
    const data = encoder.encode("const a = '\\u{FEFF}';\nconst b = '\u00e9\u20ac\u{1f600}';\n");
    expect(byteOrderMarks(data)).toEqual([]);
  });

  test('names the file, the line and the fix', () => {
    const [entry] = byteOrderMarks(encoder.encode('a\n\u{FEFF}'));
    expect(entry).toBeDefined();
    expect(describeMark('x.ts', entry ?? { offset: 0, line: 0, byte: 0 })).toBe(
      'x.ts:2: literal byte order mark at offset 2, write it as the escape \\u{FEFF}',
    );
  });
});

describe('controlBytes', () => {
  test('still finds a NUL and lets tab, newline and carriage return through', () => {
    expect(controlBytes(encoder.encode('a\tb\r\nc')).length).toBe(0);
    expect(controlBytes(new Uint8Array([0x61, 0x00, 0x62])).map((entry) => entry.byte)).toEqual([
      0,
    ]);
  });
});

describe('isCodeSource', () => {
  test('covers script and typescript files and not documents', () => {
    expect(['a.ts', 'dir/b.tsx', 'c.mjs', 'd.js'].every(isCodeSource)).toBe(true);
    expect(['plan.md', 'data.csv', 'package.json', 'noext'].some(isCodeSource)).toBe(false);
  });
});
