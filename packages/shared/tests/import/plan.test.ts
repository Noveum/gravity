import { describe, expect, test } from 'bun:test';
import { HTTP_IMPORT_LIMITS } from '../../src/import/constants.ts';
import type { ImportMapping } from '../../src/import/mapping.ts';
import { type ImportSetup, planImport } from '../../src/import/plan.ts';
import { parseCsv } from '../../src/import/table.ts';

const setup: ImportSetup = {
  target: 'leads',
  pipelineId: 'p1',
  stages: [
    { id: 's-new', name: 'New', category: 'open' },
    { id: 's-ready', name: 'Ready', category: 'open' },
    { id: 's-hold', name: 'On hold', category: 'hold' },
    { id: 's-lost', name: 'Closed: no reply', category: 'lost' },
  ],
  members: [
    { userId: 'u1', name: 'Ada Admin', email: 'ada@acme.test' },
    { userId: 'u3', name: 'Sam Twin', email: 'sam1@acme.test' },
    { userId: 'u4', name: 'Sam Twin', email: 'sam2@acme.test' },
  ],
  fields: {
    person: [{ key: 'seniority', type: 'select', options: [{ value: 'senior', label: 'Senior' }] }],
    company: [],
    lead: [],
  },
  defaultOwnerId: 'u2',
};

const MAPPING: ImportMapping = {
  First: 'person.firstName',
  Last: 'person.lastName',
  Email: 'person.email',
  LinkedIn: 'person.linkedinUrl',
  Company: 'company.name',
  Domain: 'company.domain',
  Title: 'person.title',
  Stage: 'lead.stage',
  Owner: 'lead.owner',
  Priority: 'lead.priority',
  Next: 'lead.nextActionAt',
  Seniority: 'person.field.seniority',
};

function plan(csv: string, target: ImportSetup['target'] = 'leads') {
  return planImport(parseCsv(csv, HTTP_IMPORT_LIMITS), MAPPING, { ...setup, target });
}

const HEADER =
  'First,Last,Email,LinkedIn,Company,Domain,Title,Stage,Owner,Priority,Next,Seniority\n';

describe('planImport', () => {
  test('plans a person, the company and the lead of a clean row', () => {
    const [row] = plan(
      `${HEADER}Ada,Lovelace,ADA@Vela.example,linkedin.com/in/Ada,Vela Robotics,www.vela.example,CTO,ready,ADA@acme.test,high,2031-03-04,Senior\n`,
    );
    expect(row?.issues).toEqual([]);
    expect(row?.label).toBe('Ada Lovelace');
    expect(row?.person).toMatchObject({
      name: 'Ada Lovelace',
      emails: ['ada@vela.example'],
      linkedinUrl: 'https://www.linkedin.com/in/ada',
      title: 'CTO',
      company: { domain: 'vela.example', name: 'Vela Robotics' },
      fields: { seniority: 'senior' },
    });
    expect(row?.company).toMatchObject({ name: 'Vela Robotics', domains: ['vela.example'] });
    expect(row?.lead).toEqual({
      stageId: 's-ready',
      stageCategory: 'open',
      ownerId: 'u1',
      priority: 2,
      nextAction: null,
      nextActionAt: '2031-03-04T00:00:00.000Z',
      fields: {},
    });
  });

  test('uses the default owner and the first open stage when the columns are empty', () => {
    const [row] = plan(`${HEADER}Grace,Hopper,grace@quarry.example,,,,,,,,,\n`);
    expect(row?.lead).toMatchObject({ stageId: undefined, ownerId: 'u2', priority: 0 });
  });

  test('reports each bad value with its column and blocks the row', () => {
    const [row] = plan(
      `${HEADER},,not-an-email,,,,,Limbo,nobody@acme.test,sometimes,someday,Principal\n`,
    );
    expect(row?.person).toBeNull();
    expect(row?.issues.map((issue) => [issue.column, issue.message])).toEqual([
      [null, 'This row has no name.'],
      ['Seniority', 'Pick one of: senior.'],
      ['Stage', 'There is no stage called Limbo. Stages: New, Ready, Closed: no reply.'],
      ['Owner', "No member matches nobody@acme.test. Use a member's email."],
      ['Priority', 'Use a priority from 0 to 4 or a label such as Urgent or Low, not sometimes.'],
      ['Next', 'Use a date like 2031-03-04, not someday.'],
    ]);
  });

  test('refuses a hold stage as a starting stage', () => {
    const [row] = plan(`${HEADER}Ada,L,a@v.example,,,,,On hold,,,,\n`);
    expect(row?.issues.map((issue) => issue.message)).toEqual([
      'Leads cannot start in On hold. Import them into an open stage, then put them on hold with a reason.',
    ]);
  });

  test('matches an owner by email, and refuses a name two members share', () => {
    const rows = plan(
      `${HEADER}A,A,a@v.example,,,,,,sam2@acme.test,,,\nB,B,b@v.example,,,,,,Sam Twin,,,\nC,C,c@v.example,,,,,,ada admin,,,\n`,
    );
    expect(rows[0]?.lead?.ownerId).toBe('u4');
    expect(rows[1]?.issues.map((issue) => issue.message)).toEqual([
      "Several members are called Sam Twin. Use a member's email.",
    ]);
    expect(rows[2]?.lead?.ownerId).toBe('u1');
  });

  test('reads a priority only as a digit or a label', () => {
    const rows = plan(
      `${HEADER}A,A,a@v.example,,,,,,,1,,\nB,B,b@v.example,,,,,,,urgent,,\nC,C,c@v.example,,,,,,,0x1,,\nD,D,d@v.example,,,,,,,1e0,,\nE,E,e@v.example,,,,,,,5,,\n`,
    );
    expect(rows.map((row) => row.lead?.priority)).toEqual([1, 1, 0, 0, 0]);
    expect(rows.map((row) => row.issues.length)).toEqual([0, 0, 1, 1, 1]);
  });

  test('reads dates as ISO text only so the browser and the server agree', () => {
    const rows = plan(
      `${HEADER}A,A,a@v.example,,,,,,,,2031-03-04T10:00:00+02:00,\nB,B,b@v.example,,,,,,,,03/04/2031,\nC,C,c@v.example,,,,,,,,2031-02-30,\n`,
    );
    expect(rows[0]?.lead?.nextActionAt).toBe('2031-03-04T08:00:00.000Z');
    expect(rows.slice(1).map((row) => row.issues[0]?.message)).toEqual([
      'Use a date like 2031-03-04, not 03/04/2031.',
      'Use a date like 2031-03-04, not 2031-02-30.',
    ]);
  });

  test('marks a later row with an earlier identity as a duplicate but never name-only rows', () => {
    const rows = plan(
      `${HEADER}Ada,L,ada@vela.example,,,,,,,,,\nAda,Again,ADA@vela.example,,,,,,,,,\nNo,Email,,,,,,,,,,\nNo,Email,,,,,,,,,,\n`,
    );
    expect(rows.map((row) => row.duplicateOf)).toEqual([null, 1, null, null]);
  });

  test('matches on any email, the LinkedIn URL in its normal form and the provider id', () => {
    const table = parseCsv(
      'Name,Email,LinkedIn,Provider\nA,a@x.example,linkedin.com/in/Ada,P1\nB,b@x.example;a@x.example,,\nC,,https://uk.linkedin.com/in/ADA/,\nD,,,P1\nE,,,p1\n',
      HTTP_IMPORT_LIMITS,
    );
    const rows = planImport(
      table,
      {
        Name: 'person.name',
        Email: 'person.email',
        LinkedIn: 'person.linkedinUrl',
        Provider: 'person.linkedinProviderId',
      },
      { ...setup, target: 'people' },
    );
    expect(rows.map((row) => row.duplicateOf)).toEqual([null, 1, 1, 1, null]);
  });

  test('applies the dedupe order source id, provider id, email, LinkedIn URL', () => {
    const table = parseCsv(
      [
        'Name,Id,Provider,Email,LinkedIn',
        'R1,s1,p1,e1@x.example,linkedin.com/in/one',
        'R2,s2,p2,e2@x.example,linkedin.com/in/two',
        'R3,s2,p1,e1@x.example,linkedin.com/in/one',
        'R4,,p2,e1@x.example,linkedin.com/in/one',
        'R5,,,e2@x.example,linkedin.com/in/one',
        'R6,,,,linkedin.com/in/two',
        '',
      ].join('\n'),
      HTTP_IMPORT_LIMITS,
    );
    const rows = planImport(
      table,
      {
        Name: 'person.name',
        Id: 'sourceId',
        Provider: 'person.linkedinProviderId',
        Email: 'person.email',
        LinkedIn: 'person.linkedinUrl',
      },
      { ...setup, target: 'people' },
    );
    expect(rows.map((row) => row.duplicateOf)).toEqual([null, null, 2, 2, 2, 2]);
    const swapped = planImport(
      parseCsv(
        'Name,Id,Provider,Email\nR1,s1,p1,e1@x.example\nR2,s2,p2,e2@x.example\nR3,,p2,e1@x.example\nR4,,,e2@x.example\n',
        HTTP_IMPORT_LIMITS,
      ),
      {
        Name: 'person.name',
        Id: 'sourceId',
        Provider: 'person.linkedinProviderId',
        Email: 'person.email',
      },
      { ...setup, target: 'people' },
    );
    expect(swapped.map((row) => row.duplicateOf)).toEqual([null, null, 2, 2]);
  });

  test('a row with a problem or a duplicate never claims an identity for later rows', () => {
    const table = parseCsv(
      'Name,Email,Priority\nA,a@x.example,\nB,b@x.example,nope\nC,b@x.example,\nD,a@x.example;c@x.example,\nE,c@x.example,\n',
      HTTP_IMPORT_LIMITS,
    );
    const rows = planImport(
      table,
      { Name: 'person.name', Email: 'person.email', Priority: 'lead.priority' },
      setup,
    );
    expect(rows.map((row) => row.duplicateOf)).toEqual([null, null, null, 1, null]);
  });

  test('flags cells beyond the header', () => {
    const [row] = plan(`${HEADER}Ada,L,a@v.example,,,,,,,,,,surprise\n`);
    expect(row?.issues[0]?.message).toBe('This row has 13 cells but the header has 12.');
  });

  test('plans companies on their own and dedupes them by domain', () => {
    const rows = planImport(
      parseCsv(
        'Name,Domain,Size\nVela,vela.example,50\nVela Robotics,https://vela.example,\nQuarry,,\n',
        HTTP_IMPORT_LIMITS,
      ),
      { Name: 'company.name', Domain: 'company.domain', Size: 'company.size' },
      { ...setup, target: 'companies' },
    );
    expect(rows.map((row) => [row.company?.name, row.company?.domains, row.duplicateOf])).toEqual([
      ['Vela', ['vela.example'], null],
      ['Vela Robotics', ['vela.example'], 1],
      ['Quarry', [], null],
    ]);
  });

  test('a company without a domain matches an earlier company by name, as the database does', () => {
    const rows = planImport(
      parseCsv(
        'Name,Domain\nVela,vela.example\nVELA,\nQuarry,quarry.example\nQuarry,other.example\n',
        HTTP_IMPORT_LIMITS,
      ),
      { Name: 'company.name', Domain: 'company.domain' },
      { ...setup, target: 'companies' },
    );
    expect(rows.map((row) => row.duplicateOf)).toEqual([null, 1, null, null]);
  });

  test('a company row needs a name or a domain', () => {
    const [row] = planImport(
      parseCsv('Size\n50\n', HTTP_IMPORT_LIMITS),
      { Size: 'company.size' },
      { ...setup, target: 'companies' },
    );
    expect(row?.issues.map((issue) => issue.message)).toEqual([
      'This row has no company name or domain.',
    ]);
  });

  test('imports a formula looking cell as plain text', () => {
    const [row] = planImport(
      parseCsv('Name,Phone,Title\n=cmd|calc,+15551234567,@SUM(A1)\n', HTTP_IMPORT_LIMITS),
      { Name: 'person.name', Phone: 'person.phone', Title: 'person.title' },
      { ...setup, target: 'people' },
    );
    expect(row?.issues).toEqual([]);
    expect(row?.person).toMatchObject({
      name: '=cmd|calc',
      phones: ['+15551234567'],
      title: '@SUM(A1)',
    });
  });

  test('a header named like an object prototype key is not a mapped column', () => {
    const rows = planImport(
      parseCsv('Name,constructor,__proto__,toString\nAda,x,y,z\n', HTTP_IMPORT_LIMITS),
      { Name: 'person.name' },
      { ...setup, target: 'people' },
    );
    expect(rows[0]?.issues).toEqual([]);
    expect(rows[0]?.person).toMatchObject({ name: 'Ada' });
  });

  test('plans a thousand rows and finds every repeat among them', () => {
    const lines = ['Name,Email'];
    for (let index = 0; index < 1000; index += 1) lines.push(`P${index},p${index % 500}@x.example`);
    const rows = planImport(
      parseCsv(`${lines.join('\n')}\n`, HTTP_IMPORT_LIMITS),
      { Name: 'person.name', Email: 'person.email' },
      { ...setup, target: 'people' },
    );
    expect(rows).toHaveLength(1000);
    expect(rows.filter((row) => row.duplicateOf === null)).toHaveLength(500);
    expect(rows[999]?.duplicateOf).toBe(500);
  });
});
