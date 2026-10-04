import { z } from 'zod';
import { idSchema } from '../validators/common.ts';
import { IMPORT_DEFAULT_OWNERS, IMPORT_FORMATS, IMPORT_TARGETS } from './constants.ts';
import { importMappingSchema } from './mapping.ts';

export const IMPORT_SOURCE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

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
      .default('import'),
    defaultOwner: z.enum(IMPORT_DEFAULT_OWNERS).default('me'),
  })
  .superRefine((value, ctx) => {
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
