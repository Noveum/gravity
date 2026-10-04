import { z } from 'zod';
import { idSchema } from '../validators/common.ts';
import {
  IMPORT_DEFAULT_OWNERS,
  IMPORT_FORMATS,
  IMPORT_TARGETS,
  MAX_CLI_IMPORT_ROWS,
} from './constants.ts';
import { importMappingSchema } from './mapping.ts';

export const IMPORT_SOURCE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
export const IMPORT_DEFAULT_SOURCE = 'import';
export const IMPORT_SOURCE_NAME_NEEDED =
  'Name the source of these ids, such as hubspot or crm-2026, so they never match ids from another file.';

export const importRequestSchema = z
  .object({
    format: z.enum(IMPORT_FORMATS),
    content: z.string().min(1, 'Choose a file to import.'),
    target: z.enum(IMPORT_TARGETS),
    pipelineId: idSchema.nullable().default(null),
    mapping: importMappingSchema,
    source: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        IMPORT_SOURCE_PATTERN,
        'Name the source with lowercase letters, digits, dots, colons or dashes.',
      )
      .default(IMPORT_DEFAULT_SOURCE),
    defaultOwner: z.enum(IMPORT_DEFAULT_OWNERS).default('me'),
    startRow: z.number().int().min(1).max(MAX_CLI_IMPORT_ROWS).default(1),
    rowLimit: z.number().int().min(1).max(MAX_CLI_IMPORT_ROWS).nullable().default(null),
  })
  .superRefine((value, ctx) => {
    const mapsSourceId = Object.values(value.mapping).some((column) => column === 'sourceId');
    if (mapsSourceId && value.source === IMPORT_DEFAULT_SOURCE) {
      ctx.addIssue({ code: 'custom', path: ['source'], message: IMPORT_SOURCE_NAME_NEEDED });
    }
    if (value.target === 'leads' && value.pipelineId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['pipelineId'],
        message: 'Choose the pipeline the leads go into.',
      });
    }
    if (value.target !== 'leads' && value.pipelineId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['pipelineId'],
        message: 'Only a leads import takes a pipeline.',
      });
    }
  });

export type ImportRequest = z.infer<typeof importRequestSchema>;
