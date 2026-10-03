import { z } from 'zod';
import { ORG_ROLES } from '../constants/index.ts';
import { emailSchema } from './common.ts';

export const inviteCreateSchema = z.object({
  email: emailSchema,
  role: z.enum(ORG_ROLES).default('member'),
});

export const inviteBulkSchema = z.object({
  invites: z
    .array(inviteCreateSchema)
    .min(1)
    .max(100)
    .refine((invites) => new Set(invites.map((invite) => invite.email)).size === invites.length, {
      message: 'Each email address can only be invited once per batch.',
    }),
});

export type InviteCreateInput = z.infer<typeof inviteCreateSchema>;
export type InviteBulkInput = z.infer<typeof inviteBulkSchema>;
