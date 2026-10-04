'use client';

import { IMPORT_TARGET_LABELS, IMPORT_TARGETS, type ImportTarget } from '@gravity/shared/import';
import { type ReactNode, useId } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { NativeSelect } from '@/components/ui/native-select.tsx';
import type { WorkspaceData } from '@/features/workspace/use-workspace.ts';

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-2xs text-faint">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

function targetOf(value: string): ImportTarget {
  return IMPORT_TARGETS.find((target) => target === value) ?? 'people';
}

export interface SourceBarProps {
  readonly workspace: WorkspaceData;
  readonly target: ImportTarget;
  readonly pipelineId: string | null;
  readonly source: string;
  readonly fileName: string | null;
  readonly locked: boolean;
  readonly committing: boolean;
  readonly onTarget: (target: ImportTarget) => void;
  readonly onPipeline: (pipelineId: string | null) => void;
  readonly onSource: (source: string) => void;
  readonly onChoose: () => void;
}

export function SourceBar({
  workspace,
  target,
  pipelineId,
  source,
  fileName,
  locked,
  committing,
  onTarget,
  onPipeline,
  onSource,
  onChoose,
}: SourceBarProps) {
  return (
    <section aria-label="Source" className="flex flex-wrap items-end gap-3">
      <Field label="What to import">
        {(id) => (
          <NativeSelect
            id={id}
            value={target}
            disabled={locked}
            onChange={(event) => onTarget(targetOf(event.target.value))}
          >
            {IMPORT_TARGETS.map((option) => (
              <option key={option} value={option}>
                {IMPORT_TARGET_LABELS[option]}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      {target === 'leads' ? (
        <Field label="Pipeline">
          {(id) => (
            <NativeSelect
              id={id}
              value={pipelineId ?? ''}
              disabled={locked}
              onChange={(event) =>
                onPipeline(event.target.value === '' ? null : event.target.value)
              }
            >
              {workspace.pipelines.map((option) => (
                <option key={option.id} value={option.id}>
                  {`${workspace.brandById.get(option.brandId)?.name ?? ''} · ${option.name} (${option.key})`}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      ) : null}
      <Field label="Source name">
        {(id) => (
          <Input
            id={id}
            value={source}
            disabled={locked}
            onChange={(event) => onSource(event.target.value)}
            className="w-40"
          />
        )}
      </Field>
      <Button onClick={onChoose} aria-disabled={committing}>
        {fileName === null ? 'Choose a file' : `Replace ${fileName}`}
        <Kbd keys={['o']} aria-hidden="true" />
      </Button>
    </section>
  );
}
