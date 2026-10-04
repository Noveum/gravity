'use client';

import type {
  BrandColor,
  FieldObject,
  FieldType,
  PipelineKind,
  StageCategory,
} from '@gravity/shared/constants';
import type { BrandRow, FieldDefinitionRow, PipelineRow, StageRow } from '@gravity/shared/records';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast.tsx';
import { upsertById, withoutId, withoutPipelines } from './bootstrap-cache.ts';
import { apiFetch } from './fetcher.ts';
import { dropRecordLeadsOfPipelines } from './lead-cache.ts';
import {
  type Bootstrap,
  brandCreatedSchema,
  brandEnvelopeSchema,
  fieldEnvelopeSchema,
  pipelineCreatedSchema,
  pipelineEnvelopeSchema,
  stageEnvelopeSchema,
  stagesEnvelopeSchema,
} from './schemas.ts';
import { type ServedRow, useBootstrapMutation } from './use-bootstrap-mutation.ts';

export interface Refusable<TInput> {
  readonly onRefused?: (input: TInput, message: string) => boolean;
}

function upsertAll<T extends { readonly id: string }>(list: readonly T[], rows: readonly T[]): T[] {
  const ids = new Set(rows.map((row) => row.id));
  return [...list.filter((row) => !ids.has(row.id)), ...rows];
}

function servedBrand(brand: BrandRow): ServedRow {
  return { model: 'brand', id: brand.id, syncId: brand.syncId };
}

function servedPipeline(pipeline: PipelineRow): ServedRow {
  return { model: 'pipeline', id: pipeline.id, syncId: pipeline.syncId };
}

function servedStage(stage: StageRow): ServedRow {
  return { model: 'stage', id: stage.id, syncId: stage.syncId };
}

function servedField(field: FieldDefinitionRow): ServedRow {
  return { model: 'field_definition', id: field.id, syncId: field.syncId };
}

function withoutBrand(bootstrap: Bootstrap, brand: BrandRow): Bootstrap {
  const pipelineIds = bootstrap.pipelines
    .filter((pipeline) => pipeline.brandId === brand.id)
    .map((pipeline) => pipeline.id);
  return withoutPipelines(
    { ...bootstrap, brands: withoutId(bootstrap.brands, brand.id) },
    pipelineIds,
  );
}

export interface BrandDraft {
  readonly name: string;
  readonly domain: string | null;
  readonly color: BrandColor;
  readonly pipelineKey: string;
}

export function useCreateBrand(refusable: Refusable<BrandDraft> = {}) {
  return useBootstrapMutation({
    ...refusable,
    mutationFn: (input: BrandDraft) =>
      apiFetch('/api/brands', brandCreatedSchema, { method: 'POST', body: input }),
    settle: (bootstrap, result) => ({
      ...bootstrap,
      brands: upsertById(bootstrap.brands, result.brand),
      pipelines: upsertById(bootstrap.pipelines, result.pipeline),
      stages: upsertAll(bootstrap.stages, result.stages),
    }),
    served: (result) => [
      servedBrand(result.brand),
      servedPipeline(result.pipeline),
      ...result.stages.map(servedStage),
    ],
    failure: (input) => `Could not create ${input.name}`,
  });
}

export interface BrandEdit {
  readonly brand: BrandRow;
  readonly patch: Partial<Pick<BrandRow, 'name' | 'domain' | 'color' | 'signature'>>;
}

export function useUpdateBrand() {
  return useBootstrapMutation({
    mutationFn: async ({ brand, patch }: BrandEdit) =>
      (
        await apiFetch(`/api/brands/${brand.id}`, brandEnvelopeSchema, {
          method: 'PATCH',
          body: patch,
        })
      ).brand,
    optimistic: (bootstrap, { brand, patch }) => ({
      ...bootstrap,
      brands: upsertById(bootstrap.brands, { ...brand, ...patch }),
    }),
    settle: (bootstrap, brand) => ({ ...bootstrap, brands: upsertById(bootstrap.brands, brand) }),
    served: (brand) => [servedBrand(brand)],
    failure: ({ brand }) => `Could not update ${brand.name}`,
  });
}

export function useArchiveBrand() {
  return useBootstrapMutation({
    mutationFn: async (brand: BrandRow) =>
      (await apiFetch(`/api/brands/${brand.id}`, brandEnvelopeSchema, { method: 'DELETE' })).brand,
    optimistic: withoutBrand,
    settle: withoutBrand,
    served: (brand) => [servedBrand(brand)],
    failure: (brand) => `Could not archive ${brand.name}`,
  });
}

export interface PipelineDraft {
  readonly brandId: string;
  readonly name: string;
  readonly key: string;
  readonly kind: PipelineKind;
}

export function useCreatePipeline(refusable: Refusable<PipelineDraft> = {}) {
  return useBootstrapMutation({
    ...refusable,
    mutationFn: (input: PipelineDraft) =>
      apiFetch('/api/pipelines', pipelineCreatedSchema, { method: 'POST', body: input }),
    settle: (bootstrap, result) => ({
      ...bootstrap,
      pipelines: upsertById(bootstrap.pipelines, result.pipeline),
      stages: upsertAll(bootstrap.stages, result.stages),
    }),
    served: (result) => [servedPipeline(result.pipeline), ...result.stages.map(servedStage)],
    failure: (input) => `Could not create ${input.name}`,
  });
}

export interface PipelineEdit {
  readonly pipeline: PipelineRow;
  readonly patch: Partial<Pick<PipelineRow, 'name'>>;
}

export function useUpdatePipeline() {
  return useBootstrapMutation({
    mutationFn: async ({ pipeline, patch }: PipelineEdit) =>
      (
        await apiFetch(`/api/pipelines/${pipeline.id}`, pipelineEnvelopeSchema, {
          method: 'PATCH',
          body: patch,
        })
      ).pipeline,
    optimistic: (bootstrap, { pipeline, patch }) => ({
      ...bootstrap,
      pipelines: upsertById(bootstrap.pipelines, { ...pipeline, ...patch }),
    }),
    settle: (bootstrap, pipeline) => ({
      ...bootstrap,
      pipelines: upsertById(bootstrap.pipelines, pipeline),
    }),
    served: (pipeline) => [servedPipeline(pipeline)],
    failure: ({ pipeline }) => `Could not update ${pipeline.name}`,
  });
}

export interface ArchivePipelineOptions extends Refusable<PipelineRow> {
  readonly afterSuccess?: (pipeline: PipelineRow) => void;
}

export function useArchivePipeline(options: ArchivePipelineOptions = {}) {
  const client = useQueryClient();
  return useBootstrapMutation({
    ...(options.onRefused === undefined ? {} : { onRefused: options.onRefused }),
    afterSuccess: (pipeline: PipelineRow) => {
      dropRecordLeadsOfPipelines(client, [pipeline.id]);
      options.afterSuccess?.(pipeline);
    },
    mutationFn: async (pipeline: PipelineRow) =>
      (
        await apiFetch(`/api/pipelines/${pipeline.id}`, pipelineEnvelopeSchema, {
          method: 'DELETE',
        })
      ).pipeline,
    optimistic: (bootstrap, pipeline) => withoutPipelines(bootstrap, [pipeline.id]),
    settle: (bootstrap, pipeline) => withoutPipelines(bootstrap, [pipeline.id]),
    served: (pipeline) => [servedPipeline(pipeline)],
    failure: (pipeline) => `Could not archive ${pipeline.name}`,
  });
}

export interface StageDraft {
  readonly pipelineId: string;
  readonly name: string;
  readonly category: StageCategory;
}

export function useCreateStage(refusable: Refusable<StageDraft> = {}) {
  return useBootstrapMutation({
    ...refusable,
    mutationFn: async (input: StageDraft) =>
      (await apiFetch('/api/stages', stageEnvelopeSchema, { method: 'POST', body: input })).stage,
    settle: (bootstrap, stage) => ({ ...bootstrap, stages: upsertById(bootstrap.stages, stage) }),
    served: (stage) => [servedStage(stage)],
    failure: (input) => `Could not add ${input.name}`,
  });
}

export interface StageEdit {
  readonly stage: StageRow;
  readonly patch: Partial<Pick<StageRow, 'name' | 'category'>>;
}

export function useUpdateStage() {
  return useBootstrapMutation({
    mutationFn: async ({ stage, patch }: StageEdit) =>
      (
        await apiFetch(`/api/stages/${stage.id}`, stageEnvelopeSchema, {
          method: 'PATCH',
          body: patch,
        })
      ).stage,
    optimistic: (bootstrap, { stage, patch }) => ({
      ...bootstrap,
      stages: upsertById(bootstrap.stages, { ...stage, ...patch }),
    }),
    settle: (bootstrap, stage) => ({ ...bootstrap, stages: upsertById(bootstrap.stages, stage) }),
    served: (stage) => [servedStage(stage)],
    failure: ({ stage }) => `Could not update ${stage.name}`,
  });
}

export interface StageOrder {
  readonly pipelineId: string;
  readonly stageIds: readonly string[];
}

export function useReorderStages(pipelineId: string) {
  return useBootstrapMutation({
    scope: { id: `reorder-${pipelineId}` },
    mutationFn: async (input: StageOrder) =>
      (await apiFetch('/api/stages/reorder', stagesEnvelopeSchema, { method: 'POST', body: input }))
        .stages,
    optimistic: (bootstrap, input) => ({
      ...bootstrap,
      stages: bootstrap.stages.map((stage) => {
        const index = input.stageIds.indexOf(stage.id);
        return index === -1 ? stage : { ...stage, sortOrder: index };
      }),
    }),
    settle: (bootstrap, stages) => ({ ...bootstrap, stages: upsertAll(bootstrap.stages, stages) }),
    served: (stages) => stages.map(servedStage),
    failure: () => 'Could not reorder the stages',
  });
}

export function useUnarchiveStage() {
  return useBootstrapMutation({
    mutationFn: async (stage: StageRow) =>
      (await apiFetch(`/api/stages/${stage.id}/unarchive`, stageEnvelopeSchema, { method: 'POST' }))
        .stage,
    optimistic: (bootstrap, stage) => ({
      ...bootstrap,
      stages: upsertById(bootstrap.stages, { ...stage, archivedAt: null }),
    }),
    settle: (bootstrap, stage) => ({ ...bootstrap, stages: upsertById(bootstrap.stages, stage) }),
    served: (stage) => [servedStage(stage)],
    failure: (stage) => `Could not restore ${stage.name}`,
  });
}

export function useArchiveStage() {
  const { toast } = useToast();
  const restore = useUnarchiveStage();
  return useBootstrapMutation({
    mutationFn: async (stage: StageRow) =>
      (await apiFetch(`/api/stages/${stage.id}`, stageEnvelopeSchema, { method: 'DELETE' })).stage,
    optimistic: (bootstrap, stage) => ({
      ...bootstrap,
      stages: withoutId(bootstrap.stages, stage.id),
    }),
    settle: (bootstrap, stage) => ({ ...bootstrap, stages: withoutId(bootstrap.stages, stage.id) }),
    served: (stage) => [servedStage(stage)],
    afterSuccess: (stage) =>
      toast({
        title: `Archived ${stage.name}`,
        action: { label: 'Undo', onSelect: () => restore.mutate(stage) },
      }),
    failure: (stage) => `Could not archive ${stage.name}`,
  });
}

export interface FieldDraft {
  readonly object: FieldObject;
  readonly pipelineId: string | null;
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

export function useCreateField(refusable: Refusable<FieldDraft> = {}) {
  return useBootstrapMutation({
    ...refusable,
    mutationFn: async (input: FieldDraft) =>
      (await apiFetch('/api/fields', fieldEnvelopeSchema, { method: 'POST', body: input })).field,
    settle: (bootstrap, field) => ({ ...bootstrap, fields: upsertById(bootstrap.fields, field) }),
    served: (field) => [servedField(field)],
    failure: (input) => `Could not create ${input.label}`,
  });
}

export interface FieldEdit {
  readonly field: FieldDefinitionRow;
  readonly patch: Partial<
    Pick<FieldDefinitionRow, 'label' | 'options' | 'description' | 'example'>
  >;
}

export function useUpdateField() {
  return useBootstrapMutation({
    mutationFn: async ({ field, patch }: FieldEdit) =>
      (
        await apiFetch(`/api/fields/${field.id}`, fieldEnvelopeSchema, {
          method: 'PATCH',
          body: patch,
        })
      ).field,
    optimistic: (bootstrap, { field, patch }) => ({
      ...bootstrap,
      fields: upsertById(bootstrap.fields, { ...field, ...patch }),
    }),
    settle: (bootstrap, field) => ({ ...bootstrap, fields: upsertById(bootstrap.fields, field) }),
    served: (field) => [servedField(field)],
    failure: ({ field }) => `Could not update ${field.label}`,
  });
}

export function useUnarchiveField() {
  return useBootstrapMutation({
    mutationFn: async (field: FieldDefinitionRow) =>
      (await apiFetch(`/api/fields/${field.id}/unarchive`, fieldEnvelopeSchema, { method: 'POST' }))
        .field,
    optimistic: (bootstrap, field) => ({
      ...bootstrap,
      fields: upsertById(bootstrap.fields, { ...field, archivedAt: null }),
    }),
    settle: (bootstrap, field) => ({ ...bootstrap, fields: upsertById(bootstrap.fields, field) }),
    served: (field) => [servedField(field)],
    failure: (field) => `Could not restore ${field.label}`,
  });
}

export function useArchiveField() {
  const { toast } = useToast();
  const restore = useUnarchiveField();
  return useBootstrapMutation({
    mutationFn: async (field: FieldDefinitionRow) =>
      (await apiFetch(`/api/fields/${field.id}`, fieldEnvelopeSchema, { method: 'DELETE' })).field,
    optimistic: (bootstrap, field) => ({
      ...bootstrap,
      fields: withoutId(bootstrap.fields, field.id),
    }),
    settle: (bootstrap, field) => ({ ...bootstrap, fields: withoutId(bootstrap.fields, field.id) }),
    served: (field) => [servedField(field)],
    afterSuccess: (field) =>
      toast({
        title: `Archived ${field.label}`,
        action: { label: 'Undo', onSelect: () => restore.mutate(field) },
      }),
    failure: (field) => `Could not archive ${field.label}`,
  });
}
