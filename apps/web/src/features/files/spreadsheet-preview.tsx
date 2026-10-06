'use client';

import type { FileEntry } from '@gravity/shared/validators';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { messageOf } from '@/lib/api/client.ts';
import {
  COLUMN_PAGE_SIZE,
  cellPosition,
  columnLabel,
  ROW_PAGE_SIZE,
  type SpreadsheetCell,
  type SpreadsheetSheet,
  spreadsheetResponseSchema,
} from './spreadsheet-model.ts';
import { usePreviewBytes } from './use-preview-bytes.ts';

function WorkbookPreview({ data }: { readonly data: ArrayBuffer }) {
  const [sheets, setSheets] = useState<SpreadsheetSheet[] | null>(null);
  const [index, setIndex] = useState(0);
  const [row, setRow] = useState(1);
  const [column, setColumn] = useState(1);
  const [address, setAddress] = useState('A1');
  const [cells, setCells] = useState<SpreadsheetCell[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jumpError, setJumpError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const sequence = useRef(0);
  const sheet = sheets?.[index];
  useEffect(() => {
    const instance = new Worker(new URL('./spreadsheet-worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.current = instance;
    const timeout = setTimeout(() => {
      instance.terminate();
      setError(
        'This workbook took too long to preview. The original file is available to download.',
      );
    }, 30_000);
    instance.onmessage = (event: MessageEvent<unknown>) => {
      const result = spreadsheetResponseSchema.safeParse(event.data);
      if (!result.success) {
        clearTimeout(timeout);
        instance.terminate();
        setError('This spreadsheet could not be previewed.');
        return;
      }
      const response = result.data;
      if (response.type === 'ready') {
        clearTimeout(timeout);
        setSheets(response.sheets);
      } else if (response.type === 'page' && response.requestId === sequence.current)
        setCells(response.cells);
      else if (response.type === 'error') {
        clearTimeout(timeout);
        instance.terminate();
        setError(response.message);
      }
    };
    instance.onerror = () => {
      clearTimeout(timeout);
      instance.terminate();
      setError(
        'This spreadsheet could not be previewed. The original file is available to download.',
      );
    };
    const copy = data.slice(0);
    instance.postMessage({ type: 'load', data: copy }, [copy]);
    return () => {
      clearTimeout(timeout);
      instance.terminate();
      worker.current = null;
    };
  }, [data]);
  useEffect(() => {
    if (sheet === undefined) return;
    setCells(null);
    worker.current?.postMessage({
      type: 'page',
      requestId: ++sequence.current,
      sheetId: sheet.id,
      row,
      column,
    });
  }, [sheet, row, column]);
  if (error !== null)
    return (
      <p role="alert" className="text-danger">
        {error}
      </p>
    );
  if (sheets === null)
    return (
      <p role="status" className="text-muted">
        Opening spreadsheet…
      </p>
    );
  if (sheet === undefined) return <p>This workbook has no worksheets.</p>;
  const rows = Math.max(1, sheet.rows);
  const columns = Math.max(1, sheet.columns);
  const lastRow = Math.min(row + ROW_PAGE_SIZE - 1, rows);
  const lastColumn = Math.min(column + COLUMN_PAGE_SIZE - 1, columns);
  const paged = rows > ROW_PAGE_SIZE || columns > COLUMN_PAGE_SIZE;
  const visibleColumns = Array.from({ length: cells?.[0]?.length ?? 0 }, (_, i) => column + i);
  const visibleRows =
    cells?.map((values, i) => ({
      number: row + i,
      values: values.map((cell, j) => ({
        ...cell,
        address: `${columnLabel(column + j)}${row + i}`,
      })),
    })) ?? [];
  return (
    <section aria-label="Spreadsheet preview" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-muted text-xs">
        <label className="flex items-center gap-2">
          Worksheet
          <select
            aria-label="Worksheet"
            value={index}
            onChange={(event) => {
              setIndex(Number(event.target.value));
              setRow(1);
              setColumn(1);
              setAddress('A1');
              setJumpError(null);
            }}
            className="max-w-64 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text"
          >
            {sheets.map((item, i) => (
              <option key={item.id} value={i}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <p aria-live="polite">
          {rows.toLocaleString()} rows · {columns.toLocaleString()} columns
        </p>
      </div>
      {paged ? (
        <div className="flex flex-wrap items-center gap-2 text-muted text-xs">
          {rows > ROW_PAGE_SIZE ? (
            <>
              <Button
                size="sm"
                disabled={row === 1}
                onClick={() => setRow(Math.max(1, row - ROW_PAGE_SIZE))}
              >
                Previous rows
              </Button>
              <span>
                Rows {row.toLocaleString()}–{lastRow.toLocaleString()}
              </span>
              <Button
                size="sm"
                disabled={lastRow === rows}
                onClick={() => setRow(row + ROW_PAGE_SIZE)}
              >
                Next rows
              </Button>
            </>
          ) : null}
          {columns > COLUMN_PAGE_SIZE ? (
            <>
              <Button
                size="sm"
                disabled={column === 1}
                onClick={() => setColumn(Math.max(1, column - COLUMN_PAGE_SIZE))}
              >
                Previous columns
              </Button>
              <span>
                Columns {columnLabel(column)}–{columnLabel(lastColumn)}
              </span>
              <Button
                size="sm"
                disabled={lastColumn === columns}
                onClick={() => setColumn(column + COLUMN_PAGE_SIZE)}
              >
                Next columns
              </Button>
            </>
          ) : null}
          <form
            className="ml-auto flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const position = cellPosition(address);
              if (position === null || position.row > rows || position.column > columns) {
                setJumpError('Choose a cell within this worksheet, such as A1.');
                return;
              }
              setRow(position.row);
              setColumn(position.column);
              setJumpError(null);
            }}
          >
            <Input
              aria-label="Go to cell"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className="h-8 w-24"
            />
            <Button size="sm" type="submit">
              Go
            </Button>
          </form>
        </div>
      ) : null}
      {jumpError === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {jumpError}
        </p>
      )}
      <div
        aria-busy={cells === null}
        className="max-h-[60vh] overflow-auto rounded-md border border-border"
      >
        {cells === null ? (
          <p role="status" className="p-4 text-muted">
            Loading cells…
          </p>
        ) : (
          <table
            aria-label={`Worksheet ${sheet.name}`}
            className="w-full table-fixed border-collapse text-sm"
            style={{ minWidth: 56 + visibleColumns.length * 160 }}
          >
            <colgroup>
              <col className="w-14" />
              {visibleColumns.map((number) => (
                <col key={number} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-surface-2">
              <tr>
                <th
                  scope="col"
                  aria-label="Row number"
                  className="sticky left-0 border-border border-r bg-surface-2 px-2 py-2 text-muted"
                >
                  #
                </th>
                {visibleColumns.map((number) => (
                  <th
                    scope="col"
                    key={number}
                    className="border-border border-r px-3 py-2 font-medium"
                  >
                    {columnLabel(number)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(({ number, values }) => (
                <tr key={number} className="border-border border-t">
                  <th
                    scope="row"
                    className="sticky left-0 bg-surface-2 px-2 py-2 font-normal text-muted"
                  >
                    {number}
                  </th>
                  {values.map((cell) => (
                    <td
                      key={cell.address}
                      className="max-w-40 overflow-hidden whitespace-pre-wrap break-words border-border border-l px-3 py-2"
                      style={{
                        fontWeight: cell.bold ? 600 : 400,
                        fontStyle: cell.italic ? 'italic' : 'normal',
                        textAlign: cell.right ? 'right' : 'left',
                      }}
                    >
                      {cell.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {paged ? (
        <p className="text-faint text-xs">
          Preview shows up to 100 rows and 30 columns at a time. Use Go to cell to jump anywhere in
          this sheet.
        </p>
      ) : null}
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
  return <WorkbookPreview key={`${entry.id}:${entry.syncId}`} data={query.data} />;
}
