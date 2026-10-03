import type { LeadRow, StageRow } from '@gravity/shared/records';
import type { LeadChange } from '@gravity/shared/validators';

export type StageMove =
  | { readonly kind: 'change'; readonly change: LeadChange }
  | { readonly kind: 'hold' }
  | { readonly kind: 'none' };

export function stageChangeFor(lead: Pick<LeadRow, 'stageId'>, stage: StageRow): StageMove {
  if (stage.id === lead.stageId) return { kind: 'none' };
  if (stage.category === 'hold') return { kind: 'hold' };
  if (stage.category === 'won' || stage.category === 'lost') {
    return { kind: 'change', change: { type: 'close', stageId: stage.id } };
  }
  return { kind: 'change', change: { type: 'update', patch: { stageId: stage.id } } };
}
