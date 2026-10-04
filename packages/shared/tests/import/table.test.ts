import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DomainError } from '../../src/errors/index.ts';
import {
  HTTP_IMPORT_LIMITS,
  MAX_IMPORT_CELL_LENGTH,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_HEADER_LENGTH,
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
    expect(() => parseCsv(`${'x'.repeat(MAX_IMPORT_HEADER_LENGTH + 1)}\n1\n`, limits)).toThrow(
      'Column 1 of the header is longer than 500 characters.',
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

  test('keeps cells beyond a header that ends in a named column, unnamed, so the planner flags them', () => {
    const table = parseCsv('A,B\n1,2,3\n4,5\n', limits);
    expect(table.headers).toEqual(['A', 'B']);
    expect(table.rows).toEqual([
      ['1', '2', '3'],
      ['4', '5'],
    ]);
  });

  test('a header with trailing blank cells is padded to the widest row', () => {
    const table = parseCsv('Name,Email,,\nAda,ada@vela.example,VIP,warm\nGrace,,,\n', limits);
    expect(table.headers).toEqual(['Name', 'Email', 'Column 3', 'Column 4']);
    expect(table.rows[0]).toEqual(['Ada', 'ada@vela.example', 'VIP', 'warm']);
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
    expect(() => parseJsonRecords('[{"a":[["x"]]}]', limits)).toThrow(
      'Row 1, key a holds a list with values other than text or numbers.',
    );
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

function refusal(run: () => unknown): { code: string; message: string } {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return { code: error.code, message: error.message };
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('escaped NUL and lone surrogates', () => {
  test('a JSON value, key or list item with an escaped NUL is refused like a raw NUL', () => {
    const raw = refusal(() => parseCsv('Name\nA\u0000da\n', limits));
    for (const content of [
      '[{"name":"A\\u0000da"}]',
      '[{"A\\u0000":"x"}]',
      '[{"tags":["ok","A\\u0000"]}]',
    ]) {
      expect(refusal(() => parseJsonRecords(content, limits))).toEqual(raw);
    }
  });

  test('a lone surrogate is refused in a JSON value, key and list item, and in raw text', () => {
    for (const content of [
      '[{"name":"A\\ud800"}]',
      '[{"name":"\\udc00B"}]',
      '[{"\\ud800":"x"}]',
      '[{"tags":["\\ud83d"]}]',
    ]) {
      const refused = refusal(() => parseJsonRecords(content, limits));
      expect(refused.code).toBe('unsupported_media_type');
    }
    expect(refusal(() => parseCsv('Name\nA\ud800b\n', limits)).code).toBe('unsupported_media_type');
    expect(refusal(() => parseJsonRecords('[{"name":"A\ud800"}]', limits)).code).toBe(
      'unsupported_media_type',
    );
  });

  test('a surrogate pair written as escapes is ordinary text', () => {
    expect(parseJsonRecords('[{"name":"\\ud83d\\ude00 Ada"}]', limits).rows).toEqual([
      ['\u{1f600} Ada'],
    ]);
    expect(parseCsv('Name\n\u{1f600} Ada\n', limits).rows).toEqual([['\u{1f600} Ada']]);
  });
});

describe('header length', () => {
  test('a 300 character header is accepted by both parsers', () => {
    const header = 'h'.repeat(300);
    expect(parseCsv(`${header}\n1\n`, limits).headers).toEqual([header]);
    expect(parseJsonRecords(JSON.stringify([{ [header]: 1 }]), limits).headers).toEqual([header]);
  });

  test('an over-long CSV header or JSON key refuses the file and names the column', () => {
    const header = 'k'.repeat(MAX_IMPORT_HEADER_LENGTH + 1);
    expect(() => parseCsv(`A,${header}\n1,2\n`, limits)).toThrow(
      'Column 2 of the header is longer than 500 characters.',
    );
    const refused = refusal(() =>
      parseJsonRecords(JSON.stringify([{ a: 1, [header]: 2 }]), limits),
    );
    expect(refused.message).toStartWith('Column 2 of the keys is longer than 500 characters.');
    expect(refused.message.length).toBeLessThan(200);
    expect(refused.message).not.toContain(header);
  });

  test('the over-long key message is cut by code point, never inside a character', () => {
    const key = `a${'\u{1F600}'.repeat(300)}`;
    const refused = refusal(() => parseJsonRecords(JSON.stringify([{ [key]: 1 }]), limits));
    expect(refused.message).toContain(`starts with "a${'\u{1F600}'.repeat(39)}"`);
    expect(refused.message).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  });

  test('separating duplicate headers never pushes one past the cap', () => {
    const header = 'd'.repeat(MAX_IMPORT_HEADER_LENGTH);
    const table = parseCsv(`${header},${header},${header}\n1,2,3\n`, limits);
    expect(table.headers.every((name) => name.length <= MAX_IMPORT_HEADER_LENGTH)).toBe(true);
    expect(new Set(table.headers).size).toBe(3);
  });
});

describe('JSON integers', () => {
  test('refuses a number that cannot be read exactly and asks for a quoted value', () => {
    for (const id of ['12345678901234567891', '12345678901234567892', '9007199254740993', '1e21']) {
      const refused = refusal(() => parseJsonRecords(`[{"id":${id}}]`, limits));
      expect(refused.code).toBe('validation_failed');
      expect(refused.message).toBe(
        'Row 1, key id holds a number too large to read exactly. Put it in quotes so it stays text.',
      );
    }
  });

  test('keeps quoted ids, safe integers and decimals', () => {
    const table = parseJsonRecords(
      '[{"a":"12345678901234567891","b":9007199254740991,"c":1.5,"d":-3}]',
      limits,
    );
    expect(table.rows).toEqual([['12345678901234567891', '9007199254740991', '1.5', '-3']]);
  });

  test('a list of booleans or nulls gets an accurate message', () => {
    for (const list of ['[true]', '[null]', '["a",false]']) {
      expect(refusal(() => parseJsonRecords(`[{"tags":${list}}]`, limits)).message).toBe(
        'Row 1, key tags holds a list with values other than text or numbers. Use a list of text or numbers.',
      );
    }
  });
});

describe('delimiter detection', () => {
  test('a stray quote inside an unquoted header does not hide the delimiter', () => {
    const table = parseCsv('Size 6";Name;Email\n6;Ada;ada@vela.example\n', limits);
    expect(table.headers).toEqual(['Size 6"', 'Name', 'Email']);
    expect(table.rows).toEqual([['6', 'Ada', 'ada@vela.example']]);
  });

  test('a quoted header holding the other delimiters does not change the choice', () => {
    expect(parseCsv('"a;b;c;d",e\n1,2\n', limits).headers).toEqual(['a;b;c;d', 'e']);
    expect(parseCsv('a,"b;c;d;e",f\n1,2,3\n', limits).headers).toEqual(['a', 'b;c;d;e', 'f']);
  });
});

describe('trailing empty cells', () => {
  test('a two column file with 99 trailing commas is a two column file', () => {
    const tail = ','.repeat(99);
    const table = parseCsv(`A,B${tail}\n1,2${tail}\n`, limits);
    expect(table.headers).toEqual(['A', 'B']);
    expect(table.rows).toEqual([['1', '2']]);
  });

  test('empty cells between filled ones still count, and a long run of trailing commas is not a wide row', () => {
    expect(parseCsv('A,,C\n1,,3,,,\n', limits).rows).toEqual([['1', '', '3']]);
    const run = ','.repeat(5000);
    expect(parseCsv(`A\nb${run}\n`, limits).rows).toEqual([['b']]);
    expect(() => parseCsv(`A\nb${run}x\n`, limits)).toThrow(/Row 1 has 5001 cells/);
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
