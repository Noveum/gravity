import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  HTTP_IMPORT_LIMITS,
  MAX_IMPORT_CELL_LENGTH,
  MAX_IMPORT_COLUMNS,
} from '../../src/import/constants.ts';
import {
  decodeImportBytes,
  parseCsv,
  parseImportTable,
  parseJsonRecords,
  utf8Length,
} from '../../src/import/table.ts';

const limits = HTTP_IMPORT_LIMITS;

describe('parseCsv', () => {
  test('handles a BOM, CRLF, quoted delimiters, quoted newlines and escaped quotes', () => {
    const table = parseCsv(
      '\u{FEFF}Name,Note\r\n"Lovelace, Ada","Line one\nline ""two"""\r\nGrace,plain\r\n',
      limits,
    );
    expect(table.headers).toEqual(['Name', 'Note']);
    expect(table.rows).toEqual([
      ['Lovelace, Ada', 'Line one\nline "two"'],
      ['Grace', 'plain'],
    ]);
  });

  test('reads mixed and bare carriage return line endings', () => {
    expect(parseCsv('a,b\r1,2\n3,4\r\n5,6\r', limits).rows).toEqual([
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ]);
  });

  test('detects a semicolon export and skips blank lines', () => {
    const table = parseCsv('Name;Email\n\nAda;ada@vela.example\n;\n', limits);
    expect(table.rows).toEqual([['Ada', 'ada@vela.example']]);
  });

  test('detects a tab export and a delimiter after a carriage return only header', () => {
    expect(parseCsv('Name\tEmail\nAda\tada@vela.example\n', limits).headers).toEqual([
      'Name',
      'Email',
    ]);
    expect(parseCsv('Name;Email\rAda;a@b.example,c@d.example\r', limits).rows).toEqual([
      ['Ada', 'a@b.example,c@d.example'],
    ]);
  });

  test('keeps a formula-looking cell verbatim', () => {
    expect(parseCsv('Name\n=HYPERLINK("x")\n', limits).rows).toEqual([['=HYPERLINK("x")']]);
    expect(parseCsv('Name,Phone\n@SUM(1),+15551234567\n-2+3,=1+1\n', limits).rows).toEqual([
      ['@SUM(1)', '+15551234567'],
      ['-2+3', '=1+1'],
    ]);
  });

  test('names empty headers and separates duplicates', () => {
    expect(parseCsv('Email,,Email\na,b,c\n', limits).headers).toEqual([
      'Email',
      'Column 2',
      'Email (2)',
    ]);
  });

  test('never produces two headers with the same name', () => {
    expect(parseCsv('Email,Email,Email (2),Email\n1,2,3,4\n', limits).headers).toEqual([
      'Email',
      'Email (2)',
      'Email (2) (2)',
      'Email (3)',
    ]);
    expect(parseCsv('A,,Column 2\n1,2,3\n', limits).headers).toEqual([
      'A',
      'Column 2',
      'Column 2 (2)',
    ]);
  });

  test('refuses an unterminated quote, a NUL byte, an empty file and a header without rows', () => {
    expect(() => parseCsv('Name\n"Ada\n', limits)).toThrow(
      'The file ends inside a quoted value that starts on line 2.',
    );
    expect(() => parseCsv('Name\nA\u0000da\n', limits)).toThrow(
      'This does not look like a text file.',
    );
    expect(() => parseCsv('\n\n', limits)).toThrow('This file is empty.');
    expect(() => parseCsv('\u{FEFF}', limits)).toThrow('This file is empty.');
    expect(() => parseCsv('Name\n', limits)).toThrow('This file has a header but no rows.');
  });

  test('enforces the byte, row, column and cell caps', () => {
    expect(() => parseCsv(`Name\n${'a'.repeat(30)}\n`, { maxBytes: 20, maxRows: 10 })).toThrow(
      /Import files up to/,
    );
    expect(() => parseCsv('Name\na\nb\nc\n', { maxBytes: 1000, maxRows: 2 })).toThrow(
      'This file has 3 rows. Import at most 2 at a time, or split the file.',
    );
    const wide = Array.from({ length: 101 }, (_, index) => `c${index}`).join(',');
    expect(() => parseCsv(`${wide}\n${wide}\n`, limits)).toThrow(
      'This file has 101 columns. Import at most 100.',
    );
    expect(() => parseCsv(`Name\n${'x'.repeat(MAX_IMPORT_CELL_LENGTH + 1)}\n`, limits)).toThrow(
      'Row 1, column Name is longer than 5000 characters.',
    );
  });

  test('counts every row past the cap without keeping them', () => {
    const content = `Name\n${Array.from({ length: 50 }, (_, index) => `r${index}`).join('\n')}\n`;
    expect(() => parseCsv(content, { maxBytes: 10_000, maxRows: 5 })).toThrow(
      'This file has 50 rows. Import at most 5 at a time, or split the file.',
    );
  });

  test('stops at the first over-long cell instead of reading an unterminated quote to the end', () => {
    const content = `Name\n"${'x'.repeat(MAX_IMPORT_CELL_LENGTH + 1)}\n${'y\n'.repeat(1000)}`;
    expect(() => parseCsv(content, limits)).toThrow(
      'Row 1, column Name is longer than 5000 characters.',
    );
    expect(() => parseCsv(`${'x'.repeat(MAX_IMPORT_CELL_LENGTH + 1)}\n1\n`, limits)).toThrow(
      'Column 1 of the header is longer than 5000 characters.',
    );
  });

  test('refuses a very wide row after a narrow header', () => {
    const row = Array.from({ length: MAX_IMPORT_COLUMNS + 1 }, () => 'x').join(',');
    expect(() => parseCsv(`A\nb\n${row}\n`, limits)).toThrow(
      'Row 2 has 101 cells. Import at most 100 columns.',
    );
    const widest = Array.from({ length: 5000 }, () => '').join(',');
    expect(() => parseCsv(`A\nb\n,${widest}x\n`, limits)).toThrow(/Row 2 has 5001 cells/);
  });

  test('keeps cells beyond the header so the planner can flag them', () => {
    expect(parseCsv('A,B\n1,2,3\n', limits).rows).toEqual([['1', '2', '3']]);
  });
});

describe('parseJsonRecords', () => {
  test('unions keys in first-seen order and flattens lists and scalars', () => {
    const table = parseJsonRecords(
      JSON.stringify([
        { name: 'Ada', emails: ['a@x.example', 'b@x.example'] },
        { name: 'Grace', vip: true, score: 3, email: null },
      ]),
      limits,
    );
    expect(table.headers).toEqual(['name', 'emails', 'vip', 'score', 'email']);
    expect(table.rows).toEqual([
      ['Ada', 'a@x.example; b@x.example', '', '', ''],
      ['Grace', '', 'true', '3', ''],
    ]);
  });

  test('refuses nested values, non-arrays and invalid JSON', () => {
    expect(() => parseJsonRecords('[{"name":"Ada","company":{"name":"Vela"}}]', limits)).toThrow(
      'Row 1, key company holds a nested value.',
    );
    expect(() => parseJsonRecords('{"name":"Ada"}', limits)).toThrow(
      'A JSON import is an array of objects, one per row.',
    );
    expect(() => parseJsonRecords('[{', limits)).toThrow('This file is not valid JSON.');
    expect(() => parseJsonRecords('[1]', limits)).toThrow('Row 1 is not an object.');
    expect(() => parseJsonRecords('[{"a":[["x"]]}]', limits)).toThrow('holds a nested value');
  });

  test('refuses an empty array and objects without keys', () => {
    expect(() => parseJsonRecords('[]', limits)).toThrow('This file is empty.');
    expect(() => parseJsonRecords('[{}]', limits)).toThrow('This file has no columns.');
  });

  test('enforces the row, column and cell caps', () => {
    expect(() =>
      parseJsonRecords('[{"a":1},{"a":2},{"a":3}]', { maxBytes: 1000, maxRows: 2 }),
    ).toThrow('This file has 3 rows. Import at most 2 at a time, or split the file.');
    const keys = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`k${index}`, 1]));
    expect(() => parseJsonRecords(JSON.stringify([keys]), limits)).toThrow(
      'This file has more than 100 columns. Import at most 100.',
    );
    expect(() =>
      parseJsonRecords(JSON.stringify([{ note: 'x'.repeat(MAX_IMPORT_CELL_LENGTH + 1) }]), limits),
    ).toThrow('Row 1, column note is longer than 5000 characters.');
  });

  test('refuses deeply nested input without crashing', () => {
    const depth = 500_000;
    const nested = `${'['.repeat(depth)}${']'.repeat(depth)}`;
    expect(() => parseJsonRecords(nested, limits)).toThrow();
    const objects = `[${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}]`;
    expect(() => parseJsonRecords(objects, { maxBytes: 10_000_000, maxRows: 10 })).toThrow();
  });

  test('keeps a prototype-looking key as an ordinary column', () => {
    const table = parseJsonRecords('[{"__proto__":"x","constructor":"y"}]', limits);
    expect(table.headers).toEqual(['__proto__', 'constructor']);
    expect(table.rows).toEqual([['x', 'y']]);
    const sparse = parseJsonRecords('[{"constructor":"y","toString":"z"},{"a":"1"}]', limits);
    expect(sparse.rows).toEqual([
      ['y', 'z', ''],
      ['', '', '1'],
    ]);
  });

  test('reads a JSON file with a byte order mark', () => {
    expect(parseJsonRecords('\u{FEFF}[{"a":"1"}]', limits).rows).toEqual([['1']]);
  });

  test('parseImportTable picks the parser by format', () => {
    expect(parseImportTable('json', '[{"a":"1"}]', limits).headers).toEqual(['a']);
    expect(parseImportTable('csv', 'a\n1\n', limits).rows).toEqual([['1']]);
  });
});

describe('decodeImportBytes', () => {
  test('decodes UTF-8 and drops a leading byte order mark', () => {
    const bytes = new TextEncoder().encode('\u{FEFF}Name\nAda\n');
    expect(decodeImportBytes(bytes, limits)).toBe('Name\nAda\n');
  });

  test('refuses bytes that are not UTF-8', () => {
    expect(() => decodeImportBytes(new Uint8Array([0x4e, 0xff, 0xfe, 0x41]), limits)).toThrow(
      'This file is not UTF-8 text.',
    );
  });

  test('refuses an oversize file before decoding it', () => {
    expect(() =>
      decodeImportBytes(new Uint8Array(21).fill(0x61), { maxBytes: 20, maxRows: 5 }),
    ).toThrow(/Import files up to/);
  });
});

describe('utf8Length', () => {
  test('matches the encoder for every width and for a lone surrogate', () => {
    for (const text of ['', 'abc', 'café', '€', '\u{1f600}', 'a\ud800b', '\udc00']) {
      expect(utf8Length(text)).toBe(new TextEncoder().encode(text).byteLength);
    }
  });
});

describe('source bytes', () => {
  test('the import sources and tests carry no literal BOM, NUL or other control byte', async () => {
    const roots = [join(import.meta.dir, '../../src/import'), import.meta.dir];
    const files: string[] = [];
    for (const root of roots) {
      for (const entry of await readdir(root)) {
        if (entry.endsWith('.ts')) files.push(join(root, entry));
      }
    }
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const data = await readFile(file);
      const text = data.toString('utf8');
      expect([file, text.includes('\u{FEFF}')]).toEqual([file, false]);
      const controls = [...data].filter(
        (byte) => byte < 32 && byte !== 9 && byte !== 10 && byte !== 13,
      );
      expect([file, controls]).toEqual([file, []]);
    }
  });
});
