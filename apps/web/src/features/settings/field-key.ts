import type { FieldObject } from '@gravity/shared/constants';
import type { FieldDefinitionRow } from '@gravity/shared/records';

const MAX_KEY = 40;
const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_OPTION_VALUE = 64;

function slug(label: string, separator: '_' | '-'): string {
  return label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replaceAll(' ', separator);
}

export function fieldKeyFromLabel(label: string): string {
  const key = slug(label, '_');
  if (key.length === 0) return 'field';
  const prefixed = /^[a-z]/.test(key) ? key : `field_${key}`;
  return prefixed.slice(0, MAX_KEY).replace(/_+$/, '');
}

export function optionsFromLines(text: string): { value: string; label: string }[] {
  const seen = new Set<string>();
  const options: { value: string; label: string }[] = [];
  for (const line of text.split('\n')) {
    const label = line.trim();
    const value = slug(label, '-').slice(0, MAX_OPTION_VALUE);
    if (label.length === 0 || value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label });
  }
  return options;
}

export function movedIds(ids: readonly string[], index: number, direction: -1 | 1): string[] {
  const next = [...ids];
  const target = index + direction;
  const here = next[index];
  const there = next[target];
  if (here === undefined || there === undefined) return next;
  next[index] = there;
  next[target] = here;
  return next;
}

export function fieldKeyProblem(
  key: string,
  fields: readonly Pick<FieldDefinitionRow, 'object' | 'pipelineId' | 'key'>[],
  object: FieldObject,
  pipelineId: string | null,
): string | null {
  if (!FIELD_KEY.test(key)) return 'Use lowercase letters, digits and underscores.';
  const sameKey = fields.filter((field) => field.object === object && field.key === key);
  if (sameKey.some((field) => field.pipelineId === pipelineId)) {
    return 'A custom field with that key already exists here.';
  }
  if (pipelineId === null && sameKey.length > 0) {
    return 'A pipeline already has a custom field with that key. Use another key.';
  }
  if (pipelineId !== null && sameKey.some((field) => field.pipelineId === null)) {
    return 'A workspace-wide custom field already uses that key. Use another key.';
  }
  return null;
}
