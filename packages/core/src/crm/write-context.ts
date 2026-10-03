import type { Actor } from '@gravity/shared/events';
import type { Principal } from '@gravity/shared/policy';
import { principalActor } from '../actor.ts';

export interface WriteContext {
  readonly principal: Principal;
  readonly originClientId?: string | undefined;
  readonly actor?: Actor | undefined;
}

export function writeActor(context: WriteContext): Actor {
  return context.actor ?? principalActor(context.principal);
}
