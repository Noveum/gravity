'use client';

import {
  type BrandColor,
  DEFAULT_PIPELINE_NAME,
  PIPELINE_KEY_PATTERN,
  PIPELINE_KINDS,
  type PipelineKind,
} from '@gravity/shared/constants';
import type { BrandRow } from '@gravity/shared/records';
import { derivePipelineKey } from '@gravity/shared/utils';
import Link from 'next/link';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { NativeSelect } from '@/components/ui/native-select.tsx';
import { EditableField } from '@/features/records/editable-field.tsx';
import { BrandDot } from '@/features/workspace/brand-dot.tsx';
import { useCan } from '@/features/workspace/use-can.ts';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { cn } from '@/lib/cn.ts';
import { navRowHover } from '@/lib/interaction.ts';
import {
  type BrandDraft,
  type PipelineDraft,
  useArchiveBrand,
  useCreateBrand,
  useCreatePipeline,
  useUpdateBrand,
} from '@/lib/query/use-config-mutations.ts';
import { ArchiveConfirm } from './archive-confirm.tsx';
import { ColorPicker } from './color-picker.tsx';
import { focusNeighbourOf } from './focus.ts';
import { RoleNotice } from './role-notice.tsx';
import { SettingsGate } from './settings-gate.tsx';
import { useRefusedDraft } from './use-refused-draft.ts';

function asKind(value: string): PipelineKind {
  return PIPELINE_KINDS.find((kind) => kind === value) ?? 'people';
}

function useTakenKeys(): ReadonlySet<string> {
  const workspace = useWorkspace();
  return useMemo(
    () =>
      new Set([
        ...workspace.pipelines.map((pipeline) => pipeline.key),
        ...workspace.retiredPipelineKeys,
      ]),
    [workspace.pipelines, workspace.retiredPipelineKeys],
  );
}

function takenKeyMessage(key: string, retired: readonly string[]): string {
  return retired.includes(key)
    ? 'That key belonged to an archived pipeline.'
    : 'Another pipeline already uses that key.';
}

function NewBrandForm() {
  const workspace = useWorkspace();
  const taken = useTakenKeys();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [color, setColor] = useState<BrandColor>('blue');
  const [key, setKey] = useState<string | null>(null);
  const refused = useRefusedDraft<BrandDraft>((draft) => {
    setName(draft.name);
    setDomain(draft.domain ?? '');
    setColor(draft.color);
    setKey(draft.pipelineKey);
  });
  const create = useCreateBrand({ onRefused: refused.onRefused });
  const pipelineKey = key ?? (name.trim().length === 0 ? '' : derivePipelineKey(name, taken));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim().length === 0) {
      refused.setError('Name the brand.');
      return;
    }
    if (!PIPELINE_KEY_PATTERN.test(pipelineKey)) {
      refused.setError('Use 2 to 5 letters for the pipeline key, like YOD.');
      return;
    }
    if (taken.has(pipelineKey)) {
      refused.setError(takenKeyMessage(pipelineKey, workspace.retiredPipelineKeys));
      return;
    }
    refused.setError(null);
    create.mutate({
      name: name.trim(),
      domain: domain.trim() === '' ? null : domain.trim(),
      color,
      pipelineKey,
    });
    setName('');
    setDomain('');
    setKey(null);
  };

  return (
    <form
      aria-label="New brand"
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-lg border border-border p-4"
    >
      <h2 className="font-medium text-dense text-text">New brand</h2>
      <div className="grid grid-cols-2 gap-2">
        <Input
          aria-label="Brand name"
          placeholder="Yodu"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          aria-label="Domain"
          placeholder="yodu.ai"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
        />
        <Input
          aria-label="Pipeline key"
          placeholder="YOD"
          maxLength={5}
          value={pipelineKey}
          onChange={(event) =>
            setKey(event.target.value === '' ? null : event.target.value.toUpperCase())
          }
          className="font-mono"
        />
        <ColorPicker value={color} onChange={setColor} />
      </div>
      {refused.error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {refused.error}
        </p>
      )}
      <Button type="submit" variant="primary" className="self-start">
        Create brand
      </Button>
    </form>
  );
}

function NewPipelineForm({ brand }: { readonly brand: BrandRow }) {
  const taken = useTakenKeys();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PipelineKind>('people');
  const refused = useRefusedDraft<PipelineDraft>((draft) => {
    setName(draft.name);
    setKind(draft.kind);
  });
  const create = useCreatePipeline({ onRefused: refused.onRefused });
  const key = derivePipelineKey(`${brand.name} ${name}`, taken);
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        refused.setError(null);
        create.mutate({
          brandId: brand.id,
          name: name.trim() === '' ? DEFAULT_PIPELINE_NAME[kind] : name.trim(),
          key,
          kind,
        });
        setName('');
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          aria-label={`New pipeline for ${brand.name}`}
          placeholder="Pipeline name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-7"
        />
        <NativeSelect
          aria-label="Pipeline kind"
          value={kind}
          onChange={(event) => setKind(asKind(event.target.value))}
          className="h-7"
        >
          {PIPELINE_KINDS.map((entry) => (
            <option key={entry} value={entry}>
              {entry === 'people' ? 'Prospecting' : 'Deals'}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" size="sm">
          Add pipeline {key}
        </Button>
      </div>
      {refused.error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {refused.error}
        </p>
      )}
    </form>
  );
}

function BrandItem({
  brand,
  allowed,
  fallbackFocus,
}: {
  readonly brand: BrandRow;
  readonly allowed: boolean;
  readonly fallbackFocus: () => HTMLElement | null;
}) {
  const workspace = useWorkspace();
  const update = useUpdateBrand();
  const archive = useArchiveBrand();
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const item = useRef<HTMLLIElement | null>(null);
  const pipelines = workspace.pipelinesOf(brand.id);

  const keep = () => {
    setConfirming(false);
    trigger.current?.focus();
  };

  return (
    <li
      ref={item}
      className="flex flex-col gap-2 rounded-lg border border-border p-4"
      data-brand={brand.name}
    >
      <div className="flex items-center gap-2">
        <BrandDot color={brand.color} />
        <h2 className="font-medium text-text">{brand.name}</h2>
        {allowed ? (
          <Button
            ref={trigger}
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setConfirming(true)}
          >
            Archive
          </Button>
        ) : null}
      </div>
      {allowed ? (
        <>
          <dl className="flex flex-col">
            <EditableField
              label="Name"
              value={brand.name}
              required
              onSave={(name) => update.mutate({ brand, patch: { name } })}
            />
            <EditableField
              label="Domain"
              value={brand.domain ?? ''}
              onSave={(domain) =>
                update.mutate({ brand, patch: { domain: domain === '' ? null : domain } })
              }
            />
          </dl>
          <ColorPicker
            value={brand.color}
            onChange={(color) => update.mutate({ brand, patch: { color } })}
          />
        </>
      ) : null}
      <ul className="flex flex-col">
        {pipelines.map((pipeline) => (
          <li key={pipeline.id}>
            <Link
              href={`/settings/pipelines/${pipeline.id}`}
              className={cn(
                'flex h-7 items-center gap-2 rounded-md px-1 text-dense text-text',
                navRowHover,
              )}
            >
              {pipeline.name} <span className="font-mono text-faint">{pipeline.key}</span>
            </Link>
          </li>
        ))}
      </ul>
      {allowed ? <NewPipelineForm brand={brand} /> : null}
      {confirming ? (
        <ArchiveConfirm
          title={`Archive ${brand.name}`}
          onConfirm={() => {
            focusNeighbourOf(item.current, fallbackFocus());
            archive.mutate(brand);
          }}
          onCancel={keep}
        >
          Archive {brand.name}? Its pipelines, stages, pipeline fields and saved views leave every
          list, and this cannot be undone here. Archiving is refused while a lead is open or on
          hold.
        </ArchiveConfirm>
      ) : null}
    </li>
  );
}

function BrandsBody() {
  const workspace = useWorkspace();
  const allowed = useCan('pipeline:manage');
  const heading = useRef<HTMLHeadingElement | null>(null);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 ref={heading} tabIndex={-1} className="font-medium text-lg text-text outline-none">
          Brands
        </h1>
        <p className="text-muted text-dense">
          Each brand has its own pipelines, stages and playbook.
        </p>
      </header>
      {allowed ? <NewBrandForm /> : <RoleNotice what="brands" permission="pipeline:manage" />}
      <ul className="flex flex-col gap-3">
        {workspace.brands.map((brand) => (
          <BrandItem
            key={brand.id}
            brand={brand}
            allowed={allowed}
            fallbackFocus={() => heading.current}
          />
        ))}
      </ul>
    </div>
  );
}

export function BrandsPanel() {
  return (
    <SettingsGate title="Could not load brands">
      <BrandsBody />
    </SettingsGate>
  );
}
