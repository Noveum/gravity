'use client';

import {
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  type FieldType,
  SELECT_FIELD_TYPES,
} from '@gravity/shared/constants';
import { Archive } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { NativeSelect } from '@/components/ui/native-select.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { EditableField } from '@/features/records/editable-field.tsx';
import { useCan } from '@/features/workspace/use-can.ts';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { cn } from '@/lib/cn.ts';
import { listRowHover, revealOnHover } from '@/lib/interaction.ts';
import {
  type FieldDraft,
  useArchiveField,
  useCreateField,
  useUpdateField,
} from '@/lib/query/use-config-mutations.ts';
import { fieldKeyFromLabel, fieldKeyProblem, optionsFromLines } from './field-key.ts';
import { focusNeighbourOf } from './focus.ts';
import { RoleNotice } from './role-notice.tsx';
import { SettingsGate } from './settings-gate.tsx';
import { useRefusedDraft } from './use-refused-draft.ts';

const OBJECTS = [
  { value: 'lead', label: 'Leads' },
  { value: 'person', label: 'People' },
  { value: 'company', label: 'Companies' },
] as const;

type EditableObject = (typeof OBJECTS)[number]['value'];

function asFieldType(value: string): FieldType {
  return FIELD_TYPES.find((type) => type === value) ?? 'text';
}

function NewFieldForm({ object }: { readonly object: EditableObject }) {
  const workspace = useWorkspace();
  const [label, setLabel] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [type, setType] = useState<FieldType>('text');
  const [optionsText, setOptionsText] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const refused = useRefusedDraft<FieldDraft>((draft) => {
    setLabel(draft.label);
    setKey(draft.key);
    setType(draft.type);
    setOptionsText(draft.options.map((option) => option.label).join('\n'));
    setPipelineId(draft.pipelineId ?? '');
  });
  const create = useCreateField({ onRefused: refused.onRefused });
  const derivedKey = key ?? (label.trim() === '' ? '' : fieldKeyFromLabel(label));
  const choice = SELECT_FIELD_TYPES.includes(type);
  const scope = object === 'lead' && pipelineId !== '' ? pipelineId : null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const options = choice ? optionsFromLines(optionsText) : [];
    if (label.trim().length === 0) {
      refused.setError('Name the field.');
      return;
    }
    if (choice && options.length === 0) {
      refused.setError('Add at least one option.');
      return;
    }
    const keyProblem = fieldKeyProblem(derivedKey, workspace.allFields, object, scope);
    if (keyProblem !== null) {
      refused.setError(keyProblem);
      return;
    }
    refused.setError(null);
    create.mutate({
      object,
      pipelineId: scope,
      key: derivedKey,
      label: label.trim(),
      type,
      options,
    });
    setLabel('');
    setKey(null);
    setOptionsText('');
  };

  return (
    <form
      aria-label="New field"
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-lg border border-border p-4"
    >
      <h2 className="font-medium text-dense text-text">New field</h2>
      <div className="grid grid-cols-2 gap-2">
        <Input
          aria-label="Field name"
          placeholder="Deal size"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Input
          aria-label="Key"
          value={derivedKey}
          maxLength={40}
          onChange={(event) => setKey(event.target.value === '' ? null : event.target.value)}
          className="font-mono"
        />
        <NativeSelect
          aria-label="Type"
          value={type}
          onChange={(event) => setType(asFieldType(event.target.value))}
        >
          {FIELD_TYPES.map((entry) => (
            <option key={entry} value={entry}>
              {FIELD_TYPE_LABELS[entry]}
            </option>
          ))}
        </NativeSelect>
        {object === 'lead' ? (
          <NativeSelect
            aria-label="Pipeline"
            value={pipelineId}
            onChange={(event) => setPipelineId(event.target.value)}
          >
            <option value="">All pipelines</option>
            {workspace.pipelines.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>
                {pipeline.name} ({pipeline.key})
              </option>
            ))}
          </NativeSelect>
        ) : null}
      </div>
      {choice ? (
        <Textarea
          aria-label="Options, one per line"
          placeholder="One option per line"
          rows={3}
          value={optionsText}
          onChange={(event) => setOptionsText(event.target.value)}
        />
      ) : null}
      {refused.error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {refused.error}
        </p>
      )}
      <Button type="submit" variant="primary" className="self-start">
        Create field
      </Button>
    </form>
  );
}

function FieldsBody() {
  const workspace = useWorkspace();
  const allowed = useCan('field:manage');
  const update = useUpdateField();
  const archive = useArchiveField();
  const [object, setObject] = useState<EditableObject>('lead');
  const heading = useRef<HTMLHeadingElement | null>(null);
  const fields = workspace.allFields.filter((field) => field.object === object);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 ref={heading} tabIndex={-1} className="font-medium text-lg text-text outline-none">
          Custom fields
        </h1>
        <p className="text-muted text-dense">
          Fields are validated on every write, by people and by agents.
        </p>
      </header>
      <fieldset className="flex min-w-0 gap-1">
        <legend className="sr-only">Record type</legend>
        {OBJECTS.map((entry) => (
          <Button
            key={entry.value}
            size="sm"
            variant={entry.value === object ? 'secondary' : 'ghost'}
            aria-pressed={entry.value === object}
            onClick={() => setObject(entry.value)}
          >
            {entry.label}
          </Button>
        ))}
      </fieldset>
      {allowed ? (
        <NewFieldForm key={object} object={object} />
      ) : (
        <RoleNotice what="fields" permission="field:manage" />
      )}
      <ul className="flex flex-col">
        {fields.map((field) => (
          <li
            key={field.id}
            className={cn(
              'group flex h-7 items-center gap-3 rounded-md px-2 text-dense',
              listRowHover,
            )}
          >
            <div className="flex min-w-0 flex-1 items-center">
              {allowed ? (
                <EditableField
                  inline
                  required
                  label={`field ${field.label}`}
                  value={field.label}
                  onSave={(label) => update.mutate({ field, patch: { label } })}
                />
              ) : (
                <span className="truncate text-text">{field.label}</span>
              )}
            </div>
            <span className="font-mono text-faint text-xs">{field.key}</span>
            <span className="w-28 text-muted">{FIELD_TYPE_LABELS[field.type]}</span>
            <span className="w-32 truncate text-faint">
              {field.pipelineId === null
                ? 'All pipelines'
                : (workspace.pipelineById.get(field.pipelineId)?.name ?? '')}
            </span>
            {allowed ? (
              <Button
                size="sm"
                variant="ghost"
                className={cn('size-6 px-0', revealOnHover)}
                aria-label={`Archive ${field.label}`}
                onClick={(event) => {
                  focusNeighbourOf(event.currentTarget.closest('li'), heading.current);
                  archive.mutate(field);
                }}
              >
                <Archive className="size-3.5" />
              </Button>
            ) : (
              <span aria-hidden="true" className="size-6" />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FieldsPanel() {
  return (
    <SettingsGate title="Could not load custom fields">
      <FieldsBody />
    </SettingsGate>
  );
}
