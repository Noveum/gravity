import type { Actor } from '@gravity/shared/events';
import type { Principal } from '@gravity/shared/policy';

export function principalActor(principal: Principal, name?: string): Actor {
  return name === undefined
    ? { type: 'user', id: principal.userId }
    : { type: 'user', id: principal.userId, name };
}

export function systemActor(job: string): Actor {
  return { type: 'system', id: job };
}
