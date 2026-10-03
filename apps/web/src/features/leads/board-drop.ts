import {
  type ClientRect,
  type CollisionDetection,
  KeyboardCode,
  type KeyboardCodes,
  type KeyboardCoordinateGetter,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core';
import type { LeadRow, StageRow } from '@gravity/shared/records';
import { OTHER_STAGE_ID } from './lead-groups.ts';
import { type StageMove, stageChangeFor } from './stage-change.ts';

export type BoardMove = StageMove;

export function moveToStage(lead: LeadRow, target: StageRow | undefined): BoardMove {
  if (target === undefined || target.id === OTHER_STAGE_ID) return { kind: 'none' };
  return stageChangeFor(lead, target);
}

export const BOARD_PICK_UP_CODE = 'KeyM';

export const BOARD_KEYBOARD_CODES: KeyboardCodes = {
  start: [BOARD_PICK_UP_CODE],
  cancel: [KeyboardCode.Esc],
  end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
};

const KEY_DIRECTION: Readonly<Record<string, 1 | -1>> = {
  [KeyboardCode.Right]: 1,
  [KeyboardCode.Left]: -1,
};

export function adjacentColumn(
  columns: Iterable<ClientRect>,
  from: ClientRect,
  direction: 1 | -1,
): ClientRect | undefined {
  const centre = from.left + from.width / 2;
  const ordered = [...columns].sort((a, b) => a.left - b.left);
  return direction === 1
    ? ordered.find((column) => column.left > centre)
    : ordered.findLast((column) => column.left + column.width < centre);
}

export const columnCoordinates: KeyboardCoordinateGetter = (
  event,
  { context, currentCoordinates },
) => {
  const direction = KEY_DIRECTION[event.code];
  const from = context.collisionRect;
  if (direction === undefined || from === null) return undefined;
  const target = adjacentColumn(context.droppableRects.values(), from, direction);
  if (target === undefined) return undefined;
  return { x: target.left + (target.width - from.width) / 2, y: currentCoordinates.y };
};

export const boardCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};
