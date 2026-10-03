import { and, or, type SQL, sql } from '@gravity/db';
import { validationFailed } from '@gravity/shared/errors';
import {
  type FilterCondition,
  type FilterContext,
  type FilterGroup,
  type FilterNode,
  type FilterValueKind,
  OPERATORS_BY_KIND,
  resolveFilterValues,
  resolveRelativeRange,
  searchTokens,
  UNSET_FILTER_VALUE,
  utcDay,
} from '@gravity/shared/filters';
import type { AnyColumn } from 'drizzle-orm';

export interface SqlFilterProperty {
  readonly kind: FilterValueKind;
  readonly expression: SQL | AnyColumn;
  readonly present?: SQL;
  readonly allowsMe?: boolean;
}

export type SqlFilterRegistry = ReadonlyMap<string, SqlFilterProperty>;

type Bound = '>=' | '<=';

export function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function list(values: readonly SQL[]): SQL {
  return sql.join([...values], sql`, `);
}

function anyOf(parts: readonly SQL[]): SQL {
  return parts.length === 0 ? sql`false` : sql`(${sql.join([...parts], sql` or `)})`;
}

function allOf(parts: readonly SQL[]): SQL {
  return sql`(${sql.join([...parts], sql` and `)})`;
}

function day(expression: SQL | AnyColumn): SQL {
  return sql`(${expression}) collate "C"`;
}

function number(expression: SQL | AnyColumn): SQL {
  return sql`(${expression})::float8`;
}

function absent(property: SqlFilterProperty): SQL {
  return property.present === undefined
    ? sql`(${property.expression}) is null`
    : sql`not coalesce(${property.present}, false)`;
}

function namedDate(expression: SQL | AnyColumn, value: string, today: string): SQL {
  if (value === UNSET_FILTER_VALUE) return sql`(${expression}) is null`;
  if (value === 'any') return sql`(${expression}) is not null`;
  if (value === 'overdue') return sql`${day(expression)} < ${today}`;
  if (value === 'today') return sql`${day(expression)} = ${today}`;
  return sql`false`;
}

function multiIn(expression: SQL | AnyColumn, concrete: readonly string[], unset: boolean): SQL {
  const array = sql`(case when jsonb_typeof(${expression}) = 'array' then ${expression} else '[]'::jsonb end)`;
  const parts: SQL[] = [];
  if (concrete.length > 0) {
    parts.push(sql`${array} ?| array[${list(concrete.map((value) => sql`${value}`))}]::text[]`);
  }
  if (unset) {
    parts.push(
      sql`not exists (select 1 from jsonb_array_elements(${array}) as element(value) where jsonb_typeof(element.value) = 'string')`,
    );
  }
  return anyOf(parts);
}

function booleanIn(expression: SQL | AnyColumn, concrete: readonly string[]): SQL {
  const parts: SQL[] = [];
  if (concrete.includes('true')) parts.push(sql`(${expression}) is true`);
  if (concrete.includes('false')) parts.push(sql`(${expression}) is false`);
  return anyOf(parts);
}

function inSql(
  property: SqlFilterProperty,
  values: readonly string[],
  context: FilterContext,
): SQL {
  const expression = property.expression;
  if (property.kind === 'date') {
    const today = utcDay(context.now);
    return anyOf(values.map((value) => namedDate(expression, value, today)));
  }
  const { concrete, unset } = resolveFilterValues(property, values, context);
  if (property.kind === 'multi') return multiIn(expression, concrete, unset);
  if (property.kind === 'boolean') return booleanIn(expression, concrete);
  const parts: SQL[] = [];
  if (property.kind === 'number') {
    const numbers = concrete.map(Number).filter((value) => Number.isFinite(value));
    if (numbers.length > 0) {
      parts.push(
        sql`${number(expression)} in (${list(numbers.map((value) => sql`${value}::float8`))})`,
      );
    }
  } else if (concrete.length > 0) {
    parts.push(sql`(${expression}) in (${list(concrete.map((value) => sql`${value}`))})`);
  }
  if (unset) parts.push(absent(property));
  return anyOf(parts);
}

function numberBound(expression: SQL | AnyColumn, operator: Bound, raw: string): SQL | null {
  const value = Number(raw);
  if (Number.isNaN(value)) return sql`false`;
  if (value === Number.POSITIVE_INFINITY) return operator === '>=' ? sql`false` : null;
  if (value === Number.NEGATIVE_INFINITY) return operator === '<=' ? sql`false` : null;
  return sql`${number(expression)} ${sql.raw(operator)} ${value}::float8`;
}

function dayBound(expression: SQL | AnyColumn, operator: Bound, raw: string): SQL {
  return sql`${day(expression)} ${sql.raw(operator)} ${raw}`;
}

function rangeSql(property: SqlFilterProperty, from: string | null, to: string | null): SQL {
  const bound = property.kind === 'number' ? numberBound : dayBound;
  const parts: SQL[] = [sql`(${property.expression}) is not null`];
  for (const [operator, raw] of [
    ['>=', from],
    ['<=', to],
  ] as const) {
    if (raw === null) continue;
    const part = bound(property.expression, operator, raw);
    if (part !== null) parts.push(part);
  }
  return allOf(parts);
}

function positiveSql(
  property: SqlFilterProperty,
  condition: FilterCondition,
  context: FilterContext,
): SQL {
  switch (condition.operator) {
    case 'in':
      return inSql(property, condition.values, context);
    case 'contains':
      return sql`(${property.expression}) ilike ${likePattern(condition.value)}`;
    case 'range':
      return rangeSql(property, condition.from, condition.to);
    case 'relative': {
      const range = resolveRelativeRange(condition.relative, utcDay(context.now));
      return rangeSql(property, range.from, range.to);
    }
  }
}

function conditionSql(
  property: SqlFilterProperty,
  condition: FilterCondition,
  context: FilterContext,
): SQL {
  if (!OPERATORS_BY_KIND[property.kind].includes(condition.operator)) {
    throw validationFailed(
      `The ${condition.property} filter does not support ${condition.operator}.`,
    );
  }
  const safe = sql`coalesce(${positiveSql(property, condition, context)}, false)`;
  return condition.negate ? sql`not ${safe}` : safe;
}

function nodeSql(
  node: FilterNode,
  registry: SqlFilterRegistry,
  context: FilterContext,
): SQL | null {
  if (node.kind === 'condition') {
    const property = registry.get(node.property);
    return property === undefined ? null : conditionSql(property, node, context);
  }
  const children = node.children
    .map((child) => nodeSql(child, registry, context))
    .filter((child): child is SQL => child !== null);
  if (children.length === 0) return null;
  return sql`(${sql.join(children, node.combinator === 'and' ? sql` and ` : sql` or `)})`;
}

export function filterToSql(
  group: FilterGroup,
  registry: SqlFilterRegistry,
  context: FilterContext,
): SQL | undefined {
  return nodeSql(group, registry, context) ?? undefined;
}

export function searchToSql(q: string, expressions: readonly (SQL | AnyColumn)[]): SQL | undefined {
  const tokens = searchTokens(q);
  if (tokens.length === 0) return undefined;
  return and(
    ...tokens.map((token) =>
      or(
        ...expressions.map(
          (expression) => sql`coalesce(${expression}, '') ilike ${likePattern(token)}`,
        ),
      ),
    ),
  );
}
