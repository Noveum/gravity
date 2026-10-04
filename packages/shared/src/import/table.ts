import { payloadTooLarge, unsupportedMediaType, validationFailed } from '../errors/index.ts';
import {
  type ImportFormat,
  type ImportLimits,
  MAX_IMPORT_CELL_LENGTH,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_HEADER_LENGTH,
} from './constants.ts';

export interface ImportTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

const DELIMITERS = [',', ';', '\t'] as const;
const BYTE_ORDER_MARK = '\u{FEFF}';
const NUL = '\u0000';
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const ONE_BYTE_LIMIT = 0x80;
const TWO_BYTE_LIMIT = 0x800;
const HIGH_SURROGATES = [0xd800, 0xdbff] as const;
const LOW_SURROGATES = [0xdc00, 0xdfff] as const;

export function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < ONE_BYTE_LIMIT) {
      bytes += 1;
    } else if (unit < TWO_BYTE_LIMIT) {
      bytes += 2;
    } else if (unit >= HIGH_SURROGATES[0] && unit <= HIGH_SURROGATES[1]) {
      const next = text.charCodeAt(index + 1);
      if (next >= LOW_SURROGATES[0] && next <= LOW_SURROGATES[1]) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function sizeLabel(bytes: number): string {
  return bytes < 1_000_000
    ? `${Math.ceil(bytes / 1000)} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function tooLarge(bytes: number, limits: ImportLimits) {
  return payloadTooLarge(
    `This file is ${sizeLabel(bytes)}. Import files up to ${sizeLabel(limits.maxBytes)}, or split it.`,
  );
}

export function assertImportFileSize(bytes: number, limits: ImportLimits): void {
  if (bytes > limits.maxBytes) throw tooLarge(bytes, limits);
}

function assertCleanText(text: string): void {
  if (text.includes(NUL)) {
    throw unsupportedMediaType(
      'This does not look like a text file. Export it as CSV or JSON and try again.',
    );
  }
  if (LONE_SURROGATE.test(text)) {
    throw unsupportedMediaType(
      'This file holds a character that is not valid text. Export it as UTF-8 CSV or JSON and try again.',
    );
  }
}

function assertImportSize(content: string, limits: ImportLimits): void {
  const bytes = utf8Length(content);
  if (bytes > limits.maxBytes) throw tooLarge(bytes, limits);
  assertCleanText(content);
}

export function decodeImportBytes(bytes: Uint8Array, limits: ImportLimits): string {
  assertImportFileSize(bytes.byteLength, limits);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw unsupportedMediaType(
      'This file is not UTF-8 text. Export it as UTF-8 CSV or JSON and try again.',
    );
  }
}

function withoutMark(content: string): string {
  return content.startsWith(BYTE_ORDER_MARK) ? content.slice(1) : content;
}

function afterQuotedValue(text: string, from: number): number {
  let index = from;
  while (index < text.length) {
    if (text[index] === '"') {
      if (text[index + 1] !== '"') return index;
      index += 1;
    }
    index += 1;
  }
  return index;
}

function isDelimiter(char: string): boolean {
  return DELIMITERS.some((delimiter) => delimiter === char);
}

function delimiterCount(text: string, delimiter: string): number {
  let count = 0;
  let leading = true;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (char === '"' && leading) {
      index = afterQuotedValue(text, index + 1);
    } else if (char === '\n' || char === '\r') {
      break;
    } else if (isDelimiter(char)) {
      if (char === delimiter) count += 1;
      leading = true;
    } else if (char !== ' ' && char !== '\t') {
      leading = false;
    }
  }
  return count;
}

function detectDelimiter(text: string): string {
  let best = ',';
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    const count = delimiterCount(text, delimiter);
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

function uniqueHeaders(raw: readonly string[]): string[] {
  const used = new Set<string>();
  return raw.map((header, index) => {
    const trimmed = header.trim();
    const base = trimmed === '' ? `Column ${index + 1}` : trimmed;
    let candidate = base;
    let count = 1;
    while (used.has(candidate)) {
      count += 1;
      const suffix = ` (${count})`;
      candidate = `${base.slice(0, MAX_IMPORT_HEADER_LENGTH - suffix.length)}${suffix}`;
    }
    used.add(candidate);
    return candidate;
  });
}

function tooManyColumns(count: number | string) {
  return validationFailed(`This file has ${count} columns. Import at most ${MAX_IMPORT_COLUMNS}.`);
}

function tooManyRows(count: number, limits: ImportLimits) {
  return payloadTooLarge(
    `This file has ${count} rows. Import at most ${limits.maxRows} at a time, or split the file.`,
  );
}

function tooLong(where: string, limit: number) {
  return validationFailed(`${where} is longer than ${limit} characters.`);
}

interface Scanned {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

class CsvScanner {
  private readonly rows: string[][] = [];
  private headers: string[] | null = null;
  private labels: string[] = [];
  private headerHadBlankTail = false;
  private rowCount = 0;
  private record: string[] = [];
  private width = 0;
  private blank = true;
  private filled = 0;
  private cell = '';
  private leading = true;
  private quoted = false;
  private quoteLine = 0;
  private line = 1;
  private readonly delimiter: string;
  private readonly limits: ImportLimits;

  constructor(delimiter: string, limits: ImportLimits) {
    this.delimiter = delimiter;
    this.limits = limits;
  }

  scan(text: string): Scanned {
    for (let index = 0; index < text.length; index += 1) {
      index = this.quoted ? this.stepQuoted(text, index) : this.step(text, index);
    }
    if (this.quoted) {
      throw validationFailed(
        `The file ends inside a quoted value that starts on line ${this.quoteLine}.`,
      );
    }
    if (this.cell.length > 0 || this.width > 0) this.finishRecord();
    if (this.headers === null) throw validationFailed('This file is empty.');
    if (this.rowCount > this.limits.maxRows) throw tooManyRows(this.rowCount, this.limits);
    if (this.rowCount === 0) throw validationFailed('This file has a header but no rows.');
    return { headers: this.paddedLabels(this.headers), rows: this.rows };
  }

  private paddedLabels(headers: readonly string[]): string[] {
    if (!this.headerHadBlankTail) return this.labels;
    const widest = this.rows.reduce((width, row) => Math.max(width, row.length), headers.length);
    if (widest === headers.length) return this.labels;
    return uniqueHeaders([
      ...headers,
      ...Array.from({ length: widest - headers.length }, () => ''),
    ]);
  }

  private step(text: string, index: number): number {
    const char = text[index] ?? '';
    if (char === '"' && this.leading) {
      this.quoted = true;
      this.quoteLine = this.line;
      return index;
    }
    if (char === this.delimiter) {
      this.finishCell();
      return index;
    }
    if (char === '\r' || char === '\n') {
      this.finishRecord();
      this.line += 1;
      return char === '\r' && text[index + 1] === '\n' ? index + 1 : index;
    }
    this.append(char);
    return index;
  }

  private stepQuoted(text: string, index: number): number {
    const char = text[index] ?? '';
    if (char === '"') {
      if (text[index + 1] === '"') {
        this.append('"');
        return index + 1;
      }
      this.quoted = false;
      return index;
    }
    if (char === '\n' || (char === '\r' && text[index + 1] !== '\n')) this.line += 1;
    this.append(char);
    return index;
  }

  private append(char: string): void {
    if (this.leading && char !== ' ' && char !== '\t') this.leading = false;
    this.cell += char;
    const limit = this.headers === null ? MAX_IMPORT_HEADER_LENGTH : MAX_IMPORT_CELL_LENGTH;
    if (this.cell.length > limit) throw tooLong(this.position(), limit);
  }

  private position(): string {
    if (this.headers === null) return `Column ${this.width + 1} of the header`;
    const column = this.labels[this.width] ?? String(this.width + 1);
    return `Row ${this.rowCount + 1}, column ${column}`;
  }

  private finishCell(): void {
    const value = this.cell.trim();
    this.width += 1;
    if (value.length > 0) {
      this.blank = false;
      this.filled = this.width;
    }
    if (this.record.length <= MAX_IMPORT_COLUMNS) this.record.push(value);
    this.cell = '';
    this.leading = true;
  }

  private finishRecord(): void {
    this.finishCell();
    const cellCount = this.filled;
    const blankTail = this.width > cellCount;
    const cells = this.record.slice(0, cellCount);
    const skipped = this.blank;
    this.record = [];
    this.width = 0;
    this.filled = 0;
    this.blank = true;
    if (skipped) return;
    if (cellCount > MAX_IMPORT_COLUMNS) throw this.tooWide(cellCount);
    if (this.headers === null) {
      this.headers = cells;
      this.labels = uniqueHeaders(cells);
      this.headerHadBlankTail = blankTail;
      return;
    }
    this.rowCount += 1;
    if (this.rows.length < this.limits.maxRows) this.rows.push(cells);
  }

  private tooWide(cellCount: number) {
    if (this.headers === null) return tooManyColumns(cellCount);
    return validationFailed(
      `Row ${this.rowCount + 1} has ${cellCount} cells. Import at most ${MAX_IMPORT_COLUMNS} columns.`,
    );
  }
}

export function parseCsv(content: string, limits: ImportLimits): ImportTable {
  assertImportSize(content, limits);
  const text = withoutMark(content);
  return new CsvScanner(detectDelimiter(text), limits).scan(text);
}

function listText(value: readonly unknown[], row: number, key: string): string {
  if (!value.every((item) => typeof item === 'string' || typeof item === 'number')) {
    throw validationFailed(
      `Row ${row}, key ${key} holds a list with values other than text or numbers. Use a list of text or numbers.`,
    );
  }
  return value.map((item) => numberText(item, row, key)).join('; ');
}

function numberText(value: unknown, row: number, key: string): string {
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw validationFailed(
      `Row ${row}, key ${key} holds a number too large to read exactly. Put it in quotes so it stays text.`,
    );
  }
  return String(value);
}

function cellOf(value: unknown, row: number, key: string): string {
  if (value === undefined || value === null) return '';
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    text = numberText(value, row, key);
  } else if (Array.isArray(value)) {
    text = listText(value, row, key);
  } else {
    throw validationFailed(
      `Row ${row}, key ${key} holds a nested value. Flatten it to text, a number, true or false, or a list of text.`,
    );
  }
  assertCleanText(text);
  if (text.length > MAX_IMPORT_CELL_LENGTH) {
    throw tooLong(`Row ${row}, column ${key}`, MAX_IMPORT_CELL_LENGTH);
  }
  return text.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(withoutMark(content));
  } catch (error) {
    if (error instanceof RangeError) throw validationFailed('This file is nested too deeply.');
    throw validationFailed('This file is not valid JSON.');
  }
}

export function parseJsonRecords(content: string, limits: ImportLimits): ImportTable {
  assertImportSize(content, limits);
  const parsed = parseJson(content);
  if (!Array.isArray(parsed)) {
    throw validationFailed('A JSON import is an array of objects, one per row.');
  }
  if (parsed.length === 0) throw validationFailed('This file is empty.');
  if (parsed.length > limits.maxRows) throw tooManyRows(parsed.length, limits);
  const keys: string[] = [];
  const seen = new Set<string>();
  const objects: Record<string, unknown>[] = [];
  parsed.forEach((entry: unknown, index) => {
    if (!isRecord(entry)) throw validationFailed(`Row ${index + 1} is not an object.`);
    for (const key of Object.keys(entry)) {
      if (seen.has(key)) continue;
      assertCleanText(key);
      if (key.length > MAX_IMPORT_HEADER_LENGTH) {
        throw validationFailed(
          `Column ${keys.length + 1} of the keys is longer than ${MAX_IMPORT_HEADER_LENGTH} characters. It starts with "${[...key].slice(0, 40).join('')}".`,
        );
      }
      seen.add(key);
      keys.push(key);
      if (keys.length > MAX_IMPORT_COLUMNS) {
        throw tooManyColumns(`more than ${MAX_IMPORT_COLUMNS}`);
      }
    }
    objects.push(entry);
  });
  if (keys.length === 0) throw validationFailed('This file has no columns.');
  const rows = objects.map((entry, index) =>
    keys.map((key) => cellOf(Object.hasOwn(entry, key) ? entry[key] : undefined, index + 1, key)),
  );
  return { headers: uniqueHeaders(keys), rows };
}

export function parseImportTable(
  format: ImportFormat,
  content: string,
  limits: ImportLimits,
): ImportTable {
  return format === 'json' ? parseJsonRecords(content, limits) : parseCsv(content, limits);
}
