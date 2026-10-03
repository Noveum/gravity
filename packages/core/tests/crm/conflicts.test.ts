import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, schema } from '@gravity/db';
import { DomainError } from '@gravity/shared/errors';
import { asConflict, violatedConstraint } from '../../src/crm/conflicts.ts';
import { newId } from '../../src/internal.ts';
import { createWorkspace, resetDatabase } from '../../src/test-support.ts';

function uniqueViolation(constraint: string | undefined): Error {
  return Object.assign(new Error('duplicate key'), {
    code: '23505',
    ...(constraint === undefined ? {} : { constraint_name: constraint }),
  });
}

describe('violatedConstraint', () => {
  test('reads the constraint name through a wrapped cause', () => {
    const wrapped = new Error('query failed', { cause: uniqueViolation('brand_org_name_unique') });
    expect(violatedConstraint(wrapped)).toBe('brand_org_name_unique');
  });

  test('is null for anything that is not a unique violation', () => {
    expect(violatedConstraint(new Error('boom'))).toBeNull();
    expect(violatedConstraint(null)).toBeNull();
    expect(violatedConstraint(uniqueViolation(undefined))).toBeNull();
    expect(
      violatedConstraint(Object.assign(new Error('fk'), { code: '23503', constraint_name: 'x' })),
    ).toBeNull();
  });
});

describe('asConflict', () => {
  test.each([
    'brand_org_name_unique',
    'pipeline_org_key_unique',
    'field_definition_key_unique',
    'company_org_primary_domain_unique',
    'person_org_primary_email_unique',
    'person_org_linkedin_provider_unique',
    'lead_open_person_pipeline_unique',
    'lead_pipeline_number_unique',
    'employment_current_unique',
    'lead_pkey',
    'saved_view_pkey',
  ])('maps %s to a 409 naming the constraint', (constraint) => {
    const original = uniqueViolation(constraint);
    const mapped = asConflict(original);
    expect(mapped).toBeInstanceOf(DomainError);
    expect(mapped instanceof DomainError && mapped.status).toBe(409);
    expect(mapped instanceof DomainError && mapped.details).toEqual({ constraint });
    expect(mapped instanceof DomainError && mapped.cause).toBe(original);
  });

  test.each(['lead_pkey', 'saved_view_pkey'])(
    'says a taken id is already in use for %s',
    (constraint) => {
      const mapped = asConflict(uniqueViolation(constraint));
      expect(mapped instanceof DomainError && mapped.message).toBe('That id is already in use.');
    },
  );

  test('leaves an unmapped constraint and other errors untouched', () => {
    const unknown = uniqueViolation('something_else_unique');
    expect(asConflict(unknown)).toBe(unknown);
    const other = new Error('boom');
    expect(asConflict(other)).toBe(other);
  });
});

describe('a real unique violation', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
  });

  test('surfaces its constraint through the driver wrapper and maps to a 409', async () => {
    const workspace = await createWorkspace();
    const insert = () =>
      db.insert(schema.brand).values({
        id: newId(),
        organizationId: workspace.organizationId,
        name: 'Lumen',
        syncId: 1,
      });
    await insert();
    const failure = await insert().then(
      () => null,
      (error: unknown) => error,
    );
    expect(violatedConstraint(failure)).toBe('brand_org_name_unique');
    const mapped = asConflict(failure);
    expect(mapped instanceof DomainError && mapped.status).toBe(409);
  });
});
