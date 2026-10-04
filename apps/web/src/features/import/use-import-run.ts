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

export function useImportRun(inputs: ImportInputs, workspace: WorkspaceData) {
  const { toast } = useToast();
  const preview = useImportPreview();
  const commit = useImportCommit();
  const requested = useRef<ImportInputs | null>(null);
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

  function runPreview(): void {
    const { file } = inputs;
    if (file === null || requested.current === inputs) return;
    const draft = draftOf(inputs, file);
    const first = importIssues(inputs, file, workspace)[0];
    if (first !== undefined) {
      setFailure({ message: first, inputs });
      return;
    }
    setFailure(null);
    requested.current = inputs;
    preview.mutate(draft, {
      onSuccess: (report) => setStaged({ report, draft, inputs }),
      onError: (error) => {
        requested.current = null;
        setFailure({
          message: messageOf(error, 'The preview did not complete. Try again.'),
          inputs,
        });
      },
    });
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
            retry ? ' Some batches may already be saved. Run the same file again to continue.' : ''
          }`,
          inputs: null,
        });
      },
    });
  }

  function runCommit(): void {
    if (showing === null || rowsToWrite(showing.report) === 0) return;
    commitDraft(showing.draft);
  }

  function runAgain(): void {
    if (done?.report.status === 'partial') commitDraft(done.draft);
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
      requested.current = null;
      setCommitFailed(false);
      setFailure(null);
      setStaged(null);
    },
    reset: () => {
      requested.current = null;
      setCommitFailed(false);
      setStaged(null);
      setDone(null);
      setFailure(null);
    },
  };
}
