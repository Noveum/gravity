'use client';

import {
  BULK_CONFIRM_THRESHOLD,
  LEAD_PRIORITIES,
  LEAD_PRIORITY_LABELS,
} from '@gravity/shared/constants';
import type { LeadRow } from '@gravity/shared/records';
import type { LeadChange } from '@gravity/shared/validators';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Button } from '@/components/ui/button.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { HOTKEY_PRIORITY, useHotkey } from '@/lib/keyboard/index.ts';
import { useChangeLeads } from '@/lib/query/use-lead-mutations.ts';
import { PriorityGlyph, StageGlyph } from './lead-glyphs.tsx';
import type { LeadListSelection } from './lead-list.tsx';
import {
  type ChangeNames,
  describeLeadChange,
  leadsLabel,
  nextUndoSequence,
  recordLeadChange,
  type UndoEntry,
  useLeadUndo,
} from './lead-undo.ts';
import { HoldPicker, NextActionPicker } from './text-pickers.tsx';
import { type PickerOption, VerbPicker } from './verb-picker.tsx';

export type VerbMode = 'stage' | 'owner' | 'priority' | 'nextAction' | 'hold' | 'close';

const ALL_VERBS: readonly VerbMode[] = [
  'stage',
  'owner',
  'priority',
  'nextAction',
  'hold',
  'close',
];
const SURFACE = {
  section: 'Records',
  scope: 'records',
  priority: HOTKEY_PRIORITY.surface,
} as const;
const UNASSIGNED = 'none';

export interface LeadVerbsProps {
  readonly selection: LeadListSelection;
  readonly pipelineId: string;
  readonly anchorPrefix?: string;
  readonly verbs?: readonly VerbMode[];
}

function subjectOf(leads: readonly LeadRow[]): string {
  const [only] = leads;
  return leads.length === 1 && only !== undefined ? only.key : leadsLabel(leads.length);
}

export function LeadVerbs({
  selection,
  pipelineId,
  anchorPrefix = 'lead-',
  verbs = ALL_VERBS,
}: LeadVerbsProps) {
  const workspace = useWorkspace();
  const changeLeads = useChangeLeads();
  const { undoEntry } = useLeadUndo();
  const { toast } = useToast();
  const [mode, setMode] = useState<VerbMode | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const { targets, active, selectionLeft } = selection;
  const anchorId = active === undefined ? null : `${anchorPrefix}${active.id}`;
  const allStages = workspace.stagesOf(pipelineId);
  const stages = useMemo(() => allStages.filter((stage) => stage.archivedAt === null), [allStages]);
  const names: ChangeNames = {
    stageName: (id) => workspace.stageById.get(id)?.name,
    memberName: (id) => workspace.memberByUserId.get(id)?.name,
  };
  const notice =
    pending === null
      ? null
      : `This changes ${targets.length} leads. Choose the same option again to confirm.`;

  const close = () => {
    setMode(null);
    setPending(null);
  };

  const apply = (change: LeadChange) => {
    if (targets.length === 0) return;
    const key = JSON.stringify(change);
    if (targets.length > BULK_CONFIRM_THRESHOLD && pending !== key) {
      setPending(key);
      return;
    }
    close();
    const before = [...targets];
    const announce = before.length > 1 || selectionLeft;
    const sequence = nextUndoSequence();
    const label = describeLeadChange(change, names, subjectOf(before));
    changeLeads
      .mutateAsync({ leads: before, change })
      .then((after) => {
        const entry: UndoEntry = { sequence, before, after, label };
        recordLeadChange(entry);
        if (!announce) return;
        toast({ title: label, action: { label: 'Undo', onSelect: () => undoEntry(entry) } });
      })
      .catch(() => undefined);
  };

  const pickStage = (id: string) => {
    const stage = stages.find((candidate) => candidate.id === id);
    if (stage === undefined) return;
    if (stage.category === 'hold') {
      setMode('hold');
      return;
    }
    if (stage.category === 'won' || stage.category === 'lost') {
      apply({ type: 'close', stageId: id });
      return;
    }
    apply({ type: 'update', patch: { stageId: id } });
  };

  const opener = (next: VerbMode) => () => {
    if (targets.length > 0) setMode(next);
  };
  const enabled = (verb: VerbMode) => verbs.includes(verb) && targets.length > 0 && mode === null;

  useHotkey('s', opener('stage'), {
    ...SURFACE,
    label: 'Set the stage',
    enabled: enabled('stage'),
  });
  useHotkey('a', opener('owner'), { ...SURFACE, label: 'Assign', enabled: enabled('owner') });
  useHotkey('p', opener('priority'), {
    ...SURFACE,
    label: 'Set the priority',
    enabled: enabled('priority'),
  });
  useHotkey('n', opener('nextAction'), {
    ...SURFACE,
    label: 'Set the next action',
    enabled: enabled('nextAction'),
  });
  useHotkey('shift+h', opener('hold'), {
    ...SURFACE,
    label: 'Hold with a reason',
    enabled: enabled('hold'),
  });
  useHotkey('mod+backspace', opener('close'), {
    ...SURFACE,
    label: 'Close',
    enabled: enabled('close'),
  });

  const stageOption = (stage: (typeof stages)[number]): PickerOption => ({
    id: stage.id,
    label: stage.name,
    icon: <StageGlyph category={stage.category} label={stage.name} />,
  });

  return (
    <>
      {selectionLeft && active !== undefined ? (
        <p
          role="status"
          aria-label="Selection"
          className="border-border border-t bg-surface px-3 py-2 text-dense text-muted"
        >
          Your selection left the list. Verbs act on{' '}
          <span className="text-text">
            {active.key} {active.personName}
          </span>
          .
        </p>
      ) : null}
      {targets.length > 1 ? (
        <div
          role="toolbar"
          aria-label="Selected leads"
          className="flex items-center gap-1 border-border border-t bg-surface px-3 py-2 text-dense"
        >
          <span className="mr-2 text-muted">{targets.length} selected</span>
          <Button size="sm" variant="ghost" onClick={opener('stage')}>
            Stage
          </Button>
          <Button size="sm" variant="ghost" onClick={opener('owner')}>
            Assign
          </Button>
          <Button size="sm" variant="ghost" onClick={opener('priority')}>
            Priority
          </Button>
          <Button size="sm" variant="ghost" onClick={opener('hold')}>
            Hold
          </Button>
          <Button size="sm" variant="ghost" onClick={opener('close')}>
            Close
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={selection.clear}>
            Clear
          </Button>
        </div>
      ) : null}
      <VerbPicker
        open={mode === 'stage'}
        anchorId={anchorId}
        title="Move to stage"
        notice={notice}
        options={stages.map(stageOption)}
        onPick={pickStage}
        onClose={close}
      />
      <VerbPicker
        open={mode === 'owner'}
        anchorId={anchorId}
        title="Assign to"
        notice={notice}
        options={[
          {
            id: UNASSIGNED,
            label: 'Unassigned',
            icon: (
              <span
                aria-hidden="true"
                className="size-4.5 shrink-0 rounded-full border border-border border-dashed"
              />
            ),
          },
          ...workspace.members.map((member) => ({
            id: member.userId,
            label: member.name,
            icon: <Avatar name={member.name} src={member.image} size="xs" />,
            ...(member.isAgent ? { hint: 'Agent' } : {}),
          })),
        ]}
        onPick={(id) =>
          apply({ type: 'update', patch: { ownerId: id === UNASSIGNED ? null : id } })
        }
        onClose={close}
      />
      <VerbPicker
        open={mode === 'priority'}
        anchorId={anchorId}
        title="Set priority"
        notice={notice}
        options={LEAD_PRIORITIES.map((priority) => ({
          id: String(priority),
          label: LEAD_PRIORITY_LABELS[priority],
          icon: <PriorityGlyph priority={priority} />,
        }))}
        onPick={(id) => apply({ type: 'update', patch: { priority: Number(id) } })}
        onClose={close}
      />
      <VerbPicker
        open={mode === 'close'}
        anchorId={anchorId}
        title="Close as"
        notice={notice}
        options={stages
          .filter((stage) => stage.category === 'won' || stage.category === 'lost')
          .map(stageOption)}
        onPick={(id) => apply({ type: 'close', stageId: id })}
        onClose={close}
      />
      {mode === 'nextAction' ? (
        <NextActionPicker
          open
          anchorId={anchorId}
          initial={active?.nextAction ?? ''}
          notice={notice}
          onSubmit={(value) => apply({ type: 'update', patch: value })}
          onClose={close}
        />
      ) : null}
      {mode === 'hold' ? (
        <HoldPicker
          open
          anchorId={anchorId}
          notice={notice}
          onSubmit={(value) => apply({ type: 'hold', reason: value.reason, until: value.until })}
          onClose={close}
        />
      ) : null}
    </>
  );
}
