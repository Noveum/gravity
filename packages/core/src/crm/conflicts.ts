import { conflict } from '@gravity/shared/errors';
import { uniqueViolationOf } from '../internal.ts';

const CONFLICT_MESSAGES: Readonly<Record<string, string>> = {
  brand_org_name_unique: 'A brand with that name already exists.',
  pipeline_org_key_unique: 'Another pipeline already uses that key.',
  field_definition_key_unique: 'A custom field with that key already exists here.',
  company_org_primary_domain_unique: 'Another company already uses that domain.',
  person_org_primary_email_unique: 'Another person already uses that email.',
  person_org_linkedin_provider_unique: 'Another person already has that LinkedIn account.',
  lead_open_person_pipeline_unique: 'This person already has an open lead in this pipeline.',
  lead_pipeline_number_unique: 'Two leads were numbered at the same moment. Try again.',
  employment_current_unique: 'This person already works at that company.',
};

export function violatedConstraint(error: unknown): string | null {
  const violation = uniqueViolationOf(error);
  const constraint = violation?.['constraint_name'];
  return typeof constraint === 'string' ? constraint : null;
}

export function asConflict(error: unknown): unknown {
  const constraint = violatedConstraint(error);
  if (constraint === null) return error;
  const message = CONFLICT_MESSAGES[constraint];
  if (message === undefined) return error;
  return conflict(message, { cause: error, details: { constraint } });
}
