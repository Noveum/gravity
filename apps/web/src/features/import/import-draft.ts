import {
  decodeImportBytes,
  HTTP_IMPORT_LIMITS,
  type ImportFormat,
  type ImportMapping,
  type ImportTable,
  type ImportTarget,
  importRequestSchema,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  mappingIssues,
  parseImportTable,
  suggestMapping,
} from '@gravity/shared/import';
import type { FieldDefinitionRow } from '@gravity/shared/records';
import type { WorkspaceData } from '@/features/workspace/use-workspace.ts';
import type { ImportDraft } from './use-import.ts';

export interface LoadedFile {
  readonly name: string;
  readonly format: ImportFormat;
  readonly content: string;
  readonly table: ImportTable;
}

export interface ImportInputs {
  readonly file: LoadedFile | null;
  readonly target: ImportTarget;
  readonly pipelineId: string | null;
  readonly mapping: ImportMapping;
  readonly source: string;
}

export const IMPORT_MAX_SIZE = `${(MAX_IMPORT_BYTES / 1_000_000).toFixed(1)} MB`;
export const IMPORT_LIMITS_COPY = `Up to ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows and ${IMPORT_MAX_SIZE}.`;

export function formatOf(name: string): ImportFormat {
  return name.toLowerCase().endsWith('.json') ? 'json' : 'csv';
}

export async function readImportFile(chosen: File): Promise<LoadedFile> {
  if (chosen.size > MAX_IMPORT_BYTES) {
    throw new Error(
      `${chosen.name} is larger than ${IMPORT_MAX_SIZE}. Split it, or use bun run import.`,
    );
  }
  const format = formatOf(chosen.name);
  const content = decodeImportBytes(new Uint8Array(await chosen.arrayBuffer()), HTTP_IMPORT_LIMITS);
  return {
    name: chosen.name,
    format,
    content,
    table: parseImportTable(format, content, HTTP_IMPORT_LIMITS),
  };
}

export function importDefinitions(
  allFields: readonly FieldDefinitionRow[],
  target: ImportTarget,
  pipelineId: string | null,
): FieldDefinitionRow[] {
  return allFields.filter(
    (field) =>
      field.object !== 'lead' ||
      (target === 'leads' && (field.pipelineId === null || field.pipelineId === pipelineId)),
  );
}

export function suggestedMapping(
  table: ImportTable,
  allFields: readonly FieldDefinitionRow[],
  target: ImportTarget,
  pipelineId: string | null,
): ImportMapping {
  return suggestMapping(table.headers, target, importDefinitions(allFields, target, pipelineId));
}

export function draftOf(inputs: ImportInputs, file: LoadedFile): ImportDraft {
  return {
    format: file.format,
    content: file.content,
    target: inputs.target,
    pipelineId: inputs.target === 'leads' ? inputs.pipelineId : null,
    mapping: inputs.mapping,
    source: inputs.source,
    defaultOwner: 'me',
  };
}

export function importIssues(
  inputs: ImportInputs,
  file: LoadedFile,
  workspace: WorkspaceData,
): string[] {
  const request = importRequestSchema.safeParse(draftOf(inputs, file));
  const keysOf = (object: 'person' | 'company', pipelineId: string | null) =>
    workspace.fieldsFor(object, pipelineId).map((field) => field.key);
  return [
    ...(request.success ? [] : request.error.issues.map((issue) => issue.message)),
    ...mappingIssues(inputs.mapping, inputs.target, file.table.headers, {
      person: keysOf('person', null),
      company: keysOf('company', null),
      lead:
        inputs.pipelineId === null
          ? []
          : workspace.fieldsFor('lead', inputs.pipelineId).map((field) => field.key),
    }),
  ];
}
