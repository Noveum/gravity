import { db, eq, schema } from '@gravity/db';
import {
  assertImportFileSize,
  CLI_IMPORT_LIMITS,
  decodeImportBytes,
  IMPORT_DEFAULT_SOURCE,
  IMPORT_FORMATS,
  IMPORT_TARGETS,
  type ImportLimits,
  type ImportMapping,
  type ImportReport,
  importMappingSchema,
  parseImportTable,
  suggestMapping,
} from '@gravity/shared/import';
import type { Principal } from '@gravity/shared/policy';
import { emailSchema } from '@gravity/shared/validators';
import { z } from 'zod';
import { listFieldDefinitions } from '../crm/field-service.ts';
import { listPipelines } from '../crm/pipeline-service.ts';
import { resolvePrincipal } from '../org/member-service.ts';
import { getOrganizationBySlug } from '../org/organization-service.ts';
import { flushOutbox } from '../realtime/outbox.ts';
import { commitImport, previewImport } from './import-service.ts';

export interface CliIo {
  readonly sizeOf: (path: string) => Promise<number>;
  readonly readBytes: (path: string) => Promise<Uint8Array>;
  readonly print: (line: string) => void;
}

const USAGE =
  'Usage: bun run import <csv|json> <file> --workspace <slug> --as <email> --target <people|companies|leads> [--pipeline <KEY>] [--mapping <file.json>] [--source <name>] [--from-row <n>] [--commit]';

const MAPPING_FILE_LIMITS = { maxBytes: 1_000_000, maxRows: 1 } as const;

const argsSchema = z.object({
  adapter: z.enum(IMPORT_FORMATS),
  path: z.string().min(1),
  workspace: z.string().min(1),
  as: emailSchema,
  target: z.enum(IMPORT_TARGETS),
  pipeline: z.string().min(1).optional(),
  mapping: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  fromRow: z
    .string()
    .regex(/^[1-9][0-9]{0,5}$/, 'Use a row number from 1.')
    .transform(Number)
    .optional(),
  commit: z.boolean(),
});
export type CliArgs = z.infer<typeof argsSchema>;

const mappingFileSchema = z.object({ columns: importMappingSchema });

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  let commit = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    if (name === 'commit') {
      commit = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${name} needs a value. ${USAGE}`);
    }
    flags.set(name, value);
    index += 1;
  }
  const parsed = argsSchema.safeParse({
    adapter: positional[0],
    path: positional[1],
    workspace: flags.get('workspace'),
    as: flags.get('as'),
    target: flags.get('target'),
    pipeline: flags.get('pipeline'),
    mapping: flags.get('mapping'),
    source: flags.get('source'),
    fromRow: flags.get('from-row'),
    commit,
  });
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new Error(
    `${issue?.path.join('.') ?? 'arguments'}: ${issue?.message ?? 'invalid'}. ${USAGE}`,
  );
}

async function pipelineIdOf(principal: Principal, args: CliArgs): Promise<string | null> {
  if (args.target !== 'leads') return null;
  const wanted = args.pipeline;
  if (wanted === undefined) throw new Error('A leads import needs --pipeline <KEY>.');
  const pipelines = await listPipelines(principal);
  const pipeline = pipelines.find(
    (entry) => entry.key === wanted.toUpperCase() || entry.id === wanted,
  );
  if (pipeline === undefined) {
    throw new Error(
      `There is no pipeline ${wanted}. Pipelines: ${pipelines.map((entry) => entry.key).join(', ')}.`,
    );
  }
  return pipeline.id;
}

async function textOf(io: CliIo, path: string, limits: ImportLimits): Promise<string> {
  assertImportFileSize(await io.sizeOf(path), limits);
  return decodeImportBytes(await io.readBytes(path), limits);
}

function mappingOf(text: string): ImportMapping {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error('The mapping file is not valid JSON.');
  }
  const parsed = mappingFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `The mapping file must look like {"columns": {"Header": "person.name"}}. ${issue?.message ?? ''}`.trim(),
    );
  }
  return parsed.data.columns;
}

function summaryOf(report: ImportReport): string[] {
  const totals = report.totals;
  return [
    `${report.mode === 'preview' ? 'Dry run' : 'Imported'}: ${totals.rows} rows, ${totals.created} new, ${totals.merged} merged, ${totals.unchanged} unchanged, ${totals.skipped} skipped, ${totals.invalid} invalid, ${totals.companiesCreated} companies created, ${totals.leadsCreated} leads created, ${totals.leadsExisting} leads already in the pipeline.`,
    ...report.rows.flatMap((row) =>
      row.issues.map(
        (issue) =>
          `Row ${issue.row}${issue.column === null ? '' : ` (${issue.column})`}: ${issue.message}`,
      ),
    ),
    ...(report.failure === null
      ? []
      : [
          report.failure.row === null
            ? report.failure.message
            : `Stopped at row ${report.failure.row}: ${report.failure.message}`,
        ]),
  ];
}

function messageOf(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const where = issue === undefined || issue.path.length === 0 ? '' : `${issue.path.join('.')}: `;
    return `${where}${issue?.message ?? 'That input is invalid.'}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function runImportCli(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const args = parseCliArgs(argv);
    const organization = await getOrganizationBySlug(args.workspace);
    const [user] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, args.as))
      .limit(1);
    if (user === undefined) throw new Error(`No user has the email ${args.as}.`);
    const principal = await resolvePrincipal(user.id, organization.id);
    const content = await textOf(io, args.path, CLI_IMPORT_LIMITS);
    const pipelineId = await pipelineIdOf(principal, args);
    const mapping =
      args.mapping === undefined
        ? suggestMapping(
            parseImportTable(args.adapter, content, CLI_IMPORT_LIMITS).headers,
            args.target,
            await listFieldDefinitions(principal),
          )
        : mappingOf(await textOf(io, args.mapping, MAPPING_FILE_LIMITS));
    const request = {
      format: args.adapter,
      content,
      target: args.target,
      pipelineId,
      mapping,
      source: args.source ?? IMPORT_DEFAULT_SOURCE,
      defaultOwner: 'me',
      startRow: args.fromRow ?? 1,
    };
    const report = args.commit
      ? await commitImport({ principal }, request, {
          actorName: user.name,
          limits: CLI_IMPORT_LIMITS,
          publish: async (actions) => {
            await flushOutbox(actions.map((action) => action.syncId));
          },
        })
      : await previewImport(principal, request, { limits: CLI_IMPORT_LIMITS });
    for (const line of summaryOf(report)) io.print(line);
    if (report.resumeFromRow !== null) {
      io.print(`To continue, run it again with --from-row ${report.resumeFromRow}.`);
    }
    if (!args.commit) io.print('Nothing was written. Run again with --commit to import.');
    return report.status === 'completed' ? 0 : 1;
  } catch (error: unknown) {
    io.print(messageOf(error));
    return 1;
  }
}
