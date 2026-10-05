import type { ClientSnapshot } from "./dto";

// Projection only narrows an already-authorized snapshot; server policy remains authoritative.
export function productSnapshot(
  snapshot: ClientSnapshot,
  productId: string,
): ClientSnapshot {
  if (!productId) return snapshot;
  const scoped = <T extends { productId: string }>(rows: T[]) =>
    rows.filter((row) => row.productId === productId);
  const relationships = scoped(snapshot.relationships);
  const personIds = new Set(
    relationships.map((relationship) => relationship.personId),
  );
  const people = snapshot.people.filter((person) => personIds.has(person.id));
  const companyIds = new Set(people.map((person) => person.companyId));
  return {
    ...snapshot,
    relationships,
    people,
    companies: snapshot.companies.filter(
      (company) =>
        companyIds.has(company.id) ||
        !snapshot.people.some((person) => person.companyId === company.id),
    ),
    actions: scoped(snapshot.actions),
    sequences: scoped(snapshot.sequences),
    enrollments: scoped(snapshot.enrollments),
    folders: scoped(snapshot.folders),
    assets: scoped(snapshot.assets),
    assetStages: scoped(snapshot.assetStages),
    stages: scoped(snapshot.stages),
    meetings: scoped(snapshot.meetings),
    opportunities: scoped(snapshot.opportunities),
    members: snapshot.members.map((member) => ({
      ...member,
      productIds: member.productIds.filter((id) => id === productId),
    })),
  };
}

// A burst gets at most one in-flight read and one trailing read for the latest requested scope.
export function createRefreshCoordinator() {
  let pending: Promise<void> | undefined;
  let next: (() => Promise<void>) | undefined;
  function refresh(task: () => Promise<void>): Promise<void> {
    next = task;
    if (!pending) {
      pending = (async () => {
        while (next) {
          const current = next;
          next = undefined;
          await current();
        }
      })().finally(() => {
        pending = undefined;
        if (next) {
          const queued = next;
          next = undefined;
          return refresh(queued);
        }
      });
    }
    return pending;
  }
  return refresh;
}
