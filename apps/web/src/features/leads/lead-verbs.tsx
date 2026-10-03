'use client';

import {
  BULK_CONFIRM_THRESHOLD,
  LEAD_PRIORITIES,
  LEAD_PRIORITY_LABELS,
  MAX_BULK_LEADS,
} from '@gravity/shared/constants';
import {
  inverseLeadChange,
  type LeadRow,
  leadStateOf,
  resolveLeadChange,
  type StageRow,
} from '@gravity/shared/records';
import type { LeadChange } from '@gravity/shared/validators';
import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
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
  forgetLeadChange,
  isLeadChangeRecorded,
  leadsLabel,
  nextUndoSequence,
  recordLeadChange,
  type UndoEntry,
  useLeadUndo,
} from './lead-undo.ts';
import { VERB_ITEMS, type VerbMode } from './lead-verb-menu.tsx';
import { HoldPicker, NextActionPicker } from './text-pickers.tsx';
import {
  anchorFocusTarget,
  type FocusTarget,
  type PickerOption,
  VerbPicker,
} from './verb-picker.tsx';

export type { VerbMode } from './lead-verb-menu.tsx';

const ALL_VERBS: readonly VerbMode[] = VERB_ITEMS.map((item) => item.verb);
const SURFACE = {
  section: 'Records',
  scope: 'records',
  priority: HOTKEY_PRIORITY.surface,
} as const;
const UNASSIGNED = 'none';
const ENTER_AGAIN = 'Press Enter again to confirm.';

export interface LeadVerbsProps {
  readonly selection: LeadListSelection;
  readonly pipelineId: string;
  readonly anchorPrefix?: string;
  readonly verbs?: readonly VerbMode[];
}

interface Subject {
  readonly leads: readonly LeadRow[];
  readonly fromMenu: boolean;
}

interface Pending {
  readonly key: string;
  readonly notice: string;
}

function subjectOf(leads: readonly LeadRow[]): string {
  const [only] = leads;
  return leads.length === 1 && only !== undefined ? only.key : leadsLabel(leads.length);
}

function changingCount(
  leads: readonly LeadRow[],
  change: LeadChange,
  stages: readonly StageRow[],
): number {
  return leads.filter((lead) => {
    const state = leadStateOf(lead);
    try {
      return inverseLeadChange(state, resolveLeadChange(state, change, stages)) !== null;
    } catch {
      return true;
    }
  }).length;
}

function confirmNotice(changing: number, total: number, again: string): string {
  const summary =
    changing === total
      ? `This changes ${total} leads.`
      : `This changes ${changing} of ${total} leads; ${total - changing} already match.`;
  return `${summary} ${again}`;
}

function limitNotice(total: number): string {
  return `You can change up to ${MAX_BULK_LEADS} leads at once, and ${total} are selected. Narrow the selection first.`;
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
  const [subject, setSubject] = useState<Subject | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const { active, hasSelection, selectionLeft, request, settleRequest } = selection;
  const targets = subject?.leads ?? selection.targets;
  const anchorLead = subject?.leads[0] ?? active;
  const anchorId = anchorLead === undefined ? null : `${anchorPrefix}${anchorLead.id}`;
  const origin = useRef<HTMLElement | null>(null);
  const returnFocus: FocusTarget = () => origin.current ?? anchorFocusTarget(anchorId);
  const allStages = workspace.stagesOf(pipelineId);
  const stages = useMemo(() => allStages.filter((stage) => stage.archivedAt === null), [allStages]);
  const stageChoices = useMemo(() => {
    const firstHold = stages.find((stage) => stage.category === 'hold');
    return stages.filter((stage) => stage.category !== 'hold' || stage === firstHold);
  }, [stages]);
  const names: ChangeNames = {
    stageName: (id) => workspace.stageById.get(id)?.name,
    memberName: (id) => workspace.memberByUserId.get(id)?.name,
  };
  const overLimit = targets.length > MAX_BULK_LEADS;
  const notice = overLimit ? limitNotice(targets.length) : (pending?.notice ?? null);

  useEffect(() => {
    if (request === null) return;
    origin.current = request.origin;
    setSubject({ leads: [request.lead], fromMenu: true });
    setPending(null);
    setMode(request.verb);
    settleRequest();
  }, [request, settleRequest]);

  const close = () => {
    setMode(null);
    setPending(null);
    setSubject(null);
  };

  const apply = (change: LeadChange, again: string) => {
    if (targets.length === 0 || overLimit) return;
    const key = JSON.stringify(change);
    if (targets.length > BULK_CONFIRM_THRESHOLD && pending?.key !== key) {
      const changing = changingCount(targets, change, allStages);
      setPending({ key, notice: confirmNotice(changing, targets.length, again) });
      return;
    }
    const before = [...targets];
    const announce = hasSelection || selectionLeft || subject?.fromMenu === true;
    close();
    const label = describeLeadChange(change, names, subjectOf(before));
    const after = changeLeads.mutateAsync({ leads: before, change });
    const entry: UndoEntry = { sequence: nextUndoSequence(), before, after, label };
    recordLeadChange(entry);
    after
      .then(() => {
        if (!(announce && isLeadChangeRecorded(entry))) return;
        toast({ title: label, action: { label: 'Undo', onSelect: () => undoEntry(entry) } });
      })
      .catch(() => forgetLeadChange(entry));
  };

  const pickStage = (id: string) => {
    const stage = stages.find((candidate) => candidate.id === id);
    if (stage === undefined) return;
    const again = `Choose ${stage.name} again to confirm.`;
    if (stage.category === 'hold') {
      setPending(null);
      setMode('hold');
      return;
    }
    if (stage.category === 'won' || stage.category === 'lost') {
      apply({ type: 'close', stageId: id }, again);
      return;
    }
    apply({ type: 'update', patch: { stageId: id } }, again);
  };

  const openFrom = (next: VerbMode, from: HTMLElement | null) => {
    if (selection.targets.length === 0) return;
    origin.current = from;
    setSubject(from === null ? null : { leads: selection.targets, fromMenu: false });
    setPending(null);
    setMode(next);
  };
  const opener = (next: VerbMode) => () => openFrom(next, null);
  const clicked = (next: VerbMode) => (event: MouseEvent<HTMLButtonElement>) =>
    openFrom(next, event.currentTarget);
  const enabled = (verb: VerbMode) =>
    verbs.includes(verb) && selection.targets.length > 0 && mode === null;

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

  const stageOption = (stage: StageRow): PickerOption => ({
    id: stage.id,
    label: stage.name,
    icon: <StageGlyph category={stage.category} label={stage.name} />,
  });
  const priorityOptions = LEAD_PRIORITIES.map((priority) => ({
    id: String(priority),
    label: LEAD_PRIORITY_LABELS[priority],
    icon: <PriorityGlyph priority={priority} />,
  }));
  const ownerOptions: PickerOption[] = [
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
  ];
  const labelOf = (options: readonly PickerOption[], id: string) =>
    `Choose ${options.find((option) => option.id === id)?.label ?? 'it'} again to confirm.`;
  const shared = { anchorId, notice, onClose: close, returnFocus } as const;

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
      {selection.targets.length > 1 ? (
        <section
          aria-label="Selected leads"
          className="flex items-center gap-1 border-border border-t bg-surface px-3 py-2 text-dense"
        >
          <span className="mr-2 text-muted">{selection.targets.length} selected</span>
          <Button size="sm" variant="ghost" onClick={clicked('stage')}>
            Stage
          </Button>
          <Button size="sm" variant="ghost" onClick={clicked('owner')}>
            Assign
          </Button>
          <Button size="sm" variant="ghost" onClick={clicked('priority')}>
            Priority
          </Button>
          <Button size="sm" variant="ghost" onClick={clicked('nextAction')}>
            Next action
          </Button>
          <Button size="sm" variant="ghost" onClick={clicked('hold')}>
            Hold
          </Button>
          <Button size="sm" variant="ghost" onClick={clicked('close')}>
            Close
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={selection.clear}>
            Clear
          </Button>
        </section>
      ) : null}
      <VerbPicker
        {...shared}
        open={mode === 'stage'}
        title="Move to stage"
        options={stageChoices.map(stageOption)}
        onPick={pickStage}
      />
      <VerbPicker
        {...shared}
        open={mode === 'owner'}
        title="Assign to"
        options={ownerOptions}
        onPick={(id) =>
          apply(
            { type: 'update', patch: { ownerId: id === UNASSIGNED ? null : id } },
            labelOf(ownerOptions, id),
          )
        }
      />
      <VerbPicker
        {...shared}
        open={mode === 'priority'}
        title="Set priority"
        options={priorityOptions}
        onPick={(id) =>
          apply({ type: 'update', patch: { priority: Number(id) } }, labelOf(priorityOptions, id))
        }
      />
      <VerbPicker
        {...shared}
        open={mode === 'close'}
        title="Close as"
        options={stages
          .filter((stage) => stage.category === 'won' || stage.category === 'lost')
          .map(stageOption)}
        onPick={(id) =>
          apply(
            { type: 'close', stageId: id },
            `Choose ${workspace.stageById.get(id)?.name ?? 'it'} again to confirm.`,
          )
        }
      />
      {mode === 'nextAction' ? (
        <NextActionPicker
          {...shared}
          open
          initial={anchorLead?.nextAction ?? ''}
          onSubmit={(value) => apply({ type: 'update', patch: value }, ENTER_AGAIN)}
        />
      ) : null}
      {mode === 'hold' ? (
        <HoldPicker
          {...shared}
          open
          onSubmit={(value) =>
            apply({ type: 'hold', reason: value.reason, until: value.until }, ENTER_AGAIN)
          }
        />
      ) : null}
    </>
  );
}
