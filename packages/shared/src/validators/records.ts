import { z } from 'zod';
import { LEAD_PRIORITIES, MAX_BULK_LEADS, OWED_BY } from '../constants/crm.ts';
import { normalizeLinkedinProfileUrl } from '../utils/identity.ts';
import { calendarDateSchema, emailSchema, idSchema } from './common.ts';
import { domainSchema } from './configuration.ts';

const datetimeSchema = z.string().datetime({ offset: true });
const fieldsInputSchema = z.record(z.string(), z.unknown());
const recordNameSchema = z.string().trim().min(1, 'Give it a name.').max(200);

function optionalText(max: number) {
  return z.string().trim().max(max).nullable();
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export const linkedinUrlSchema = z
  .string()
  .trim()
  .max(500)
  .transform((value, ctx) => {
    const url = normalizeLinkedinProfileUrl(value);
    if (url === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Use a LinkedIn profile URL like https://www.linkedin.com/in/ada.',
      });
      return z.NEVER;
    }
    return url;
  });

export const timezoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine(isTimeZone, 'Use an IANA time zone like Europe/London.');

export const companyInputSchema = z.object({
  name: recordNameSchema,
  domains: z.array(domainSchema).max(20).default([]).transform(distinct),
  size: optionalText(40).default(null),
  segment: optionalText(80).default(null),
  location: optionalText(120).default(null),
  fields: fieldsInputSchema.default({}),
});
export type CompanyInput = z.infer<typeof companyInputSchema>;

export const companyPatchSchema = z
  .object({
    name: recordNameSchema.optional(),
    domains: z.array(domainSchema).max(20).transform(distinct).optional(),
    size: optionalText(40).optional(),
    segment: optionalText(80).optional(),
    location: optionalText(120).optional(),
    fields: fieldsInputSchema.optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    'Change at least one property.',
  );

export const companyRefSchema = z.union([
  z.object({ id: idSchema }),
  z.object({ domain: domainSchema, name: recordNameSchema.optional() }),
  z.object({ name: recordNameSchema }),
]);
export type CompanyRef = z.infer<typeof companyRefSchema>;

export const personInputSchema = z.object({
  name: recordNameSchema,
  emails: z.array(emailSchema).max(20).default([]).transform(distinct),
  phones: z.array(z.string().trim().min(3).max(40)).max(10).default([]).transform(distinct),
  linkedinUrl: linkedinUrlSchema.nullable().default(null),
  linkedinProviderId: z.string().trim().min(1).max(128).nullable().default(null),
  location: optionalText(120).default(null),
  timezone: timezoneSchema.nullable().default(null),
  doNotContact: z.boolean().default(false),
  fields: fieldsInputSchema.default({}),
  company: companyRefSchema.nullable().default(null),
  title: optionalText(120).default(null),
});
export type PersonInput = z.infer<typeof personInputSchema>;

export const personPatchSchema = z
  .object({
    name: recordNameSchema.optional(),
    emails: z.array(emailSchema).max(20).transform(distinct).optional(),
    phones: z.array(z.string().trim().min(3).max(40)).max(10).transform(distinct).optional(),
    linkedinUrl: linkedinUrlSchema.nullable().optional(),
    location: optionalText(120).optional(),
    timezone: timezoneSchema.nullable().optional(),
    doNotContact: z.boolean().optional(),
    fields: fieldsInputSchema.optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    'Change at least one property.',
  );

export const employmentInputSchema = z.object({
  personId: idSchema,
  companyId: idSchema,
  title: optionalText(120).default(null),
  startedAt: calendarDateSchema.nullable().default(null),
  isCurrent: z.boolean().default(true),
});
export type EmploymentInput = z.infer<typeof employmentInputSchema>;

export const leadPatchSchema = z
  .strictObject({
    stageId: idSchema.optional(),
    ownerId: idSchema.nullable().optional(),
    priority: z
      .number()
      .int()
      .refine(
        (value) => LEAD_PRIORITIES.some((entry) => entry === value),
        'Use a priority from 0 to 4.',
      )
      .optional(),
    nextAction: optionalText(280).optional(),
    nextActionAt: datetimeSchema.nullable().optional(),
    holdReason: z.string().trim().min(1).max(500).nullable().optional(),
    holdUntil: datetimeSchema.nullable().optional(),
    owedBy: z.enum(OWED_BY).optional(),
    fields: fieldsInputSchema.optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    'Change at least one property.',
  );
export type LeadPatch = z.infer<typeof leadPatchSchema>;

export const leadChangeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('update'), patch: leadPatchSchema }),
  z.object({
    type: z.literal('hold'),
    reason: z.string().trim().min(1, 'Say why it is on hold.').max(500),
    until: datetimeSchema.nullable().default(null),
  }),
  z.object({ type: z.literal('close'), stageId: idSchema.optional() }),
]);
export type LeadChange = z.infer<typeof leadChangeSchema>;

export const leadCreateSchema = z.object({
  id: z.uuid().optional(),
  personId: idSchema,
  pipelineId: idSchema,
  stageId: idSchema.optional(),
  ownerId: idSchema.nullable().optional(),
  priority: z.number().int().min(0).max(4).default(0),
  source: z.string().trim().min(1).max(64).default('manual'),
  nextAction: optionalText(280).default(null),
  nextActionAt: datetimeSchema.nullable().default(null),
  fields: fieldsInputSchema.default({}),
});
export type LeadCreate = z.infer<typeof leadCreateSchema>;

export const leadBulkSchema = z.object({
  leadIds: z
    .array(idSchema)
    .min(1)
    .max(MAX_BULK_LEADS)
    .refine((ids) => new Set(ids).size === ids.length, 'Each lead appears once.'),
  change: leadChangeSchema,
});

export const quickCreateSchema = z.object({
  leadId: z.uuid().optional(),
  person: personInputSchema,
  pipelineId: idSchema,
  ownerId: idSchema.nullable().optional(),
});
export type QuickCreate = z.infer<typeof quickCreateSchema>;
