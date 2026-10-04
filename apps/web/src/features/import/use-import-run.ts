'use client';

import type { ImportReport } from '@gravity/shared/import';
import { useRef, useState } from 'react';
import { useToast } from '@/components/ui/toast.tsx';
import type { WorkspaceData } from '@/features/workspace/use-workspace.ts';
import { messageOf } from '@/lib/api/client.ts';
import { isRetryable } from '@/lib/query/fetcher.ts';
import { useDelayedFlag } from '@/lib/use-delayed-flag.ts';
import { draftOf, type ImportInputs, importIssues } from './import-draft.ts';
import { rowsToWrite } from './import-report.tsx';
import { type ImportDraft, useImportCommit, useImportPreview } from './use-import.ts';

export interface Staged {
  readonly report: ImportReport;
  readonly draft: ImportDraft;
  readonly inputs: ImportInputs;
}

export interface Done {
  readonly report: ImportReport;
  readonly draft: ImportDraft;
}

interface Failure {
  readonly message: string;
  readonly inputs: ImportInputs | null;
}

function rowCount(count: number): string {
  return `${count} row${count === 1 ? '' : 's'}`;
}

export function previewedDraft(staged: Staged): ImportDraft {
  return staged.report.status === 'partial'
    ? { ...staged.draft, rowLimit: staged.report.totals.processed }
    : staged.draft;
}

export function useImportRun(inputs: ImportInputs, workspace: WorkspaceData) {
  const { toast } = useToast();
  const preview = useImportPreview();
  const commit = useImportCommit();
  const requested = useRef<ImportInputs | null>(null);
  const previews = useRef(0);
  const sending = useRef(false);
  const [commitFailed, setCommitFailed] = useState(false);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const committing = commit.isPending;
  const waiting = useDelayedFlag(preview.isPending || committing);
  const showing = staged !== null && staged.inputs === inputs ? staged : null;
  const problem =
    failure !== null && (failure.inputs === null || failure.inputs === inputs)
      ? failure.message
      : null;

  function previewDraft(draft: ImportDraft): void {
    previews.current += 1;
    const ticket = previews.current;
    requested.current = inputs;
    setFailure(null);
    preview.mutate(draft, {
      onSuccess: (report) => {
        if (previews.current !== ticket) return;
        setCommitFailed(false);
        setDone(null);
        setStaged({ report, draft, inputs });
      },
      onError: (error) => {
        if (previews.current !== ticket) return;
        requested.current = null;
        setFailure({
          message: messageOf(error, 'The preview did not complete. Try again.'),
          inputs,
        });
      },
    });
  }

  function forgetPreview(): void {
    previews.current += 1;
    requested.current = null;
  }

  function runPreview(): void {
    const { file } = inputs;
    if (file === null || requested.current === inputs) return;
    const first = importIssues(inputs, file, workspace)[0];
    if (first !== undefined) {
      setFailure({ message: first, inputs });
      return;
    }
    previewDraft(draftOf(inputs, file));
  }

  function commitDraft(draft: ImportDraft): void {
    if (sending.current) return;
    sending.current = true;
    setFailure(null);
    setCommitFailed(false);
    commit.mutate(draft, {
      onSuccess: (report) => {
        sending.current = false;
        setDone({ report, draft });
        setStaged(null);
        toast(
          report.status === 'completed'
            ? { title: `Imported ${rowCount(rowsToWrite(report))}`, tone: 'success' }
            : {
                title: 'The import stopped part way',
                description: report.failure?.message ?? '',
                tone: 'danger',
              },
        );
      },
      onError: (error) => {
        sending.current = false;
        const retry = isRetryable(error);
        setCommitFailed(retry);
        setFailure({
          message: `${messageOf(error, 'The import did not complete.')}${
            retry
              ? ' Some batches may already be saved. Preview the file again to see what is left.'
              : ''
          }`,
          inputs: null,
        });
      },
    });
  }

  function runCommit(): void {
    if (showing === null || preview.isPending) return;
    if (commitFailed) {
      previewDraft({ ...showing.draft, rowLimit: null });
      return;
    }
    if (rowsToWrite(showing.report) === 0) return;
    commitDraft(previewedDraft(showing));
  }

  function runAgain(): void {
    const resumeFromRow = done?.report.resumeFromRow ?? null;
    if (done === null || done.report.status !== 'partial' || resumeFromRow === null) return;
    if (preview.isPending || committing) return;
    previewDraft({ ...done.draft, startRow: resumeFromRow, rowLimit: null });
  }

  return {
    staged: showing,
    done,
    problem,
    committing,
    waiting,
    previewing: preview.isPending,
    runPreview,
    runCommit,
    runAgain,
    commitFailed,
    fail: (message: string | null) =>
      setFailure(message === null ? null : { message, inputs: null }),
    dismissPreview: () => {
      forgetPreview();
      setCommitFailed(false);
      setFailure(null);
      setStaged(null);
    },
    reset: () => {
      forgetPreview();
      setCommitFailed(false);
      setStaged(null);
      setDone(null);
      setFailure(null);
    },
  };
}
