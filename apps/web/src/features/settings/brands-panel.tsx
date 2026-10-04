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
  useArchiveBrand,
  useCreateBrand,
  useCreatePipeline,
  useUpdateBrand,
} from '@/lib/query/use-config-mutations.ts';
import { ArchiveConfirm } from './archive-confirm.tsx';
import { ColorPicker } from './color-picker.tsx';
import { RoleNotice } from './role-notice.tsx';

function asKind(value: string): PipelineKind {
  return PIPELINE_KINDS.find((kind) => kind === value) ?? 'people';
}

function useTakenKeys(): ReadonlySet<string> {
  const workspace = useWorkspace();
  return useMemo(
    () => new Set(workspace.pipelines.map((pipeline) => pipeline.key)),
    [workspace.pipelines],
  );
}

function NewBrandForm() {
  const create = useCreateBrand();
  const taken = useTakenKeys();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [color, setColor] = useState<BrandColor>('blue');
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pipelineKey = key ?? (name.trim().length === 0 ? '' : derivePipelineKey(name, taken));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim().length === 0) {
      setError('Name the brand.');
      return;
    }
    if (!PIPELINE_KEY_PATTERN.test(pipelineKey)) {
      setError('Use 2 to 5 letters for the pipeline key, like YOD.');
      return;
    }
    setError(null);
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
          onChange={(event) => setKey(event.target.value.toUpperCase())}
          className="font-mono"
        />
        <ColorPicker value={color} onChange={setColor} />
      </div>
      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" className="self-start">
        Create brand
      </Button>
    </form>
  );
}

function NewPipelineForm({ brand }: { readonly brand: BrandRow }) {
  const create = useCreatePipeline();
  const taken = useTakenKeys();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PipelineKind>('people');
  const key = derivePipelineKey(`${brand.name} ${name}`, taken);
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate({
          brandId: brand.id,
          name: name.trim() === '' ? DEFAULT_PIPELINE_NAME[kind] : name.trim(),
          key,
          kind,
        });
        setName('');
      }}
    >
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
    </form>
  );
}

function BrandItem({ brand, allowed }: { readonly brand: BrandRow; readonly allowed: boolean }) {
  const workspace = useWorkspace();
  const update = useUpdateBrand();
  const archive = useArchiveBrand();
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const pipelines = workspace.pipelinesOf(brand.id);

  const keep = () => {
    setConfirming(false);
    trigger.current?.focus();
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-4" data-brand={brand.name}>
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
          onConfirm={() => archive.mutate(brand)}
          onCancel={keep}
        >
          Archive {brand.name}? Its pipelines and stages leave every list. Archiving is refused
          while a lead is open or on hold.
        </ArchiveConfirm>
      ) : null}
    </li>
  );
}

export function BrandsPanel() {
  const workspace = useWorkspace();
  const allowed = useCan('pipeline:manage');
  if (!workspace.ready) return null;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-medium text-lg text-text">Brands</h1>
        <p className="text-muted text-dense">
          Each brand has its own pipelines, stages and playbook.
        </p>
      </header>
      {allowed ? <NewBrandForm /> : <RoleNotice what="brands" permission="pipeline:manage" />}
      <ul className="flex flex-col gap-3">
        {workspace.brands.map((brand) => (
          <BrandItem key={brand.id} brand={brand} allowed={allowed} />
        ))}
      </ul>
    </div>
  );
}
