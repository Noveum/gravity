import type { ClientSnapshot } from "@crm/core/dto";
import type { PaletteRecord } from "../commands";
import { companyPath, personPath } from "../routes";

export function recordsForPalette(
  snapshot: ClientSnapshot,
  go: (href: string) => void,
): PaletteRecord[] {
  const companies = new Map(
    snapshot.companies.map((company) => [company.id, company]),
  );
  const people = new Map(snapshot.people.map((person) => [person.id, person]));
  const relationships = new Map(
    snapshot.relationships.map((relationship) => [
      relationship.id,
      relationship,
    ]),
  );
  return [
    ...snapshot.people.map((person) => ({
      id: person.id,
      kind: "person" as const,
      title: person.name,
      detail: [person.title, companies.get(person.companyId ?? "")?.name]
        .filter(Boolean)
        .join(" · "),
      run: () => go(personPath(person.id)),
    })),
    ...snapshot.companies.map((company) => ({
      id: company.id,
      kind: "company" as const,
      title: company.name,
      detail: company.domain ?? "",
      run: () => go(companyPath(company.id)),
    })),
    ...snapshot.actions.flatMap((action) => {
      const relationship = relationships.get(action.relationshipId);
      const person = people.get(relationship?.personId ?? "");
      if (action.status === "completed" || !person) return [];
      return [
        {
          id: action.id,
          kind: "action" as const,
          title: action.title,
          detail: person.name,
          run: () =>
            go(
              personPath(person.id, {
                relationshipId: action.relationshipId,
                actionId: action.id,
              }),
            ),
        },
      ];
    }),
  ];
}
