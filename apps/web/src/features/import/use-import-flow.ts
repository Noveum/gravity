'use client';

import type { ImportTarget } from '@gravity/shared/import';
import { useRef } from 'react';
import { useCan } from '@/features/workspace/use-can.ts';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { useHotkey } from '@/lib/keyboard/index.ts';
import { useImportInputs } from './use-import-inputs.ts';
import { useImportRun } from './use-import-run.ts';

export function useImportFlow(initialTarget: ImportTarget, initialPipelineKey: string | null) {
  const workspace = useWorkspace();
  const canImport = useCan('import:run');
  const chooser = useRef<HTMLInputElement | null>(null);
  const setup = useImportInputs(initialTarget, initialPipelineKey);
  const run = useImportRun(setup.inputs, workspace);
  const { file } = setup.inputs;
  const locked = run.staged !== null || run.done !== null;

  function chooseFile(): void {
    if (!run.committing) chooser.current?.click();
  }

  function next(): void {
    if (!canImport || run.done !== null) return;
    if (run.staged === null) run.runPreview();
    else run.runCommit();
  }

  function back(): void {
    if (run.committing) return;
    if (run.staged !== null) {
      run.dismissPreview();
    } else if (file !== null && run.done === null) {
      setup.clearFile();
      run.reset();
    }
  }

  async function openFile(chosen: File): Promise<void> {
    run.reset();
    run.fail(await setup.load(chosen));
  }

  useHotkey('mod+enter', next, {
    label: 'Preview, then run the import',
    allowInInput: true,
    enabled: canImport,
  });
  useHotkey('escape', back, {
    label: 'Go back a step',
    allowInInput: true,
    enabled: canImport && (run.staged !== null || (file !== null && run.done === null)),
  });
  useHotkey('o', chooseFile, { label: 'Choose a file', enabled: canImport });

  return { workspace, canImport, chooser, setup, run, locked, chooseFile, openFile, next, back };
}
