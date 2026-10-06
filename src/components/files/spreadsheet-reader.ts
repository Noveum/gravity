import t from "@crm/i18n/translations/en.json";
import ExcelJS, { type Workbook } from "exceljs";
import { SaxesParser, type SaxesTagNS } from "saxes";
import { validatedOfficeZip } from "./office-archive";
import {
  COLUMN_PAGE_SIZE,
  cellPosition,
  ROW_PAGE_SIZE,
} from "./spreadsheet-model";

const PREVIEW_LIMIT_MESSAGE = t.files.thisWorkbookExceedsThePreviewLimitsFor;

interface SpreadsheetBudget {
  cells: number;
  rows: number;
  positions: number;
  strings: number;
  characters: number;
  elements: number;
  styles: number;
}
interface SheetBounds {
  row: number;
  column: number;
}

function trackText(value: string, budget: SpreadsheetBudget): void {
  budget.characters += value.length;
  if (budget.characters > 10_000_000)
    throw new Error(t.files.thisWorkbookContainsTooMuchTextTo);
}

function attributeOf(tag: SaxesTagNS, name: string): string | undefined {
  return Object.values(tag.attributes).find(
    (attribute) => attribute.local === name,
  )?.value;
}

function trackRow(
  tag: SaxesTagNS,
  budget: SpreadsheetBudget,
  bounds: SheetBounds,
) {
  const position = cellPosition(`A${attributeOf(tag, "r") ?? ""}`);
  if (position === null)
    throw new Error(t.files.thisWorkbookContainsAnInvalidRowNumber);
  bounds.row = Math.max(bounds.row, position.row);
  if (
    ++budget.rows > 200_000 ||
    budget.positions + bounds.row * Math.max(1, bounds.column) > 2_000_000
  )
    throw new Error(PREVIEW_LIMIT_MESSAGE);
}

function trackCell(
  tag: SaxesTagNS,
  budget: SpreadsheetBudget,
  bounds: SheetBounds,
) {
  const position = cellPosition(attributeOf(tag, "r") ?? "");
  if (position === null)
    throw new Error(t.files.thisWorkbookContainsAnInvalidCellAddress);
  bounds.row = Math.max(bounds.row, position.row);
  bounds.column = Math.max(bounds.column, position.column);
  if (
    ++budget.cells > 200_000 ||
    budget.positions + bounds.row * bounds.column > 2_000_000
  )
    throw new Error(PREVIEW_LIMIT_MESSAGE);
}

function trackColumn(tag: SaxesTagNS) {
  const minimum = Number(attributeOf(tag, "min"));
  const maximum = Number(attributeOf(tag, "max"));
  if (
    !(Number.isInteger(minimum) && Number.isInteger(maximum)) ||
    minimum < 1 ||
    maximum < minimum ||
    maximum > 16_384
  )
    throw new Error(t.files.thisWorkbookContainsAnInvalidColumnRange);
}

function inspectSheetTag(
  tag: SaxesTagNS,
  budget: SpreadsheetBudget,
  bounds: SheetBounds,
) {
  if (tag.local === "row") trackRow(tag, budget, bounds);
  if (tag.local === "c") trackCell(tag, budget, bounds);
  if (tag.local === "col") trackColumn(tag);
}

export async function readSpreadsheet(data: ArrayBuffer): Promise<Workbook> {
  const zip = await validatedOfficeZip(data, 64 * 1024 * 1024);
  const budget: SpreadsheetBudget = {
    cells: 0,
    positions: 0,
    strings: 0,
    characters: 0,
    rows: 0,
    elements: 0,
    styles: 0,
  };
  let sheets = 0;
  for (const entry of Object.values(zip.files)) {
    const isSheet = /xl\/worksheets\/sheet\d+[.]xml/.test(entry.name);
    const isStrings = entry.name === "xl/sharedStrings.xml";
    const isStyles = entry.name === "xl/styles.xml";
    if (entry.dir || !/[.](?:xml|rels|vml)$/i.test(entry.name)) continue;
    if (isSheet && ++sheets > 100) throw new Error(PREVIEW_LIMIT_MESSAGE);
    const bounds: SheetBounds = { row: 0, column: 0 };
    const parser = new SaxesParser({ xmlns: true });
    let depth = 0;
    parser.on("doctype", () => {
      throw new Error(t.files.thisWorkbookContainsUnsupportedXMLDeclarations);
    });
    parser.on("opentag", (tag) => {
      if (
        ++budget.elements > 1_000_000 ||
        ++depth > 64 ||
        (isStyles && ++budget.styles > 100_000)
      )
        throw new Error(PREVIEW_LIMIT_MESSAGE);
      for (const attribute of Object.values(tag.attributes))
        trackText(attribute.value, budget);
      if (isSheet) inspectSheetTag(tag, budget, bounds);
      else if (isStrings && tag.local === "si" && ++budget.strings > 200_000)
        throw new Error(PREVIEW_LIMIT_MESSAGE);
    });
    parser.on("closetag", () => {
      depth -= 1;
    });
    parser.on("text", (value) => trackText(value, budget));
    parser.on("cdata", (value) => trackText(value, budget));
    const xml = await entry.async("string");
    for (let offset = 0; offset < xml.length; offset += 65_536)
      parser.write(xml.slice(offset, offset + 65_536));
    parser.close();
    budget.positions += bounds.row * Math.max(1, bounds.column);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data, { ignoreNodes: ["mergeCells"] });
  return workbook;
}

export function spreadsheetPage(
  workbook: Workbook,
  sheetId: number,
  row: number,
  column: number,
) {
  const sheet = workbook.getWorksheet(sheetId);
  if (sheet === undefined) throw new Error(t.files.thisWorksheetIsUnavailable);
  const rowCount = Math.max(1, sheet.rowCount);
  const columnCount = Math.max(1, sheet.columnCount);
  return Array.from(
    { length: Math.min(ROW_PAGE_SIZE, rowCount - row + 1) },
    (_, rowOffset) =>
      Array.from(
        { length: Math.min(COLUMN_PAGE_SIZE, columnCount - column + 1) },
        (_, columnOffset) => {
          const cell = sheet
            .findRow(row + rowOffset)
            ?.findCell(column + columnOffset);
          return {
            text: cell?.text ?? "",
            bold: cell?.font?.bold ?? false,
            italic: cell?.font?.italic ?? false,
            right: cell?.alignment?.horizontal === "right",
          };
        },
      ),
  );
}
