'use client';

import {
  IMPORT_TARGET_LABELS,
  type ImportColumn,
  type ImportMapping,
  type ImportTable,
  type ImportTarget,
} from '@gravity/shared/import';
import type { FieldDefinitionRow } from '@gravity/shared/records';
import Link from 'next/link';
import { Button } from '@/components/ui/button.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import type { WorkspaceData } from '@/features/workspace/use-workspace.ts';
import { ImportReportView, rowsToWrite } from './import-report.tsx';
import { MappingTable } from './mapping-table.tsx';
import type { Done, Staged } from './use-import-run.ts';

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export interface MappingStepProps {
  readonly table: ImportTable;
  readonly target: ImportTarget;
  readonly mapping: ImportMapping;
  readonly fields: readonly FieldDefinitionRow[];
  readonly onColumn: (header: string, column: ImportColumn) => void;
  readonly onPreview: () => void;
}

export function MappingStep({
  table,
  target,
  mapping,
  fields,
  onColumn,
  onPreview,
}: MappingStepProps) {
  return (
    <div className="flex flex-col gap-3">
      <MappingTable
        table={table}
        target={target}
        mapping={mapping}
        fields={fields}
        onChange={onColumn}
      />
      <div className="flex justify-end">
        <Button variant="primary" onClick={onPreview}>
          Preview {counted(table.rows.length, 'row')}
          <Kbd keys={['mod', 'enter']} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export function PreviewStep({
  staged,
  onBack,
  onCommit,
}: {
  readonly staged: Staged;
  readonly onBack: () => void;
  readonly onCommit: () => void;
}) {
  const writable = rowsToWrite(staged.report);
  return (
    <div className="flex flex-col gap-3">
      <ImportReportView report={staged.report} />
      <div className="flex items-center justify-end gap-2">
        {writable === 0 ? (
          <p className="mr-auto text-dense text-muted">
            Nothing to import. No row would add or change anything.
          </p>
        ) : null}
        <Button variant="ghost" onClick={onBack}>
          Back to the mapping
          <Kbd keys={['esc']} aria-hidden="true" />
        </Button>
        {writable === 0 ? null : (
          <Button variant="primary" onClick={onCommit}>
            Import {counted(writable, 'row')}
            <Kbd keys={['mod', 'enter']} aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

function listFor(workspace: WorkspaceData, draft: Done['draft']): { href: string; label: string } {
  const pipeline =
    draft.pipelineId === null ? undefined : workspace.pipelineById.get(draft.pipelineId);
  if (draft.target === 'leads' && pipeline !== undefined) {
    return { href: `/leads/${pipeline.key}`, label: `Open the ${pipeline.key} leads` };
  }
  return {
    href: draft.target === 'companies' ? '/companies' : '/people',
    label: `Open ${IMPORT_TARGET_LABELS[draft.target]}`,
  };
}

export function ResultStep({
  done,
  workspace,
  onAgain,
}: {
  readonly done: Done;
  readonly workspace: WorkspaceData;
  readonly onAgain: () => void;
}) {
  const list = listFor(workspace, done.draft);
  return (
    <div className="flex flex-col gap-3">
      <ImportReportView report={done.report} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onAgain}>
          Import another file
        </Button>
        <Button asChild variant="primary">
          <Link href={list.href}>{list.label}</Link>
        </Button>
      </div>
    </div>
  );
}
