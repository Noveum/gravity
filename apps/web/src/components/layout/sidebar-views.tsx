'use client';

import type { SavedViewRow } from '@gravity/shared/records';
import { Layers } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useWorkspace, type WorkspaceData } from '@/features/workspace/use-workspace.ts';
import { cn } from '@/lib/cn.ts';
import { navRowHover } from '@/lib/interaction.ts';
import { leadsHref } from '@/lib/navigation.ts';
import { SidebarSection } from './sidebar-section.tsx';

export interface SidebarViewsProps {
  readonly collapsed: boolean;
  readonly touch: boolean;
  readonly onNavigate: (() => void) | null;
}

function listPathFor(view: SavedViewRow, workspace: WorkspaceData): string | null {
  if (view.object === 'person') return '/people';
  if (view.object === 'company') return '/companies';
  const pipeline =
    view.pipelineId === null ? workspace.pipelines[0] : workspace.pipelineById.get(view.pipelineId);
  return pipeline === undefined ? null : leadsHref(pipeline.key);
}

export function SidebarViews({ collapsed, touch, onNavigate }: SidebarViewsProps) {
  const workspace = useWorkspace();
  const pathname = usePathname();
  const openViewId = useSearchParams().get('view');
  if (collapsed || workspace.savedViews.length === 0) return null;
  return (
    <SidebarSection title="Views">
      {workspace.savedViews.map((view) => {
        const path = listPathFor(view, workspace);
        if (path === null) return null;
        const active = openViewId === view.id && pathname.toUpperCase() === path.toUpperCase();
        return (
          <Link
            key={view.id}
            href={`${path}?view=${encodeURIComponent(view.id)}`}
            aria-current={active ? 'page' : undefined}
            {...(onNavigate === null ? {} : { onClick: onNavigate })}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 text-dense',
              touch ? 'h-11' : 'h-7',
              active ? 'bg-surface-2 font-medium text-text' : cn('text-muted', navRowHover),
            )}
          >
            <Layers className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{view.name}</span>
          </Link>
        );
      })}
    </SidebarSection>
  );
}
