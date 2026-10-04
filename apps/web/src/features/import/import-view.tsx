'use client';

import type { ImportTarget } from '@gravity/shared/import';
import { FileUp } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { importDefinitions } from './import-draft.ts';
import { MappingStep, PreviewStep, ResultStep } from './import-steps.tsx';
import { SourceBar } from './source-bar.tsx';
import { useImportFlow } from './use-import-flow.ts';

export interface ImportViewProps {
  readonly initialTarget: ImportTarget;
  readonly initialPipelineKey: string | null;
}

function Alert({ message }: { readonly message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" className="text-danger text-dense">
      {message}
    </p>
  );
}

export function ImportView({ initialTarget, initialPipelineKey }: ImportViewProps) {
  const flow = useImportFlow(initialTarget, initialPipelineKey);
  const { workspace, setup, run } = flow;
  const { file, target, pipelineId, mapping, source } = setup.inputs;
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-medium text-lg text-text">Import</h1>
        <p className="text-dense text-muted">
          Bring people, companies and leads in from a CSV or JSON file. Nothing is written until you
          have seen the preview.
        </p>
      </header>
      {flow.canImport ? null : (
        <Alert message="Your role cannot run imports. Ask a member or an admin of this workspace." />
      )}
      {flow.canImport ? (
        <>
          <SourceBar
            workspace={workspace}
            target={target}
            pipelineId={pipelineId}
            source={source}
            fileName={file?.name ?? null}
            locked={flow.locked}
            committing={run.committing}
            onTarget={setup.chooseTarget}
            onPipeline={setup.choosePipeline}
            onSource={setup.setSource}
            onChoose={flow.chooseFile}
          />
          <input
            ref={flow.chooser}
            type="file"
            accept=".csv,.json,text/csv,application/json"
            aria-label="Import file"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = '';
              if (chosen !== undefined) flow.openFile(chosen).catch(() => undefined);
            }}
          />
          <Alert message={run.problem} />
          {file === null && run.done === null ? (
            <EmptyState
              icon={<FileUp />}
              title="Choose a CSV or JSON file."
              description="Up to 2,000 rows and 2 MB. People match by source id, email and LinkedIn URL, and companies by domain, so running the same file again adds nothing new."
            />
          ) : null}
          {file !== null && run.staged === null && run.done === null ? (
            <MappingStep
              table={file.table}
              target={target}
              mapping={mapping}
              fields={importDefinitions(workspace.allFields, target, pipelineId)}
              onColumn={setup.setColumn}
              onPreview={run.runPreview}
            />
          ) : null}
          {run.staged === null ? null : (
            <PreviewStep staged={run.staged} onBack={flow.back} onCommit={run.runCommit} />
          )}
          {run.done === null ? null : (
            <ResultStep done={run.done} workspace={workspace} onAgain={run.reset} />
          )}
          {run.waiting ? (
            <p role="status" className="text-dense text-muted">
              {run.committing
                ? 'Importing in batches of 100 rows. Each batch shows up in open lists as it is saved. Keep this page open until it finishes.'
                : 'Checking every row against the workspace. Nothing is written yet.'}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
