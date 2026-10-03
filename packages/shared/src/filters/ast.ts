import { z } from 'zod';

export const FILTER_OPERATORS = ['in', 'contains', 'range', 'relative'] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const UNSET_FILTER_VALUE = 'none';
export const ME_FILTER_VALUE = 'me';
export const NAMED_DATE_VALUES = ['none', 'any', 'overdue', 'today'] as const;
export const RELATIVE_UNITS = ['day', 'week', 'month'] as const;
export const RELATIVE_DIRECTIONS = ['past', 'future'] as const;
export const MAX_RELATIVE_OFFSET = 520;
export const MAX_FILTER_DEPTH = 5;
export const MAX_FILTER_CONDITIONS = 50;

const propertySchema = z
  .string()
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9]*(?:\.[a-z][a-z0-9_]*)?$/, 'That is not a filter property.');

const tokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z0-9_.:-]+$/,
    'Filter values may only contain letters, digits, dots, dashes, colons and underscores.',
  );

const textSchema = z.string().trim().min(1).max(200);

export const relativeDateSchema = z.object({
  unit: z.enum(RELATIVE_UNITS),
  offset: z.number().int().min(0).max(MAX_RELATIVE_OFFSET),
  direction: z.enum(RELATIVE_DIRECTIONS),
});
export type RelativeDate = z.infer<typeof relativeDateSchema>;

const conditionBase = {
  kind: z.literal('condition'),
  property: propertySchema,
  negate: z.boolean().default(false),
};

const filterConditionSchema = z
  .discriminatedUnion('operator', [
    z.object({
      ...conditionBase,
      operator: z.literal('in'),
      values: z.array(tokenSchema).min(1).max(50),
    }),
    z.object({ ...conditionBase, operator: z.literal('contains'), value: textSchema }),
    z.object({
      ...conditionBase,
      operator: z.literal('range'),
      from: tokenSchema.nullable().default(null),
      to: tokenSchema.nullable().default(null),
    }),
    z.object({ ...conditionBase, operator: z.literal('relative'), relative: relativeDateSchema }),
  ])
  .refine(
    (condition) =>
      condition.operator !== 'range' || condition.from !== null || condition.to !== null,
    'A range filter needs at least one bound.',
  );

export type FilterCondition = z.infer<typeof filterConditionSchema>;

export const FILTER_COMBINATORS = ['and', 'or'] as const;
export type FilterCombinator = (typeof FILTER_COMBINATORS)[number];

export interface FilterGroup {
  readonly kind: 'group';
  readonly combinator: FilterCombinator;
  readonly children: readonly FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

function nodeSchemaAtDepth(depth: number): z.ZodType<FilterNode, unknown> {
  if (depth >= MAX_FILTER_DEPTH) return filterConditionSchema;
  const child = nodeSchemaAtDepth(depth + 1);
  return z.union([
    filterConditionSchema,
    z.object({
      kind: z.literal('group'),
      combinator: z.enum(FILTER_COMBINATORS).default('and'),
      children: z.array(child).max(MAX_FILTER_CONDITIONS),
    }),
  ]);
}

export function countConditions(node: FilterNode): number {
  if (node.kind === 'condition') return 1;
  return node.children.reduce((total, child) => total + countConditions(child), 0);
}

export const filterGroupSchema: z.ZodType<FilterGroup, unknown> = z
  .object({
    kind: z.literal('group'),
    combinator: z.enum(FILTER_COMBINATORS).default('and'),
    children: z.array(nodeSchemaAtDepth(2)).max(MAX_FILTER_CONDITIONS),
  })
  .refine(
    (group) => countConditions(group) <= MAX_FILTER_CONDITIONS,
    `A filter may hold at most ${MAX_FILTER_CONDITIONS} conditions.`,
  );

const FILTER_GROUP_KEYS: readonly string[] = ['kind', 'combinator', 'children'];
const FILTER_CONDITION_KEYS: readonly string[] = [
  'kind',
  'property',
  'negate',
  'operator',
  'value',
  'values',
  'from',
  'to',
  'relative',
];

function allowedKeys(node: object): readonly string[] {
  const kind = (node as { kind?: unknown }).kind;
  if (kind === 'group') return FILTER_GROUP_KEYS;
  if (kind === 'condition') return FILTER_CONDITION_KEYS;
  return [...FILTER_GROUP_KEYS, ...FILTER_CONDITION_KEYS];
}

function collectStrayKeys(node: unknown, path: string, found: string[]): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  const allowed = allowedKeys(node);
  for (const [key, value] of Object.entries(node)) {
    const at = path.length === 0 ? key : `${path}.${key}`;
    if (!allowed.includes(key)) {
      found.push(at);
      continue;
    }
    if (key !== 'children' || !Array.isArray(value)) continue;
    for (const [index, child] of value.entries()) collectStrayKeys(child, `${at}[${index}]`, found);
  }
}

export function strayFilterKeys(node: unknown): string[] {
  const found: string[] = [];
  collectStrayKeys(node, '', found);
  return found;
}

export const filterGroupWriteSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    const stray = strayFilterKeys(value);
    if (stray.length === 0) return;
    ctx.addIssue({
      code: 'custom',
      message: `A saved filter does not store ${stray.join(', ')}. Send conditions under children.`,
    });
  })
  .pipe(filterGroupSchema);

export function emptyFilterGroup(): FilterGroup {
  return { kind: 'group', combinator: 'and', children: [] };
}

export function isEmptyFilter(group: FilterGroup): boolean {
  return countConditions(group) === 0;
}

export function conditionsOf(group: FilterGroup): FilterCondition[] {
  return group.children.flatMap((child) =>
    child.kind === 'condition' ? [child] : conditionsOf(child),
  );
}

export function conditionFor(group: FilterGroup, property: string): FilterCondition | undefined {
  return group.children.find(
    (child): child is FilterCondition => child.kind === 'condition' && child.property === property,
  );
}

export function replaceCondition(group: FilterGroup, next: FilterCondition): FilterGroup {
  const index = group.children.findIndex(
    (child) => child.kind === 'condition' && child.property === next.property,
  );
  if (index === -1) return { ...group, children: [...group.children, next] };
  return { ...group, children: group.children.with(index, next) };
}

export function removeCondition(group: FilterGroup, property: string): FilterGroup {
  return {
    ...group,
    children: group.children.filter(
      (child) => !(child.kind === 'condition' && child.property === property),
    ),
  };
}

export function dropLastCondition(group: FilterGroup): FilterGroup {
  const last = group.children.at(-1);
  if (last === undefined) return group;
  const withoutLast = group.children.slice(0, -1);
  if (last.kind === 'condition') return { ...group, children: withoutLast };
  if (countConditions(last) === 0) return dropLastCondition({ ...group, children: withoutLast });
  const trimmed = dropLastCondition(last);
  return {
    ...group,
    children: trimmed.children.length === 0 ? withoutLast : [...withoutLast, trimmed],
  };
}

export function inCondition(
  property: string,
  values: readonly string[],
  negate = false,
): FilterCondition {
  return { kind: 'condition', property, operator: 'in', values: [...values], negate };
}

export function containsCondition(
  property: string,
  value: string,
  negate = false,
): FilterCondition {
  return { kind: 'condition', property, operator: 'contains', value, negate };
}
