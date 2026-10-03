'use client';

import type { FieldObject } from '@gravity/shared/constants';
import type {
  BrandRow,
  FieldDefinitionRow,
  MemberRow,
  PipelineRow,
  SavedViewRow,
  StageRow,
} from '@gravity/shared/records';
import { useMemo } from 'react';
import { useBootstrap } from '@/lib/query/use-bootstrap.ts';

export interface WorkspaceData {
  readonly ready: boolean;
  readonly userId: string;
  readonly brands: readonly BrandRow[];
  readonly pipelines: readonly PipelineRow[];
  readonly members: readonly MemberRow[];
  readonly savedViews: readonly SavedViewRow[];
  readonly brandById: ReadonlyMap<string, BrandRow>;
  readonly pipelineById: ReadonlyMap<string, PipelineRow>;
  readonly pipelineByKey: ReadonlyMap<string, PipelineRow>;
  readonly stageById: ReadonlyMap<string, StageRow>;
  readonly memberByUserId: ReadonlyMap<string, MemberRow>;
  readonly stagesOf: (pipelineId: string) => readonly StageRow[];
  readonly pipelinesOf: (brandId: string) => readonly PipelineRow[];
  readonly fieldsFor: (
    object: FieldObject,
    pipelineId: string | null,
  ) => readonly FieldDefinitionRow[];
  readonly allFields: readonly FieldDefinitionRow[];
}

export function useWorkspace(): WorkspaceData {
  const { data } = useBootstrap();
  return useMemo(() => {
    const brands = data?.brands ?? [];
    const pipelines = data?.pipelines ?? [];
    const stages = [...(data?.stages ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    const fields = data?.fields ?? [];
    const members = data?.members ?? [];
    return {
      ready: data !== undefined,
      userId: data?.me.userId ?? '',
      brands,
      pipelines,
      members,
      savedViews: data?.savedViews ?? [],
      brandById: new Map(brands.map((brand) => [brand.id, brand])),
      pipelineById: new Map(pipelines.map((pipeline) => [pipeline.id, pipeline])),
      pipelineByKey: new Map(pipelines.map((pipeline) => [pipeline.key, pipeline])),
      stageById: new Map(stages.map((stage) => [stage.id, stage])),
      memberByUserId: new Map(members.map((member) => [member.userId, member])),
      stagesOf: (pipelineId) => stages.filter((stage) => stage.pipelineId === pipelineId),
      pipelinesOf: (brandId) => pipelines.filter((pipeline) => pipeline.brandId === brandId),
      fieldsFor: (object, pipelineId) =>
        fields.filter(
          (field) =>
            field.object === object &&
            (field.pipelineId === null || field.pipelineId === pipelineId),
        ),
      allFields: fields,
    };
  }, [data]);
}
