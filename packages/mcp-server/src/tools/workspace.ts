import {
  getOrganization,
  listBrands,
  listCurrentPlaybooks,
  listFieldDefinitions,
  listMembers,
  listPipelines,
  listSavedViews,
  listStages,
  memberRowOf,
} from '@gravity/core';
import type { FieldDefinitionRow } from '@gravity/shared/records';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './index.ts';
import { defineTool } from './support.ts';

const FILTER_EXAMPLE =
  '{"kind":"group","combinator":"and","children":[{"kind":"condition","property":"stage","operator":"in","values":["<stage id>"]}]}';

function fieldView(field: FieldDefinitionRow) {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    options: field.options.map((option) => option.value),
    description: field.description,
    example: field.example,
  };
}

function fieldPhrase(field: FieldDefinitionRow): string {
  const options =
    field.options.length === 0 ? '' : `: ${field.options.map((option) => option.value).join(', ')}`;
  return `${field.key} (${field.type}${options})`;
}

function fieldsLine(label: string, fields: readonly FieldDefinitionRow[]): string[] {
  return fields.length === 0 ? [] : [`${label}: ${fields.map(fieldPhrase).join('; ')}`];
}

export function registerWorkspaceTools(server: McpServer, context: ToolContext): void {
  const { principal, links } = context;
  defineTool(
    server,
    {
      name: 'describe_workspace',
      title: 'Describe the workspace',
      description:
        'Brands with their current playbook, pipelines with keys, stages and lead fields, person and company fields, members, and the saved views you can see. Call this first; stage ids, member ids and view ids from here are what list_leads filters take.',
      scope: 'read',
      inputSchema: {},
    },
    async () => {
      const [organization, brands, pipelines, stages, fields, members, views, playbooks] =
        await Promise.all([
          getOrganization(principal.organizationId),
          listBrands(principal),
          listPipelines(principal),
          listStages(principal),
          listFieldDefinitions(principal),
          listMembers(principal),
          listSavedViews(principal),
          listCurrentPlaybooks(principal),
        ]);
      const pipelineKeys = new Map(pipelines.map((pipeline) => [pipeline.id, pipeline.key]));
      const playbookOf = new Map(playbooks.map((playbook) => [playbook.brandId, playbook]));
      const leadFieldsOf = (pipelineId: string) =>
        fields.filter((field) => field.object === 'lead' && field.pipelineId === pipelineId);
      const brandViews = brands.map((brand) => {
        const playbook = playbookOf.get(brand.id);
        return {
          id: brand.id,
          name: brand.name,
          domain: brand.domain,
          color: brand.color,
          playbook:
            playbook === undefined ? null : { version: playbook.version, body: playbook.body },
          pipelines: pipelines
            .filter((pipeline) => pipeline.brandId === brand.id)
            .map((pipeline) => ({
              id: pipeline.id,
              key: pipeline.key,
              name: pipeline.name,
              kind: pipeline.kind,
              url: links.pipeline(pipeline.key),
              stages: stages
                .filter((stage) => stage.pipelineId === pipeline.id)
                .sort((left, right) => left.sortOrder - right.sortOrder)
                .map((stage) => ({ id: stage.id, name: stage.name, category: stage.category })),
              fields: leadFieldsOf(pipeline.id).map(fieldView),
            })),
        };
      });
      const memberViews = members.map(memberRowOf).map((member) => ({
        userId: member.userId,
        name: member.name,
        email: member.email,
        role: member.role,
        isAgent: member.isAgent,
      }));
      const viewViews = views.map((view) => ({
        id: view.id,
        name: view.name,
        object: view.object,
        pipelineKey: view.pipelineId === null ? null : (pipelineKeys.get(view.pipelineId) ?? null),
        visibility: view.visibility,
        filter: view.filter,
      }));
      const personFields = fields.filter((field) => field.object === 'person');
      const companyFields = fields.filter((field) => field.object === 'company');
      const lines = [
        `Workspace ${organization.name} (${organization.slug}) ${links.app}`,
        `You are ${principal.role}.`,
        ...brandViews.flatMap((brand) => [
          `Brand ${brand.name}${brand.playbook === null ? '' : `, playbook v${brand.playbook.version}`}`,
          ...brand.pipelines.flatMap((pipeline) => [
            `  Pipeline ${pipeline.key} ${pipeline.name} (${pipeline.kind}) ${pipeline.url}`,
            `    Stages: ${pipeline.stages.map((stage) => `${stage.name} [${stage.category}] ${stage.id}`).join('; ')}`,
            ...fieldsLine('    Lead fields', leadFieldsOf(pipeline.id)),
          ]),
        ]),
        ...fieldsLine('Person fields', personFields),
        ...fieldsLine('Company fields', companyFields),
        `Members: ${memberViews.map((member) => `${member.name} <${member.email}> ${member.role} ${member.userId}`).join('; ')}`,
        ...viewViews.map(
          (view) =>
            `Saved view ${view.name} (${view.object}${view.pipelineKey === null ? '' : `, ${view.pipelineKey}`}, ${view.visibility}) ${view.id}`,
        ),
        `Filters use this shape: ${FILTER_EXAMPLE}`,
      ];
      return {
        text: lines.join('\n'),
        data: {
          workspace: {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            url: links.app,
          },
          me: { userId: principal.userId, role: principal.role },
          brands: brandViews,
          fields: { person: personFields.map(fieldView), company: companyFields.map(fieldView) },
          members: memberViews,
          savedViews: viewViews,
        },
      };
    },
  );
}
