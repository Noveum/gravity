import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { db, eq, schema, sql } from '@gravity/db';
import { CLI_IMPORT_LIMITS } from '@gravity/shared/import';
import { createBrand } from '../../src/crm/brand-service.ts';
import { parseCliArgs, runImportCli } from '../../src/import/cli.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import {
  createMemberPrincipal,
  createWorkspace,
  resetDatabase,
  type TestWorkspace,
} from '../../src/test-support.ts';

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

function harness(files: Record<string, string | Uint8Array>, sizes: Record<string, number> = {}) {
  const lines: string[] = [];
  const reads: string[] = [];
  const bytesOf = (file: string | Uint8Array): Uint8Array =>
    typeof file === 'string' ? new TextEncoder().encode(file) : file;
  return {
    lines,
    reads,
    io: {
      sizeOf: (path: string) => {
        const file = files[path];
        if (file === undefined) return Promise.reject(new Error(`No file ${path}`));
        return Promise.resolve(sizes[path] ?? bytesOf(file).byteLength);
      },
      readBytes: (path: string) => {
        reads.push(path);
        const file = files[path];
        if (file === undefined) return Promise.reject(new Error(`No file ${path}`));
        return Promise.resolve(bytesOf(file));
      },
      print: (line: string) => {
        lines.push(line);
      },
    },
  };
}

async function withFailingTrigger<T>(
  table: string,
  condition: string,
  run: () => Promise<T>,
): Promise<T> {
  await db.execute(
    sql.raw(`
      create or replace function cli_test_refuse() returns trigger as $$
      begin
        if ${condition} then raise exception 'refused by test trigger'; end if;
        return new;
      end;
      $$ language plpgsql;
      create trigger cli_test_refuse before insert on ${table}
        for each row execute function cli_test_refuse();
    `),
  );
  try {
    return await run();
  } finally {
    await db.execute(
      sql.raw(`
        drop trigger if exists cli_test_refuse on ${table};
        drop function if exists cli_test_refuse();
      `),
    );
  }
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
      'Dry run: 1 rows, 1 new, 0 merged, 0 unchanged, 0 skipped, 0 invalid, 0 companies created, 1 leads created, 0 leads already in the pipeline.',
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

  test('stats the data file and refuses an oversized one without reading it', async () => {
    const run = harness({ 'people.csv': CSV }, { 'people.csv': CLI_IMPORT_LIMITS.maxBytes + 1 });
    expect(await runImportCli(argv('--commit'), run.io)).toBe(1);
    expect(run.reads).toEqual([]);
    expect(run.lines).toEqual(['This file is 50.0 MB. Import files up to 50.0 MB, or split it.']);
    expect(await db.select().from(schema.person)).toHaveLength(0);
  });

  test('stats the mapping file and refuses an oversized one without reading it', async () => {
    const run = harness(
      { 'people.csv': CSV, 'map.json': JSON.stringify({ columns: {} }) },
      { 'map.json': 5_000_000 },
    );
    expect(await runImportCli(argv('--mapping', 'map.json'), run.io)).toBe(1);
    expect(run.reads).toEqual(['people.csv']);
    expect(run.lines).toEqual(['This file is 5.0 MB. Import files up to 1.0 MB, or split it.']);
  });

  test('refuses a user outside the workspace', async () => {
    const outsider = await createWorkspace('Other');
    const run = harness({ 'people.csv': CSV });
    const words = argv('--commit').map((word) =>
      word === workspace.adminUser.email ? outsider.adminUser.email : word,
    );
    expect(await runImportCli(words, run.io)).toBe(1);
    expect(run.lines).toEqual(['You are not a member of this workspace.']);
    expect(await db.select().from(schema.person)).toHaveLength(0);
  });

  test('refuses a contributor, on a dry run and on --commit', async () => {
    const contributor = await createMemberPrincipal(workspace, 'contributor');
    const [user] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, contributor.userId));
    const email = user?.email ?? '';
    for (const flags of [[], ['--commit']]) {
      const run = harness({ 'people.csv': CSV });
      const words = argv(...flags).map((word) =>
        word === workspace.adminUser.email ? email : word,
      );
      expect(await runImportCli(words, run.io)).toBe(1);
      expect(run.lines).toHaveLength(1);
      expect(run.lines[0]).toBe('Your role cannot import run.');
    }
    expect(await db.select().from(schema.person)).toHaveLength(0);
  });

  test('a failing row is named and the exit code is 1', async () => {
    const quiet = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const run = harness({
        'people.csv':
          'Full Name,Work Email\nAda Lovelace,ada@vela.example\nGrace Hopper,grace@vela.example\n',
      });
      const code = await withFailingTrigger('person', `new.name = 'Grace Hopper'`, () =>
        runImportCli(argv('--commit'), run.io),
      );
      expect(code).toBe(1);
      expect(run.lines.at(-1)).toStartWith('Stopped at row 2: ');
      expect(run.lines.at(-1)).toContain('Fix row 2 and run the same file again to continue.');
    } finally {
      quiet.mockRestore();
    }
  });

  test('a failure that blames no row prints its message alone and exits 1', async () => {
    const quiet = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const run = harness({ 'people.csv': CSV });
      const code = await withFailingTrigger('outbox', 'true', () =>
        runImportCli(argv('--commit'), run.io),
      );
      expect(code).toBe(1);
      expect(run.lines.at(-1)).toStartWith('Something went wrong on our side.');
      expect(run.lines.at(-1)).toEndWith('Run the same file again to continue.');
      expect(run.lines.some((line) => line.startsWith('Stopped at row'))).toBe(false);
    } finally {
      quiet.mockRestore();
    }
  });

  test('parseCliArgs refuses a flag without a value', () => {
    expect(() => parseCliArgs(['csv', 'a.csv', '--workspace'])).toThrow(
      '--workspace needs a value.',
    );
  });
});
