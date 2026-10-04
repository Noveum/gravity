'use client';

import {
  columnAllowed,
  customColumn,
  IMPORT_STANDARD_COLUMNS,
  type ImportColumn,
  type ImportMapping,
  type ImportTable,
  type ImportTarget,
  importColumnLabel,
} from '@gravity/shared/import';
import type { FieldDefinitionRow } from '@gravity/shared/records';
import { NativeSelect } from '@/components/ui/native-select.tsx';

interface ColumnOption {
  readonly value: ImportColumn;
  readonly label: string;
  readonly group: string;
}

const GROUP_ORDER = ['Skip', 'Identity', 'Person', 'Company', 'Lead', 'Custom fields'] as const;
const SAMPLE_LENGTH = 60;
const SAMPLE_ROWS = 3;

function groupOf(column: ImportColumn): string {
  if (column === 'ignore') return 'Skip';
  if (column === 'sourceId') return 'Identity';
  if (column.startsWith('person.')) return 'Person';
  if (column.startsWith('company.')) return 'Company';
  return 'Lead';
}

export function columnOptions(
  target: ImportTarget,
  fields: readonly FieldDefinitionRow[],
): ColumnOption[] {
  const standard = IMPORT_STANDARD_COLUMNS.filter((column) => columnAllowed(target, column)).map(
    (column) => ({ value: column, label: importColumnLabel(column), group: groupOf(column) }),
  );
  const custom = fields.flatMap((field) =>
    field.object === 'deal'
      ? []
      : [
          {
            value: customColumn(field.object, field.key),
            label: field.label,
            group: 'Custom fields',
          },
        ],
  );
  return [...standard, ...custom.filter((option) => columnAllowed(target, option.value))];
}

function sampleOf(table: ImportTable, header: string): string {
  const index = table.headers.indexOf(header);
  const sample =
    table.rows
      .slice(0, SAMPLE_ROWS)
      .map((row) => row[index] ?? '')
      .find((cell) => cell.length > 0) ?? '';
  return sample.length > SAMPLE_LENGTH ? `${sample.slice(0, SAMPLE_LENGTH)}...` : sample;
}

export interface MappingTableProps {
  readonly table: ImportTable;
  readonly target: ImportTarget;
  readonly mapping: ImportMapping;
  readonly fields: readonly FieldDefinitionRow[];
  readonly onChange: (header: string, column: ImportColumn) => void;
}

export function MappingTable({ table, target, mapping, fields, onChange }: MappingTableProps) {
  const options = columnOptions(target, fields);
  return (
    <table className="w-full table-fixed text-dense">
      <caption className="sr-only">Map each column of the file to a Gravity field</caption>
      <thead>
        <tr className="h-7 text-left text-2xs text-faint uppercase tracking-wide">
          <th className="w-1/3 font-medium">Column</th>
          <th className="w-1/3 font-medium">Sample</th>
          <th className="w-1/3 font-medium">Gravity field</th>
        </tr>
      </thead>
      <tbody>
        {table.headers.map((header) => (
          <tr key={header} className="h-7 border-border border-t">
            <td className="truncate pr-3 text-text" title={header}>
              {header}
            </td>
            <td className="truncate pr-3 text-muted">{sampleOf(table, header)}</td>
            <td>
              <NativeSelect
                aria-label={`Field for ${header}`}
                className="h-7 w-full text-xs"
                value={mapping[header] ?? 'ignore'}
                onChange={(event) => {
                  const next = options.find((option) => option.value === event.target.value);
                  if (next !== undefined) onChange(header, next.value);
                }}
              >
                {GROUP_ORDER.map((group) => {
                  const members = options.filter((option) => option.group === group);
                  return members.length === 0 ? null : (
                    <optgroup key={group} label={group}>
                      {members.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </NativeSelect>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
