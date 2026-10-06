import type { Workbook } from 'exceljs';
import { spreadsheetRequestSchema } from './spreadsheet-model.ts';
import { readSpreadsheet, spreadsheetPage } from './spreadsheet-reader.ts';

let workbook: Workbook | null = null;
self.onmessage = async (event: MessageEvent<unknown>) => {
  try {
    const request = spreadsheetRequestSchema.parse(event.data);
    if (request.type === 'load') {
      workbook = await readSpreadsheet(request.data);
      self.postMessage({
        type: 'ready',
        sheets: workbook.worksheets.map((sheet) => ({
          id: sheet.id,
          name: sheet.name,
          rows: sheet.rowCount,
          columns: sheet.columnCount,
        })),
      });
    } else {
      if (workbook === null) throw new Error('The workbook has not finished loading.');
      self.postMessage({
        type: 'page',
        requestId: request.requestId,
        cells: spreadsheetPage(workbook, request.sheetId, request.row, request.column),
      });
    }
  } catch (failure: unknown) {
    self.postMessage({
      type: 'error',
      message:
        failure instanceof Error ? failure.message : 'This spreadsheet could not be previewed.',
    });
  }
};
