"use client";
import type { ClientCompanyContext, ClientContext } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { useWorkspaceData } from "../crm/crm-context";
import {
  replacePersonalNotes,
  splitImportedConversation,
} from "./imported-conversation";
import { InlineField } from "./inline-field";

type Person = NonNullable<ClientContext["person"]>;

export function PersonFields({
  person,
  notesOnly = false,
  profile = false,
}: {
  person: Person;
  notesOnly?: boolean;
  profile?: boolean;
}) {
  const crm = useWorkspaceData();
  person = crm.currentRecord(person);
  const save = async (key: string, value: string, captured: Person) => {
    const original = crm.currentRecord(captured);
    const result = await crm.send(
      {
        operation: "person-update",
        organizationId: crm.organizationId,
        personId: original.id,
        version: original.version,
        name: original.name,
        title: original.title,
        email: original.email,
        otherEmails: original.otherEmails,
        phone: original.phone,
        linkedinUrl: original.linkedinUrl,
        summary: original.summary,
        [key]:
          key === "email"
            ? value || null
            : key === "otherEmails"
              ? value.split(/[\s,]+/).filter(Boolean)
              : key === "companyId"
                ? value || null
                : value,
      },
      false,
      false,
    );
    return result.ok ? null : (result.error ?? t.errors.INVALID_INPUT);
  };
  if (notesOnly)
    return (
      <section className="record-section" aria-label={t.personNotes}>
        <InlineField
          key={person.id}
          label={t.personNotes}
          record={person}
          value={splitImportedConversation(person.summary).notes}
          multiline
          spacious
          readOnly={!!person.archivedAt}
          onSave={(value, original) =>
            save(
              "summary",
              replacePersonalNotes(crm.currentRecord(original).summary, value),
              original,
            )
          }
        />
        {!splitImportedConversation(person.summary).notes && (
          <p className="notes-hint">{t.contactWorkspace.notesHint}</p>
        )}
      </section>
    );
  const fields = [
    {
      key: "name",
      label: t.name,
      value: person.name,
      maxLength: 100,
      required: true,
    },
    { key: "title", label: t.roleTitle, value: person.title, maxLength: 150 },
    {
      key: "email",
      label: t.email,
      value: person.email ?? "",
      type: "email" as const,
      maxLength: 254,
    },
    {
      key: "phone",
      label: t.phone,
      value: person.phone,
      type: "tel" as const,
      maxLength: 40,
    },
    {
      key: "linkedinUrl",
      label: t.linkedinUrl,
      value: person.linkedinUrl,
      type: "url" as const,
      maxLength: 300,
    },
    {
      key: "otherEmails",
      label: t.otherEmails,
      value: person.otherEmails.join(", "),
      maxLength: 2600,
    },
  ];
  return (
    <div
      className={profile ? "contact-fields profile-fields" : "contact-fields"}
    >
      {fields
        .filter((field) => profile === ["name", "title"].includes(field.key))
        .map(({ key, ...field }) => (
          <InlineField
            key={`${person.id}:${key}`}
            {...field}
            record={person}
            readOnly={!!person.archivedAt}
            onSave={(value, original) => save(key, value, original)}
          />
        ))}
      {!profile && (
        <InlineField
          key={`${person.id}:company`}
          label={t.company}
          record={person}
          value={person.companyId ?? ""}
          readOnly={!!person.archivedAt}
          options={[
            { value: "", label: t.noCompany },
            ...crm.sourceData.companies.map((company) => ({
              value: company.id,
              label: company.name,
            })),
            ...crm.sourceData.archived.companies
              .filter((company) => company.id === person.companyId)
              .map((company) => ({
                value: company.id,
                label: `${company.name} ${t.archivedSuffix}`,
              })),
          ]}
          onSave={(value, original) => save("companyId", value, original)}
        />
      )}
    </div>
  );
}

export function CompanyFields({
  company,
}: {
  company: ClientCompanyContext["company"];
}) {
  const crm = useWorkspaceData();
  company = crm.currentRecord(company);
  return (
    <section className="record-section contact-fields">
      {[
        {
          key: "name",
          label: t.name,
          value: company.name,
          maxLength: 100,
          required: true,
        },
        {
          key: "domain",
          label: t.domain,
          value: company.domain ?? "",
          maxLength: 253,
        },
        {
          key: "description",
          label: t.description,
          value: company.description,
          maxLength: 2000,
          multiline: true,
        },
      ].map(({ key, ...field }) => (
        <InlineField
          key={`${company.id}:${key}`}
          {...field}
          record={company}
          readOnly={!!company.archivedAt}
          onSave={async (value, captured) => {
            const original = crm.currentRecord(captured);
            const result = await crm.send(
              {
                operation: "company",
                organizationId: crm.organizationId,
                companyId: original.id,
                version: original.version,
                name: original.name,
                domain: original.domain,
                description: original.description,
                [key]: value,
              },
              false,
              false,
            );
            return result.ok ? null : (result.error ?? t.errors.INVALID_INPUT);
          }}
        />
      ))}
    </section>
  );
}
