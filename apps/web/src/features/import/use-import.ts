'use client';

import {
  type ImportDefaultOwner,
  type ImportFormat,
  type ImportMapping,
  type ImportReport,
  type ImportTarget,
  importReportSchema,
} from '@gravity/shared/import';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from '@/lib/api/client.ts';

export interface ImportDraft {
  readonly format: ImportFormat;
  readonly content: string;
  readonly target: ImportTarget;
  readonly pipelineId: string | null;
  readonly mapping: ImportMapping;
  readonly source: string;
  readonly defaultOwner: ImportDefaultOwner;
  readonly startRow: number;
  readonly rowLimit: number | null;
}

const responseSchema = z.object({ report: importReportSchema });

async function send(path: string, draft: ImportDraft): Promise<ImportReport> {
  return (await apiFetch(path, responseSchema, { method: 'POST', body: draft })).report;
}

export function useImportPreview() {
  return useMutation({ mutationFn: (draft: ImportDraft) => send('/api/imports/preview', draft) });
}

export function useImportCommit() {
  return useMutation({ mutationFn: (draft: ImportDraft) => send('/api/imports', draft) });
}
