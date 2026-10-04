'use client';

import type { ImportColumn, ImportMapping, ImportTarget } from '@gravity/shared/import';
import { useMemo, useRef, useState } from 'react';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { messageOf } from '@/lib/api/client.ts';
import {
  type ImportInputs,
  type LoadedFile,
  readImportFile,
  suggestedMapping,
} from './import-draft.ts';

export function useImportInputs(initialTarget: ImportTarget, initialPipelineKey: string | null) {
  const workspace = useWorkspace();
  const loads = useRef(0);
  const [target, setTarget] = useState<ImportTarget>(initialTarget);
  const [pipelineId, setPipelineId] = useState<string | null>(
    workspace.pipelineByKey.get(initialPipelineKey ?? '')?.id ?? workspace.pipelines[0]?.id ?? null,
  );
  const [source, setSource] = useState('');
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const inputs = useMemo<ImportInputs>(
    () => ({ file, target, pipelineId, mapping, source }),
    [file, target, pipelineId, mapping, source],
  );

  function remap(loaded: LoadedFile, nextTarget: ImportTarget, nextPipelineId: string | null) {
    setMapping(suggestedMapping(loaded.table, workspace.allFields, nextTarget, nextPipelineId));
  }

  return {
    inputs,
    chooseTarget: (next: ImportTarget) => {
      setTarget(next);
      if (file !== null) remap(file, next, pipelineId);
    },
    choosePipeline: (next: string | null) => {
      setPipelineId(next);
      if (file !== null) remap(file, target, next);
    },
    setSource,
    setColumn: (header: string, column: ImportColumn) =>
      setMapping((current) => ({ ...current, [header]: column })),
    clearFile: () => {
      loads.current += 1;
      setFile(null);
    },
    load: async (chosen: File): Promise<string | null> => {
      loads.current += 1;
      const ticket = loads.current;
      try {
        const loaded = await readImportFile(chosen);
        if (loads.current !== ticket) return null;
        setFile(loaded);
        remap(loaded, target, pipelineId);
        return null;
      } catch (error: unknown) {
        if (loads.current !== ticket) return null;
        setFile(null);
        return messageOf(error, 'This file could not be read.');
      }
    },
  };
}
