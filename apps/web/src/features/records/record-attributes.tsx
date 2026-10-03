'use client';

import type { CompanyRow, FieldDefinitionRow, PersonRow } from '@gravity/shared/records';
import type { FieldValue } from '@gravity/shared/validators';
import { Switch } from '@/components/ui/switch.tsx';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import {
  type UpdateCompanyInput,
  type UpdatePersonInput,
  useUpdateCompany,
  useUpdatePerson,
} from '@/lib/query/use-record-mutations.ts';
import { AttributeRow, EditableField, type EditableFieldType } from './editable-field.tsx';

function list(values: readonly string[]): string {
  return values.join(', ');
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function optional(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function fieldText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string').join(', ');
  }
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '';
}

function fieldValueFrom(definition: FieldDefinitionRow, raw: string): FieldValue {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (definition.type === 'number') return Number(trimmed);
  if (definition.type === 'multi_select') return splitList(trimmed);
  return trimmed;
}

const INPUT_TYPE: Partial<Record<FieldDefinitionRow['type'], EditableFieldType>> = {
  email: 'email',
  url: 'url',
  number: 'number',
  date: 'date',
};

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <AttributeRow label={label}>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} className="ml-1" />
    </AttributeRow>
  );
}

function CustomFields({
  definitions,
  values,
  onSave,
}: {
  readonly definitions: readonly FieldDefinitionRow[];
  readonly values: Readonly<Record<string, unknown>>;
  readonly onSave: (key: string, value: FieldValue) => void;
}) {
  return definitions.map((definition) =>
    definition.type === 'boolean' ? (
      <SwitchRow
        key={definition.id}
        label={definition.label}
        checked={values[definition.key] === true}
        onChange={(checked) => onSave(definition.key, checked)}
      />
    ) : (
      <EditableField
        key={definition.id}
        label={definition.label}
        value={fieldText(values[definition.key])}
        type={INPUT_TYPE[definition.type] ?? 'text'}
        placeholder={definition.example === '' ? 'Empty' : definition.example}
        onSave={(raw) => onSave(definition.key, fieldValueFrom(definition, raw))}
      />
    ),
  );
}

const ATTRIBUTES_CLASS = 'flex flex-col';

export function PersonAttributes({ person }: { readonly person: PersonRow }) {
  const workspace = useWorkspace();
  const update = useUpdatePerson();
  const save = (patch: UpdatePersonInput['patch']) => update.mutate({ person, patch });
  return (
    <dl className={ATTRIBUTES_CLASS} data-testid="record-attributes">
      <EditableField label="Name" required value={person.name} onSave={(name) => save({ name })} />
      <EditableField
        label="Emails"
        value={list(person.emails)}
        onSave={(raw) => save({ emails: splitList(raw) })}
      />
      <EditableField
        label="Phones"
        value={list(person.phones)}
        onSave={(raw) => save({ phones: splitList(raw) })}
      />
      <EditableField
        label="LinkedIn"
        type="url"
        value={person.linkedinUrl ?? ''}
        onSave={(raw) => save({ linkedinUrl: optional(raw) })}
      />
      <EditableField
        label="Location"
        value={person.location ?? ''}
        onSave={(raw) => save({ location: optional(raw) })}
      />
      <EditableField
        label="Time zone"
        value={person.timezone ?? ''}
        placeholder="Europe/London"
        onSave={(raw) => save({ timezone: optional(raw) })}
      />
      <SwitchRow
        label="Do not contact"
        checked={person.doNotContact}
        onChange={(doNotContact) => save({ doNotContact })}
      />
      <CustomFields
        definitions={workspace.fieldsFor('person', null)}
        values={person.fields}
        onSave={(key, value) => save({ fields: { [key]: value } })}
      />
    </dl>
  );
}

export function CompanyAttributes({ company }: { readonly company: CompanyRow }) {
  const workspace = useWorkspace();
  const update = useUpdateCompany();
  const save = (patch: UpdateCompanyInput['patch']) => update.mutate({ company, patch });
  return (
    <dl className={ATTRIBUTES_CLASS} data-testid="record-attributes">
      <EditableField label="Name" required value={company.name} onSave={(name) => save({ name })} />
      <EditableField
        label="Domains"
        value={list(company.domains)}
        onSave={(raw) => save({ domains: splitList(raw) })}
      />
      <EditableField
        label="Size"
        value={company.size ?? ''}
        onSave={(raw) => save({ size: optional(raw) })}
      />
      <EditableField
        label="Segment"
        value={company.segment ?? ''}
        onSave={(raw) => save({ segment: optional(raw) })}
      />
      <EditableField
        label="Location"
        value={company.location ?? ''}
        onSave={(raw) => save({ location: optional(raw) })}
      />
      <CustomFields
        definitions={workspace.fieldsFor('company', null)}
        values={company.fields}
        onSave={(key, value) => save({ fields: { [key]: value } })}
      />
    </dl>
  );
}
