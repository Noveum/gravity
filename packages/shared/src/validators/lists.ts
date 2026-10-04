import { z } from 'zod';
import {
  ACTIVITY_ENTITY_TYPES,
  clampContextTokens,
  LEAD_PAGE_SIZE,
  RECORD_PAGE_SIZE,
  SEARCH_RESULT_LIMIT,
  TIMELINE_FILTERS,
} from '../constants/crm.ts';
import { filterGroupQuerySchema } from '../filters/codec.ts';
import { emailSchema, idSchema } from './common.ts';

export const CURSOR_MAX_LENGTH = 2048;
const searchTermSchema = z.string().trim().max(200).default('');
const cursorSchema = z.string().max(CURSOR_MAX_LENGTH).optional();

export const leadListQuerySchema = z.object({
  pipelineId: idSchema,
  filter: filterGroupQuerySchema,
  q: searchTermSchema,
  cursor: cursorSchema,
  limit: z.coerce.number().int().min(1).max(LEAD_PAGE_SIZE).default(LEAD_PAGE_SIZE),
});
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

export const recordListQuerySchema = z.object({
  filter: filterGroupQuerySchema,
  q: searchTermSchema,
  cursor: cursorSchema,
  limit: z.coerce.number().int().min(1).max(RECORD_PAGE_SIZE).default(RECORD_PAGE_SIZE),
});
export type RecordListQuery = z.infer<typeof recordListQuerySchema>;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(20).default(SEARCH_RESULT_LIMIT),
});

export const duplicateQuerySchema = z.object({
  email: emailSchema.optional(),
  linkedinUrl: z.string().trim().max(500).optional(),
  name: z.string().trim().min(2).max(200).optional(),
  domain: z.string().trim().max(253).optional(),
});
export type DuplicateQuery = z.infer<typeof duplicateQuerySchema>;

export const timelineQuerySchema = z.object({
  subjectType: z.enum(ACTIVITY_ENTITY_TYPES),
  subjectId: idSchema,
  filter: z.enum(TIMELINE_FILTERS).default('all'),
  cursor: cursorSchema,
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;

export const contextQuerySchema = z.object({
  ref: z.string().trim().min(1).max(500),
  maxTokens: z.coerce.number().int().optional().transform(clampContextTokens),
});
export type ContextQuery = z.infer<typeof contextQuerySchema>;
