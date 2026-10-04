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
import { CONTEXT_TOKENS } from '@gravity/shared/constants';
import type { FieldDefinitionRow } from '@gravity/shared/records';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './index.ts';
import { defineTool } from './support.ts';

const FILTER_EXAMPLE =
  '{"kind":"group","combinator":"and","children":[{"kind":"condition","property":"stage","operator":"in","values":["<stage id>"]}]}';

const CHARS_PER_TOKEN = 4;
const TEXT_BUDGET = CONTEXT_TOKENS.default * CHARS_PER_TOKEN;
const PLAYBOOK_INDENT = '    ';
const PLAYBOOK_CUT = `${PLAYBOOK_INDENT}(playbook cut to fit ${CONTEXT_TOKENS.default} tokens; read the rest in the app)`;

interface FittedPlaybook {
  readonly body: string;
  readonly truncated: boolean;
  readonly lines: readonly string[];
}

function cutAt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const code = text.charCodeAt(limit - 1);
  const end = code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
  return text.slice(0, Math.max(0, end));
}

function indented(body: string): string[] {
  return body.length === 0 ? [] : body.split(/\r?\n/).map((line) => `${PLAYBOOK_INDENT}${line}`);
}

function textCost(lines: readonly string[]): number {
  return lines.reduce((total, line) => total + line.length + 1, 0);
}

function fitPlaybook(raw: string, share: number): FittedPlaybook {
  const body = raw.trim();
  const whole = indented(body);
  if (textCost(whole) <= share) return { body, truncated: false, lines: whole };
  const room = share - textCost([PLAYBOOK_CUT]);
  let limit = room;
  let shown = cutAt(body, limit);
  while (limit > 0 && textCost(indented(shown)) > room) {
    limit -= textCost(indented(shown)) - room;
    shown = cutAt(body, limit);
  }
  if (limit <= 0) return { body: '', truncated: true, lines: room < 0 ? [] : [PLAYBOOK_CUT] };
  return { body: shown, truncated: true, lines: [...indented(shown), PLAYBOOK_CUT] };
}

function fitPlaybooks(
  bodies: ReadonlyMap<string, string>,
  available: number,
): Map<string, FittedPlaybook> {
  const share = Math.floor(available / Math.max(1, bodies.size));
  return new Map([...bodies].map(([brandId, body]) => [brandId, fitPlaybook(body, share)]));
}

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
          playbook: playbook === undefined ? null : { version: playbook.version },
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
      const render = (playbookLinesOf: (brandId: string) => readonly string[]) => [
        `Workspace ${organization.name} (${organization.slug}) ${links.app}`,
        `You are ${principal.role}.`,
        ...brandViews.flatMap((brand) => [
          `Brand ${brand.name}${brand.playbook === null ? '' : `, playbook v${brand.playbook.version}`}`,
          ...playbookLinesOf(brand.id),
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
      const bodies = new Map(
        playbooks
          .filter((playbook) => playbook.body.trim().length > 0)
          .map((playbook) => [playbook.brandId, playbook.body]),
      );
      const fitted = fitPlaybooks(bodies, TEXT_BUDGET - render(() => []).join('\n').length);
      const text = render((brandId) => fitted.get(brandId)?.lines ?? []).join('\n');
      const brandsWithPlaybooks = brandViews.map((brand) => {
        const fit = fitted.get(brand.id);
        return brand.playbook === null
          ? brand
          : {
              ...brand,
              playbook: {
                version: brand.playbook.version,
                body: fit?.body ?? '',
                truncated: fit?.truncated ?? false,
              },
            };
      });
      return {
        text,
        data: {
          workspace: {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            url: links.app,
          },
          me: { userId: principal.userId, role: principal.role },
          brands: brandsWithPlaybooks,
          fields: { person: personFields.map(fieldView), company: companyFields.map(fieldView) },
          members: memberViews,
          savedViews: viewViews,
        },
      };
    },
  );
}
