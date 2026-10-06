import { z } from 'zod';

export const FILE_VISIBILITIES = ['private', 'workspace', 'public', 'shared', 'inherit'] as const;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_MARKDOWN_LENGTH = 1_000_000;
export const fileIdSchema = z.string().uuid();
export const filePreviewMimeSchema = z.enum([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/csv',
]);
export const fileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (name) =>
      ![...name].some(
        (character) => character.charCodeAt(0) < 32 || character === '/' || character === '\\',
      ) &&
      name !== '.' &&
      name !== '..',
    'Use a file name without slashes or control characters.',
  );
export const fileGrantSchema = z.object({
  userId: z.string().min(1).max(128),
  role: z.enum(['viewer', 'editor']),
});
export const fileAccessSchema = z.object({
  visibility: z.enum(FILE_VISIBILITIES),
  grants: z.array(fileGrantSchema).max(100).default([]),
});
export const fileCreateSchema = fileAccessSchema.extend({
  name: fileNameSchema,
  parentId: fileIdSchema.nullable().default(null),
  kind: z.enum(['folder', 'markdown']),
  body: z.string().max(MAX_MARKDOWN_LENGTH).default(''),
  visibility: z.enum(FILE_VISIBILITIES).default('private'),
});
export const fileUpdateSchema = z.object({
  name: fileNameSchema.optional(),
  body: z.string().max(MAX_MARKDOWN_LENGTH).optional(),
  access: fileAccessSchema.optional(),
  expectedSyncId: z.number().int().nonnegative(),
});
export const fileTransferSchema = z.object({
  ids: z.array(fileIdSchema).min(1).max(100),
  parentId: fileIdSchema.nullable(),
  operation: z.enum(['move', 'copy', 'delete']),
});
export const fileDragSchema = z.object({
  ids: z.array(fileIdSchema).min(1).max(100),
  organizationId: z.string().min(1).max(128),
});
export const fileUploadSchema = z.object({
  name: fileNameSchema,
  parentId: fileIdSchema.nullable().default(null),
  size: z.number().int().min(0).max(MAX_UPLOAD_BYTES),
  mimeType: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[\w.+-]+\/[\w.+-]+$/),
});
export const fileCompleteSchema = z.object({ uploadId: fileIdSchema });
export const fileListSchema = z.object({ parentId: fileIdSchema.nullish() });
export const publicFileTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const fileEntrySchema = fileAccessSchema.extend({
  id: fileIdSchema,
  parentId: fileIdSchema.nullable(),
  ownerId: z.string(),
  name: z.string(),
  kind: z.enum(['folder', 'markdown', 'file']),
  mimeType: z.string().nullable(),
  size: z.number().nonnegative(),
  syncId: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  canEdit: z.boolean(),
  canShare: z.boolean(),
  publicToken: publicFileTokenSchema.nullable(),
});
export const fileListingSchema = z.object({
  entries: z.array(fileEntrySchema),
  ancestors: z.array(fileEntrySchema),
});
export const fileDetailSchema = z.object({ entry: fileEntrySchema, body: z.string().nullable() });
export const fileMutationSchema = z.object({ entries: z.array(fileEntrySchema) });
export const fileUploadResponseSchema = z.object({
  uploadId: fileIdSchema,
  url: z.string().url(),
});
export type FileGrant = z.infer<typeof fileGrantSchema>;
export type FileAccess = z.infer<typeof fileAccessSchema>;
export type FileEntry = z.infer<typeof fileEntrySchema>;
export type FileListing = z.infer<typeof fileListingSchema>;
export type FileDetail = z.infer<typeof fileDetailSchema>;
