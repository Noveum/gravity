'use client';

import {
  STAGE_CATEGORIES,
  STAGE_CATEGORY_LABELS,
  type StageCategory,
} from '@gravity/shared/constants';
import type { StageRow } from '@gravity/shared/records';
import { Archive, ArrowDown, ArrowUp } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Input } from '@/components/ui/input.tsx';
import { NativeSelect } from '@/components/ui/native-select.tsx';
import { StageGlyph } from '@/features/leads/lead-glyphs.tsx';
import { AttributeRow, EditableField } from '@/features/records/editable-field.tsx';
import { useCan } from '@/features/workspace/use-can.ts';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { cn } from '@/lib/cn.ts';
import { listRowHover, revealOnHover } from '@/lib/interaction.ts';
import {
  type StageDraft,
  useArchivePipeline,
  useArchiveStage,
  useCreateStage,
  useReorderStages,
  useUpdatePipeline,
  useUpdateStage,
} from '@/lib/query/use-config-mutations.ts';
import { ArchiveConfirm } from './archive-confirm.tsx';
import { movedIds } from './field-key.ts';
import { focusNeighbourOf } from './focus.ts';
import { RoleNotice } from './role-notice.tsx';
import { SettingsGate } from './settings-gate.tsx';
import { useRefusedDraft } from './use-refused-draft.ts';

function asCategory(value: string): StageCategory {
  return STAGE_CATEGORIES.find((category) => category === value) ?? 'open';
}

function CategoryOptions() {
  return STAGE_CATEGORIES.map((category) => (
    <option key={category} value={category}>
      {STAGE_CATEGORY_LABELS[category]}
    </option>
  ));
}

function StageItem({
  stage,
  index,
  count,
  allowed,
  fallbackFocus,
  onMove,
}: {
  readonly stage: StageRow;
  readonly index: number;
  readonly count: number;
  readonly allowed: boolean;
  readonly fallbackFocus: () => HTMLElement | null;
  readonly onMove: (direction: -1 | 1) => void;
}) {
  const update = useUpdateStage();
  const archive = useArchiveStage();
  return (
    <li
      data-stage={stage.name}
      className={cn('group flex h-7 items-center gap-2 rounded-md px-2 text-dense', listRowHover)}
    >
      <StageGlyph category={stage.category} label={STAGE_CATEGORY_LABELS[stage.category]} />
      <div className="flex min-w-0 flex-1 items-center">
        {allowed ? (
          <EditableField
            inline
            required
            label={`stage ${stage.name}`}
            value={stage.name}
            onSave={(name) => update.mutate({ stage, patch: { name } })}
          />
        ) : (
          <span className="truncate text-text">{stage.name}</span>
        )}
      </div>
      <NativeSelect
        aria-label={`Type of ${stage.name}`}
        disabled={!allowed}
        value={stage.category}
        onChange={(event) =>
          update.mutate({ stage, patch: { category: asCategory(event.target.value) } })
        }
        className="h-6 w-28 text-xs"
      >
        <CategoryOptions />
      </NativeSelect>
      {allowed ? (
        <div className={cn('flex items-center', revealOnHover)}>
          <Button
            size="sm"
            variant="ghost"
            className="size-6 px-0"
            aria-label={`Move ${stage.name} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="size-6 px-0"
            aria-label={`Move ${stage.name} down`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="size-6 px-0"
            aria-label={`Archive ${stage.name}`}
            onClick={(event) => {
              focusNeighbourOf(event.currentTarget.closest('li'), fallbackFocus());
              archive.mutate(stage);
            }}
          >
            <Archive className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function NewStageForm({ pipelineId }: { readonly pipelineId: string }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<StageCategory>('open');
  const refused = useRefusedDraft<StageDraft>((draft) => {
    setName(draft.name);
    setCategory(draft.category);
  });
  const create = useCreateStage({ onRefused: refused.onRefused });
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim().length === 0) return;
        refused.setError(null);
        create.mutate({ pipelineId, name: name.trim(), category });
        setName('');
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          aria-label="New stage"
          placeholder="Nurture"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-7"
        />
        <NativeSelect
          aria-label="New stage type"
          value={category}
          onChange={(event) => setCategory(asCategory(event.target.value))}
          className="h-7"
        >
          <CategoryOptions />
        </NativeSelect>
        <Button type="submit" size="sm">
          Add stage
        </Button>
      </div>
      {refused.error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {refused.error}
        </p>
      )}
    </form>
  );
}

function PipelineBody({ pipelineId }: { readonly pipelineId: string }) {
  const workspace = useWorkspace();
  const router = useRouter();
  const allowed = useCan('pipeline:manage');
  const updatePipeline = useUpdatePipeline();
  const archivePipeline = useArchivePipeline();
  const reorder = useReorderStages(pipelineId);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const pipeline = workspace.pipelineById.get(pipelineId);
  if (leaving) return null;
  if (pipeline === undefined) {
    return (
      <EmptyState
        title="This pipeline does not exist"
        description="It may have been archived."
        action={<Link href="/settings/brands">Back to brands</Link>}
      />
    );
  }
  const stages = workspace.stagesOf(pipeline.id);
  const ids = stages.map((stage) => stage.id);
  const keep = () => {
    setConfirming(false);
    trigger.current?.focus();
  };
  const archive = () => {
    setLeaving(true);
    archivePipeline.mutate(pipeline, {
      onSuccess: () => router.push('/settings/brands'),
      onError: () => setLeaving(false),
    });
  };
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 ref={heading} tabIndex={-1} className="font-medium text-lg text-text outline-none">
          {workspace.brandById.get(pipeline.brandId)?.name ?? ''} · {pipeline.name}
        </h1>
        <p className="text-muted text-dense">
          Leads in this pipeline are numbered {pipeline.key}-1, {pipeline.key}-2 and so on.
        </p>
      </header>
      <dl className="flex flex-col">
        {allowed ? (
          <EditableField
            label="Name"
            value={pipeline.name}
            required
            onSave={(name) => updatePipeline.mutate({ pipeline, patch: { name } })}
          />
        ) : null}
        <AttributeRow label="Key">
          <span className="px-1 font-mono text-text">{pipeline.key}</span>
          <span className="text-faint">Keys are fixed: lead links use them.</span>
        </AttributeRow>
      </dl>
      {allowed ? null : <RoleNotice what="pipelines" permission="pipeline:manage" />}
      <section className="flex flex-col gap-2">
        <h2 className="font-medium text-dense text-text">Stages</h2>
        <ol aria-label="Stages" className="flex flex-col">
          {stages.map((stage, index) => (
            <StageItem
              key={stage.id}
              stage={stage}
              index={index}
              count={stages.length}
              allowed={allowed}
              fallbackFocus={() => heading.current}
              onMove={(direction) =>
                reorder.mutate({
                  pipelineId: pipeline.id,
                  stageIds: movedIds(ids, index, direction),
                })
              }
            />
          ))}
        </ol>
        {allowed ? <NewStageForm pipelineId={pipeline.id} /> : null}
      </section>
      {allowed ? (
        <div className="flex flex-col gap-2">
          <Button
            ref={trigger}
            variant="danger"
            size="sm"
            className="self-start"
            onClick={() => setConfirming(true)}
          >
            Archive pipeline
          </Button>
          {confirming ? (
            <ArchiveConfirm title={`Archive ${pipeline.name}`} onConfirm={archive} onCancel={keep}>
              Archive {pipeline.name}? Its stages, pipeline fields and saved views leave every list,
              and this cannot be undone here. Archiving is refused while a lead is open or on hold.
            </ArchiveConfirm>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function PipelinePanel({ pipelineId }: { readonly pipelineId: string }) {
  return (
    <SettingsGate title="Could not load the pipeline">
      <PipelineBody pipelineId={pipelineId} />
    </SettingsGate>
  );
}
