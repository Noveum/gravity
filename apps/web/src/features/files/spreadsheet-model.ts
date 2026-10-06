import { z } from 'zod';

export const ROW_PAGE_SIZE = 100;
export const COLUMN_PAGE_SIZE = 30;

const sheetSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  rows: z.number().int().nonnegative(),
  columns: z.number().int().nonnegative(),
});
const cellSchema = z.object({
  text: z.string(),
  bold: z.boolean(),
  italic: z.boolean(),
  right: z.boolean(),
});
export const spreadsheetRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('load'), data: z.instanceof(ArrayBuffer) }),
  z.object({
    type: z.literal('page'),
    requestId: z.number().int().nonnegative(),
    sheetId: z.number().int().positive(),
    row: z.number().int().min(1).max(1_048_576),
    column: z.number().int().min(1).max(16_384),
  }),
]);
export const spreadsheetResponseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), sheets: z.array(sheetSchema) }),
  z.object({
    type: z.literal('page'),
    requestId: z.number().int().nonnegative(),
    cells: z.array(z.array(cellSchema).max(COLUMN_PAGE_SIZE)).max(ROW_PAGE_SIZE),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type SpreadsheetSheet = z.infer<typeof sheetSchema>;
export type SpreadsheetCell = z.infer<typeof cellSchema>;

export function columnLabel(column: number): string {
  let value = column;
  let label = '';
  while (value > 0) {
    label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

export function cellPosition(address: string): { row: number; column: number } | null {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/i.exec(address.trim());
  if (match?.[1] === undefined || match[2] === undefined) return null;
  const column = [...match[1].toUpperCase()].reduce(
    (value, letter) => value * 26 + letter.charCodeAt(0) - 64,
    0,
  );
  const row = Number(match[2]);
  return row <= 1_048_576 && column <= 16_384 ? { row, column } : null;
}
