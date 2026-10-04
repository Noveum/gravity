import { payloadTooLarge, unsupportedMediaType, validationFailed } from '../errors/index.ts';
import {
  type ImportFormat,
  type ImportLimits,
  MAX_IMPORT_CELL_LENGTH,
  MAX_IMPORT_COLUMNS,
} from './constants.ts';

export interface ImportTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

const DELIMITERS = [',', ';', '\t'] as const;
const BYTE_ORDER_MARK = '\u{FEFF}';
const NUL = '\u0000';
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

function assertImportSize(content: string, limits: ImportLimits): void {
  const bytes = utf8Length(content);
  if (bytes > limits.maxBytes) throw tooLarge(bytes, limits);
  if (content.includes(NUL)) {
    throw unsupportedMediaType(
      'This does not look like a text file. Export it as CSV or JSON and try again.',
    );
  }
}

export function decodeImportBytes(bytes: Uint8Array, limits: ImportLimits): string {
  if (bytes.byteLength > limits.maxBytes) throw tooLarge(bytes.byteLength, limits);
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

function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((delimiter) => [delimiter, 0]));
  let quoted = false;
  for (const char of text) {
    if (char === '"') {
      quoted = !quoted;
    } else if (!quoted) {
      if (char === '\n' || char === '\r') break;
      const count = counts.get(char);
      if (count !== undefined) counts.set(char, count + 1);
    }
  }
  let best = ',';
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    const count = counts.get(delimiter) ?? 0;
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
      candidate = `${base} (${count})`;
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

function tooLong(where: string) {
  return validationFailed(`${where} is longer than ${MAX_IMPORT_CELL_LENGTH} characters.`);
}

interface Scanned {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

class CsvScanner {
  private readonly rows: string[][] = [];
  private headers: string[] | null = null;
  private labels: string[] = [];
  private rowCount = 0;
  private record: string[] = [];
  private width = 0;
  private blank = true;
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
    return { headers: this.labels, rows: this.rows };
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
    if (this.cell.length > MAX_IMPORT_CELL_LENGTH) throw tooLong(this.position());
  }

  private position(): string {
    if (this.headers === null) return `Column ${this.width + 1} of the header`;
    const column = this.labels[this.width] ?? String(this.width + 1);
    return `Row ${this.rowCount + 1}, column ${column}`;
  }

  private finishCell(): void {
    const value = this.cell.trim();
    if (value.length > 0) this.blank = false;
    this.width += 1;
    if (this.record.length <= MAX_IMPORT_COLUMNS) this.record.push(value);
    this.cell = '';
    this.leading = true;
  }

  private finishRecord(): void {
    this.finishCell();
    const cells = this.record;
    const cellCount = this.width;
    const skipped = this.blank;
    this.record = [];
    this.width = 0;
    this.blank = true;
    if (skipped) return;
    if (cellCount > MAX_IMPORT_COLUMNS) throw this.tooWide(cellCount);
    if (this.headers === null) {
      this.headers = cells;
      this.labels = uniqueHeaders(cells);
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

function cellOf(value: unknown, row: number, key: string): string {
  if (value === undefined || value === null) return '';
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    text = String(value);
  } else if (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' || typeof item === 'number')
  ) {
    text = value.map(String).join('; ');
  } else {
    throw validationFailed(
      `Row ${row}, key ${key} holds a nested value. Flatten it to text, a number, true or false, or a list of text.`,
    );
  }
  if (text.length > MAX_IMPORT_CELL_LENGTH) throw tooLong(`Row ${row}, column ${key}`);
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
