import { describe, expect, it } from 'bun:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { cellPosition, columnLabel } from '@/features/files/spreadsheet-model.ts';
import { readSpreadsheet, spreadsheetPage } from '@/features/files/spreadsheet-reader.ts';

describe('spreadsheet preview bounds', () => {
  it('reads cached formulas as text and returns a bounded range without creating cells', async () => {
    const source = new ExcelJS.Workbook();
    const sheet = source.addWorksheet('Wide data');
    sheet.getCell('A1').value = 'Header';
    sheet.getCell('AZ150').value = { formula: '1+2', result: 3 };
    sheet.getCell('AZ150').font = { bold: true };
    const bytes = await source.xlsx.writeBuffer();
    const workbook = await readSpreadsheet(new Uint8Array(bytes).buffer);
    const result = spreadsheetPage(workbook, 1, 100, 30);
    expect(result).toHaveLength(51);
    expect(result[0]).toHaveLength(23);
    expect(result[50]?.[22]).toEqual({ text: '3', bold: true, italic: false, right: false });
    expect(workbook.getWorksheet(1)?.actualRowCount).toBe(2);
  });

  it('rejects sparse extreme coordinates before allocating a workbook', async () => {
    const zip = new JSZip();
    zip.file(
      'xl/worksheets/sheet1.xml',
      '<worksheet><sheetData><row r="1048576"><c r="XFD1048576"><v>1</v></c></row></sheetData></worksheet>',
    );
    await expect(readSpreadsheet(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow(
      'preview limits',
    );
  });

  it('rejects too many populated cells and invalid row addresses', async () => {
    const zip = new JSZip();
    zip.file(
      'xl/worksheets/sheet1.xml',
      `<worksheet><sheetData><row r="1">${'<c r="A1"><v>1</v></c>'.repeat(200_001)}</row></sheetData></worksheet>`,
    );
    await expect(readSpreadsheet(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow(
      'preview limits',
    );
    zip.file(
      'xl/worksheets/sheet1.xml',
      '<worksheet><sheetData><row r="999999999"/></sheetData></worksheet>',
    );
    await expect(readSpreadsheet(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow(
      'invalid row',
    );
  });

  it('rejects XML declarations and damaged XML', async () => {
    const zip = new JSZip();
    zip.file(
      'xl/worksheets/sheet1.xml',
      '<!DOCTYPE worksheet [<!ENTITY remote SYSTEM "https://example.com">]><worksheet/>',
    );
    await expect(readSpreadsheet(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow(
      'unsupported XML',
    );
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><bad></worksheet>');
    await expect(
      readSpreadsheet(await zip.generateAsync({ type: 'arraybuffer' })),
    ).rejects.toThrow();
  });

  it('rejects column styles outside Excel bounds before allocating columns', async () => {
    const zip = new JSZip();
    zip.file(
      'xl/worksheets/sheet1.xml',
      '<worksheet><cols><col min="1" max="999999999"/></cols><sheetData/></worksheet>',
    );
    await expect(readSpreadsheet(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow(
      'invalid column range',
    );
  });

  it('ignores merge ranges that would otherwise allocate millions of empty cells', async () => {
    const source = new ExcelJS.Workbook();
    source.addWorksheet('Merged').getCell('A1').value = 'Saved';
    const zip = await JSZip.loadAsync(await source.xlsx.writeBuffer());
    const xml = await zip.file('xl/worksheets/sheet1.xml')?.async('string');
    if (xml === undefined) throw new Error('Missing sheet');
    zip.file(
      'xl/worksheets/sheet1.xml',
      xml.replace(
        '</worksheet>',
        '<mergeCells count="1"><mergeCell ref="A1:XFD1048576"/></mergeCells></worksheet>',
      ),
    );
    const result = await readSpreadsheet(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(result.getWorksheet(1)?.getCell('A1').text).toBe('Saved');
    expect(result.getWorksheet(1)?.rowCount).toBe(1);
  });

  it('accepts Excel cell addresses and preserves column labels through XFD', () => {
    expect(cellPosition(' az50000 ')).toEqual({ row: 50_000, column: 52 });
    expect(cellPosition('XFD1048576')).toEqual({ row: 1_048_576, column: 16_384 });
    expect(cellPosition('XFE1')).toBeNull();
    expect(cellPosition('A0')).toBeNull();
    expect(columnLabel(52)).toBe('AZ');
    expect(columnLabel(16_384)).toBe('XFD');
  });
});
