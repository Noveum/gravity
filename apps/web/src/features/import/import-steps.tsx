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
import type { Ref } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import type { WorkspaceData } from '@/features/workspace/use-workspace.ts';
import { ImportReportView, rowsToWrite } from './import-report.tsx';
import { MappingTable } from './mapping-table.tsx';
import type { Done, Staged } from './use-import-run.ts';

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function StepHeading({
  headingRef,
  children,
}: {
  readonly headingRef: Ref<HTMLHeadingElement>;
  readonly children: string;
}) {
  return (
    <h2 ref={headingRef} tabIndex={-1} className="font-medium text-sm text-text outline-none">
      {children}
    </h2>
  );
}

export interface MappingStepProps {
  readonly headingRef: Ref<HTMLHeadingElement>;
  readonly table: ImportTable;
  readonly target: ImportTarget;
  readonly mapping: ImportMapping;
  readonly fields: readonly FieldDefinitionRow[];
  readonly onColumn: (header: string, column: ImportColumn) => void;
  readonly onPreview: () => void;
}

export function MappingStep({
  headingRef,
  table,
  target,
  mapping,
  fields,
  onColumn,
  onPreview,
}: MappingStepProps) {
  return (
    <div className="flex flex-col gap-3">
      <StepHeading headingRef={headingRef}>Map the columns</StepHeading>
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
  headingRef,
  staged,
  commitFailed,
  onBack,
  onCommit,
}: {
  readonly headingRef: Ref<HTMLHeadingElement>;
  readonly staged: Staged;
  readonly commitFailed: boolean;
  readonly onBack: () => void;
  readonly onCommit: () => void;
}) {
  const writable = rowsToWrite(staged.report);
  return (
    <div aria-live="polite" className="flex flex-col gap-3">
      <StepHeading headingRef={headingRef}>Check the preview</StepHeading>
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
            {commitFailed ? 'Run the same file again' : `Import ${counted(writable, 'row')}`}
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
  headingRef,
  done,
  workspace,
  onRerun,
  onAnother,
}: {
  readonly headingRef: Ref<HTMLHeadingElement>;
  readonly done: Done;
  readonly workspace: WorkspaceData;
  readonly onRerun: () => void;
  readonly onAnother: () => void;
}) {
  const list = listFor(workspace, done.draft);
  return (
    <div aria-live="polite" className="flex flex-col gap-3">
      <StepHeading headingRef={headingRef}>Import result</StepHeading>
      <ImportReportView report={done.report} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onAnother}>
          Import another file
          <Kbd keys={['n']} aria-hidden="true" />
        </Button>
        {done.report.status === 'partial' ? (
          <Button variant="primary" onClick={onRerun}>
            Run the same file again
            <Kbd keys={['mod', 'enter']} aria-hidden="true" />
          </Button>
        ) : null}
        <Button asChild variant={done.report.status === 'partial' ? 'secondary' : 'primary'}>
          <Link href={list.href}>{list.label}</Link>
        </Button>
      </div>
    </div>
  );
}
