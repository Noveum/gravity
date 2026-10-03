'use client';

import type { LeadRow } from '@gravity/shared/records';
import type { LeadChange } from '@gravity/shared/validators';
import { useCallback } from 'react';
import { useToast } from '@/components/ui/toast.tsx';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { useChangeLeads } from '@/lib/query/use-lead-mutations.ts';
import {
  describeLeadChange,
  forgetLeadChange,
  isLeadChangeRecorded,
  leadsLabel,
  nextUndoSequence,
  recordLeadChange,
  type UndoEntry,
  useLeadUndo,
} from './lead-undo.ts';

export type CommitLeadChange = (
  leads: readonly LeadRow[],
  change: LeadChange,
  announce: boolean,
) => void;

function subjectOf(leads: readonly LeadRow[]): string {
  const [only] = leads;
  return leads.length === 1 && only !== undefined ? only.key : leadsLabel(leads.length);
}

export function useCommitLeadChange(): CommitLeadChange {
  const workspace = useWorkspace();
  const { mutateAsync } = useChangeLeads();
  const { undoEntry } = useLeadUndo();
  const { toast } = useToast();
  const { stageById, memberByUserId } = workspace;
  return useCallback(
    (leads, change, announce) => {
      const before = [...leads];
      const names = {
        stageName: (id: string) => stageById.get(id)?.name,
        memberName: (id: string) => memberByUserId.get(id)?.name,
      };
      const label = describeLeadChange(change, names, subjectOf(before));
      const after = mutateAsync({ leads: before, change });
      const entry: UndoEntry = { sequence: nextUndoSequence(), before, after, label };
      recordLeadChange(entry);
      after
        .then(() => {
          if (!(announce && isLeadChangeRecorded(entry))) return;
          toast({ title: label, action: { label: 'Undo', onSelect: () => undoEntry(entry) } });
        })
        .catch(() => forgetLeadChange(entry));
    },
    [stageById, memberByUserId, mutateAsync, undoEntry, toast],
  );
}
