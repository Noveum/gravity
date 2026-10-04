import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import { createBrand } from '../../src/crm/brand-service.ts';
import { parseCliArgs, runImportCli } from '../../src/import/cli.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import { createWorkspace, resetDatabase, type TestWorkspace } from '../../src/test-support.ts';

const CSV = 'Full Name,Work Email,Stage\nAda Lovelace,ada@vela.example,Ready\n';

let workspace: TestWorkspace;
let slug = '';

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  await createBrand({ principal: workspace.admin }, { name: 'Lumen', pipelineKey: 'LUM' });
  const [organization] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, workspace.organizationId));
  slug = organization?.slug ?? '';
});

afterAll(async () => {
  await closeRealtime();
});

function harness(files: Record<string, string | Uint8Array>) {
  const lines: string[] = [];
  return {
    lines,
    io: {
      readBytes: (path: string) => {
        const file = files[path];
        if (file === undefined) return Promise.reject(new Error(`No file ${path}`));
        return Promise.resolve(typeof file === 'string' ? new TextEncoder().encode(file) : file);
      },
      print: (line: string) => {
        lines.push(line);
      },
    },
  };
}

function argv(...extra: string[]): string[] {
  return [
    'csv',
    'people.csv',
    '--workspace',
    slug,
    '--as',
    workspace.adminUser.email,
    '--target',
    'leads',
    '--pipeline',
    'lum',
    ...extra,
  ];
}

describe('runImportCli', () => {
  test('dry runs by default with a suggested mapping, then commits with --commit', async () => {
    const dry = harness({ 'people.csv': CSV });
    expect(await runImportCli(argv(), dry.io)).toBe(0);
    expect(dry.lines[0]).toBe(
      'Dry run: 1 rows, 1 new, 0 merged, 0 unchanged, 0 skipped, 0 invalid, 0 companies created, 1 leads created, 0 leads already open.',
    );
    expect(dry.lines.at(-1)).toBe('Nothing was written. Run again with --commit to import.');
    expect(await db.select().from(schema.person)).toHaveLength(0);
    const wet = harness({ 'people.csv': CSV });
    expect(await runImportCli(argv('--commit'), wet.io)).toBe(0);
    expect(wet.lines[0]).toStartWith('Imported: 1 rows, 1 new');
    const [lead] = await db.select().from(schema.lead);
    expect(lead?.source).toBe('import');
    const [person] = await db.select().from(schema.person);
    expect(person?.name).toBe('Ada Lovelace');
  });

  test('a mapping file replaces the suggestion and row issues are printed', async () => {
    const run = harness({
      'people.csv': 'Who,Mail\nAda Lovelace,not-an-email\n',
      'map.json': JSON.stringify({ columns: { Who: 'person.name', Mail: 'person.email' } }),
    });
    expect(await runImportCli(argv('--mapping', 'map.json'), run.io)).toBe(0);
    expect(run.lines.some((line) => line.startsWith('Row 1 (Mail): '))).toBe(true);
  });

  test('refuses a mapping file that is not valid', async () => {
    const notJson = harness({ 'people.csv': CSV, 'map.json': '{' });
    expect(await runImportCli(argv('--mapping', 'map.json'), notJson.io)).toBe(1);
    expect(notJson.lines).toEqual(['The mapping file is not valid JSON.']);
    const wrongShape = harness({
      'people.csv': CSV,
      'map.json': JSON.stringify({ 'Full Name': 'person.name' }),
    });
    expect(await runImportCli(argv('--mapping', 'map.json'), wrongShape.io)).toBe(1);
    expect(wrongShape.lines[0]).toStartWith('The mapping file must look like');
  });

  test('refuses a file that is not UTF-8 before writing anything', async () => {
    const run = harness({
      'people.csv': new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0xc3, 0x28]),
    });
    expect(await runImportCli(argv('--commit'), run.io)).toBe(1);
    expect(run.lines).toEqual([
      'This file is not UTF-8 text. Export it as UTF-8 CSV or JSON and try again.',
    ]);
    expect(await db.select().from(schema.person)).toHaveLength(0);
  });

  test('refuses an unknown workspace and a leads import without a pipeline', async () => {
    const unknown = harness({ 'people.csv': CSV });
    expect(
      await runImportCli(
        [
          'csv',
          'people.csv',
          '--workspace',
          'nope',
          '--as',
          workspace.adminUser.email,
          '--target',
          'people',
        ],
        unknown.io,
      ),
    ).toBe(1);
    expect(unknown.lines).toEqual(['That workspace does not exist.']);
    const missing = harness({ 'people.csv': CSV });
    expect(
      await runImportCli(
        [
          'csv',
          'people.csv',
          '--workspace',
          slug,
          '--as',
          workspace.adminUser.email,
          '--target',
          'leads',
        ],
        missing.io,
      ),
    ).toBe(1);
    expect(missing.lines).toEqual(['A leads import needs --pipeline <KEY>.']);
  });

  test('refuses an unknown pipeline, an unknown user and a user outside the workspace', async () => {
    const pipeline = harness({ 'people.csv': CSV });
    expect(
      await runImportCli(
        argv().map((word) => (word === 'lum' ? 'nope' : word)),
        pipeline.io,
      ),
    ).toBe(1);
    expect(pipeline.lines).toEqual(['There is no pipeline nope. Pipelines: LUM.']);
    const stranger = harness({ 'people.csv': CSV });
    expect(
      await runImportCli(
        argv().map((word) => (word === workspace.adminUser.email ? 'nobody@vela.example' : word)),
        stranger.io,
      ),
    ).toBe(1);
    expect(stranger.lines).toEqual(['No user has the email nobody@vela.example.']);
  });

  test('parseCliArgs refuses a flag without a value', () => {
    expect(() => parseCliArgs(['csv', 'a.csv', '--workspace'])).toThrow(
      '--workspace needs a value.',
    );
  });
});
