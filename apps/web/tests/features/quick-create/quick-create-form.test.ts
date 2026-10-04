import { describe, expect, test } from 'bun:test';
import { buildQuickCreate } from '@/features/quick-create/quick-create-form.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';

const bootstrap = bootstrapFixture();
const pipeline = bootstrap.pipelines[0];
if (pipeline === undefined) throw new Error('fixture pipeline');
const context = {
  leadId: '0192f0a0-0000-7000-8000-000000000001',
  pipeline,
  stages: bootstrap.stages,
  organizationId: 'o1',
  now: new Date('2026-10-03T10:00:00.000Z'),
};

const blank = {
  identity: '',
  name: '',
  companyName: '',
  companyDomain: '',
  pipelineId: 'p1',
  ownerId: null,
};

describe('buildQuickCreate', () => {
  test('an email fills the person and the company comes from its domain', () => {
    const built = buildQuickCreate(
      {
        identity: 'Grace@Navy.mil',
        name: 'Grace Hopper',
        companyName: '',
        companyDomain: 'navy.mil',
        pipelineId: 'p1',
        ownerId: 'u1',
      },
      context,
    );
    if ('error' in built) throw new Error(built.error);
    expect(built.body).toEqual({
      leadId: context.leadId,
      pipelineId: 'p1',
      ownerId: 'u1',
      person: {
        name: 'Grace Hopper',
        emails: ['grace@navy.mil'],
        linkedinUrl: null,
        company: { domain: 'navy.mil' },
      },
    });
    expect(built.preview).toMatchObject({
      id: context.leadId,
      key: 'YOD-new',
      stageId: 'new',
      personName: 'Grace Hopper',
      companyName: 'navy.mil',
      syncId: 0,
    });
  });

  test('a bare name works and an email without a name uses its local part', () => {
    const named = buildQuickCreate(
      { ...blank, identity: 'Linus Torvalds', companyName: 'Initech' },
      context,
    );
    if ('error' in named) throw new Error(named.error);
    expect(named.body.person).toEqual({
      name: 'Linus Torvalds',
      emails: [],
      linkedinUrl: null,
      company: { name: 'Initech' },
    });
    const local = buildQuickCreate({ ...blank, identity: 'ada@acme.io' }, context);
    if ('error' in local) throw new Error(local.error);
    expect(local.body.person.name).toBe('ada');
  });

  test('a LinkedIn URL fills the profile and the name falls back to its slug', () => {
    const built = buildQuickCreate(
      { ...blank, identity: 'linkedin.com/in/Grace-Hopper', ownerId: 'u2' },
      context,
    );
    if ('error' in built) throw new Error(built.error);
    expect(built.body.person).toMatchObject({
      name: 'grace-hopper',
      linkedinUrl: 'https://www.linkedin.com/in/grace-hopper',
      emails: [],
    });
    expect(built.preview).toMatchObject({
      personLinkedinUrl: 'https://www.linkedin.com/in/grace-hopper',
      ownerId: 'u2',
    });
  });

  test('the preview carries a pending person id that never collides with a real one', () => {
    const built = buildQuickCreate({ ...blank, identity: 'Ada Lovelace' }, context);
    if ('error' in built) throw new Error(built.error);
    expect(built.preview.personId).toBe(`pending-${context.leadId}`);
    expect(built.preview.number).toBe(0);
    expect(built.preview.stageCategory).toBe('open');
  });

  test('refuses an empty draft', () => {
    expect(buildQuickCreate({ ...blank, identity: ' ' }, context)).toEqual({
      error: 'Add a name, an email or a LinkedIn URL.',
    });
  });

  test('refuses a company domain that is not a domain before anything is sent', () => {
    const built = buildQuickCreate(
      { ...blank, identity: 'Ada Lovelace', companyDomain: 'not a domain' },
      context,
    );
    expect(built).toEqual({ error: 'Enter the company domain like acme.com.' });
  });

  test('refuses a pipeline that has no open stage', () => {
    const closedOnly = bootstrap.stages.map((stage) => ({ ...stage, category: 'won' as const }));
    expect(
      buildQuickCreate({ ...blank, identity: 'Ada Lovelace' }, { ...context, stages: closedOnly }),
    ).toEqual({ error: 'This pipeline has no open stage. Add one in Settings.' });
  });

  test('refuses a body the schema rejects with its first issue and builds no preview', () => {
    const built = buildQuickCreate({ ...blank, identity: 'N'.repeat(400) }, context);
    expect('error' in built).toBe(true);
    if ('error' in built) expect(built.error.length).toBeGreaterThan(0);
  });
});
