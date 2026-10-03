import type { ActivityRow } from '@gravity/shared/records';
import { z } from 'zod';

export interface ActivityNames {
  readonly memberName: (userId: string) => string | undefined;
}

const changeSchema = z.object({ from: z.unknown().optional(), to: z.unknown().optional() });
const payloadSchema = z
  .object({
    key: z.string().optional(),
    name: z.string().optional(),
    companyName: z.string().optional(),
    changes: z.record(z.string(), changeSchema).optional(),
  })
  .loose();
const stageNameSchema = z.object({ name: z.string() });

function actorName(activity: ActivityRow, names: ActivityNames): string {
  if (activity.actor.name !== undefined) return activity.actor.name;
  if (activity.actor.type === 'user') return names.memberName(activity.actor.id) ?? 'Someone';
  if (activity.actor.type === 'system') return 'Gravity';
  return activity.actor.id;
}

function stageName(value: unknown): string {
  const parsed = stageNameSchema.safeParse(value);
  return parsed.success ? parsed.data.name : 'another stage';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function describeActivity(activity: ActivityRow, names: ActivityNames): string {
  const actor = actorName(activity, names);
  const parsed = payloadSchema.safeParse(activity.payload);
  if (!parsed.success) return `${actor} updated this record`;
  const payload = parsed.data;
  const key = payload.key ?? 'a lead';
  const changes = payload.changes ?? {};
  switch (activity.kind) {
    case 'lead.created':
      return `${actor} created ${key}`;
    case 'lead.stage_changed':
      return `${actor} moved ${key} from ${stageName(changes['stageId']?.from)} to ${stageName(changes['stageId']?.to)}`;
    case 'lead.owner_changed': {
      const owner = text(changes['ownerId']?.to);
      return `${actor} assigned ${key} to ${owner === '' ? 'nobody' : (names.memberName(owner) ?? 'a teammate')}`;
    }
    case 'lead.priority_changed':
      return `${actor} changed the priority of ${key}`;
    case 'lead.next_action_changed':
      return `${actor} set the next action on ${key}`;
    case 'lead.held':
      return `${actor} put ${key} on hold: ${text(changes['holdReason']?.to)}`;
    case 'lead.closed':
      return `${actor} closed ${key}`;
    case 'person.created':
      return `${actor} added ${payload.name ?? 'this person'}`;
    case 'company.created':
      return `${actor} added ${payload.name ?? 'this company'}`;
    case 'employment.started':
      return `${actor} recorded a job at ${payload.companyName ?? 'a company'}`;
    case 'employment.ended':
      return `${actor} ended a job at ${payload.companyName ?? 'a company'}`;
    default:
      return `${actor} updated ${payload.key ?? payload.name ?? 'this record'}`;
  }
}
