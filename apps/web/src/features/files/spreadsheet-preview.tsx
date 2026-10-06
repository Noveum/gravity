'use client';

import type { FileEntry } from '@gravity/shared/validators';
import type { Workbook, Worksheet } from 'exceljs';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { messageOf } from '@/lib/api/client.ts';
import { localOfficeArchive } from './office-archive.ts';
import { usePreviewBytes } from './use-preview-bytes.ts';

function SheetTable({ sheet }: { readonly sheet: Worksheet }) {
  const [page, setPage] = useState(0);
  const [columnPage, setColumnPage] = useState(0);
  const rows = Math.max(1, sheet.rowCount);
  const columns = Math.max(1, sheet.columnCount);
  const first = page * 100 + 1;
  const firstColumn = columnPage * 30 + 1;
  const rowNumbers = Array.from({ length: Math.min(100, rows - first + 1) }, (_, i) => first + i);
  const columnNumbers = Array.from(
    { length: Math.min(30, columns - firstColumn + 1) },
    (_, i) => firstColumn + i,
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-muted text-xs">
        <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous rows
        </Button>
        <span>
          Rows {first}–{Math.min(first + 99, rows)} of {rows}
        </span>
        <Button size="sm" disabled={first + 100 > rows} onClick={() => setPage(page + 1)}>
          Next rows
        </Button>
        <Button size="sm" disabled={columnPage === 0} onClick={() => setColumnPage(columnPage - 1)}>
          Previous columns
        </Button>
        <Button
          size="sm"
          disabled={firstColumn + 30 > columns}
          onClick={() => setColumnPage(columnPage + 1)}
        >
          Next columns
        </Button>
      </div>
      <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
        <table
          aria-label={`Worksheet ${sheet.name}`}
          className="min-w-full border-collapse text-sm"
        >
          <thead className="sticky top-0 bg-surface-2">
            <tr>
              <th className="border-border border-r px-3 py-2">Row</th>
              {columnNumbers.map((column) => (
                <th key={column} className="min-w-32 border-border border-r px-3 py-2">
                  {sheet.getCell(1, column).address.replace(/\d+$/, '')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowNumbers.map((row) => (
              <tr key={row} className="border-border border-t">
                <th className="bg-surface-2 px-3 py-2 text-muted">{row}</th>
                {columnNumbers.map((column) => {
                  const cell = sheet.getCell(row, column);
                  return (
                    <td
                      key={column}
                      className="max-w-80 whitespace-pre-wrap border-border border-l px-3 py-2"
                      style={{
                        fontWeight: cell.font?.bold ? 600 : 400,
                        fontStyle: cell.font?.italic ? 'italic' : 'normal',
                        textAlign: cell.alignment?.horizontal === 'right' ? 'right' : 'left',
                      }}
                    >
                      {cell.text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WorkbookPreview({ data }: { readonly data: ArrayBuffer }) {
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [excel, bytes] = await Promise.all([import('exceljs'), localOfficeArchive(data)]);
      const book = new excel.Workbook();
      await book.xlsx.load(bytes);
      if (!cancelled) setWorkbook(book);
    }
    load().catch((failure: unknown) => {
      if (!cancelled) setError(messageOf(failure));
    });
    return () => {
      cancelled = true;
    };
  }, [data]);
  if (error !== null)
    return (
      <p role="alert" className="text-danger">
        {error}
      </p>
    );
  if (workbook === null)
    return (
      <p role="status" className="text-muted">
        Rendering spreadsheet…
      </p>
    );
  const sheet = workbook.worksheets[index];
  return (
    <section aria-label="Spreadsheet preview" className="flex flex-col gap-3">
      <div role="tablist" aria-label="Worksheets" className="flex flex-wrap gap-2">
        {workbook.worksheets.map((item, i) => (
          <Button
            key={item.id}
            role="tab"
            aria-selected={i === index}
            onClick={() => setIndex(i)}
            variant={i === index ? 'primary' : 'ghost'}
          >
            {item.name}
          </Button>
        ))}
      </div>
      {sheet === undefined ? (
        <p>This workbook has no worksheets.</p>
      ) : (
        <SheetTable key={sheet.id} sheet={sheet} />
      )}
    </section>
  );
}

export function SpreadsheetPreview({
  entry,
  downloadPath,
}: {
  readonly entry: FileEntry;
  readonly downloadPath: string;
}) {
  const query = usePreviewBytes(entry, downloadPath);
  if (query.error !== null)
    return (
      <p role="alert" className="text-danger">
        {messageOf(query.error)}
      </p>
    );
  if (query.isPending)
    return (
      <p role="status" className="text-muted">
        Opening spreadsheet…
      </p>
    );
  return <WorkbookPreview data={query.data} />;
}
