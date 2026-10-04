'use client';

import type { ImportTarget } from '@gravity/shared/import';
import { useMemo, useRef } from 'react';
import { useCan } from '@/features/workspace/use-can.ts';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { useHotkey } from '@/lib/keyboard/index.ts';
import { useImportInputs } from './use-import-inputs.ts';
import { useImportRun } from './use-import-run.ts';
import { useStepFocus } from './use-step-focus.ts';

export type ImportStepName = 'choose' | 'map' | 'preview' | 'result';

export function useImportFlow(initialTarget: ImportTarget, initialPipelineKey: string | null) {
  const workspace = useWorkspace();
  const canImport = useCan('import:run');
  const chooser = useRef<HTMLInputElement | null>(null);
  const setup = useImportInputs(initialTarget, initialPipelineKey);
  const run = useImportRun(setup.inputs, workspace);
  const { file } = setup.inputs;
  const locked = run.staged !== null || run.done !== null;
  let step: ImportStepName = 'map';
  if (run.done !== null) step = 'result';
  else if (run.staged !== null) step = 'preview';
  else if (file === null) step = 'choose';
  const focusSignal = useMemo(() => ({ step, file, done: run.done }), [step, file, run.done]);
  const focusTarget = useStepFocus(focusSignal);

  function chooseFile(): void {
    if (!run.committing) chooser.current?.click();
  }

  function next(): void {
    if (!canImport) return;
    if (run.done !== null) run.runAgain();
    else if (run.staged === null) run.runPreview();
    else run.runCommit();
  }

  function startOver(): void {
    if (run.committing) return;
    setup.clearFile();
    run.reset();
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
  useHotkey('n', startOver, {
    label: 'Import another file',
    enabled: canImport && run.done !== null,
  });

  return {
    workspace,
    canImport,
    chooser,
    focusTarget,
    step,
    setup,
    run,
    locked,
    chooseFile,
    openFile,
    startOver,
    back,
  };
}
