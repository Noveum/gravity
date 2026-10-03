import { type SQL, sql } from '@gravity/db';
import type { AnyColumn } from 'drizzle-orm';

type PersonReference = AnyColumn | SQL;

function currentEmployment(personId: PersonReference): SQL {
  return sql`from employment e join company c on c.id = e.company_id where e.person_id = ${personId} and e.is_current and c.archived_at is null order by e.started_at desc nulls last, e.created_at desc limit 1`;
}

export function currentCompanyId(personId: PersonReference): SQL<string | null> {
  return sql<string | null>`(select e.company_id ${currentEmployment(personId)})`;
}

export function currentCompanyName(personId: PersonReference): SQL<string | null> {
  return sql<string | null>`(select c.name ${currentEmployment(personId)})`;
}

export function currentTitle(personId: PersonReference): SQL<string | null> {
  return sql<string | null>`(select e.title ${currentEmployment(personId)})`;
}
