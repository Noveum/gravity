import { latestOutboxSyncId } from '@gravity/core';
import { HydrationBoundary } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { WorkspaceCachePersistence } from '@/lib/query/persistence.tsx';
import { dehydratedBootstrap } from '@/lib/query/prefetch.ts';
import { configuredRealtimeUrl } from '@/lib/realtime/url.ts';

export default async function AppLayout({ children }: { readonly children: ReactNode }) {
  const context = await pageContext({ allowDeleting: true });
  const [realtimeCursor, bootstrap] = await Promise.all([
    latestOutboxSyncId(context.principal.organizationId),
    dehydratedBootstrap(context),
  ]);
  return (
    <HydrationBoundary state={bootstrap}>
      <AppShell
        workspace={{
          id: context.principal.organizationId,
          name: context.organizationName,
          slug: context.organizationSlug,
        }}
        user={{ id: context.principal.userId, name: context.userName, email: context.userEmail }}
        realtimeUrl={configuredRealtimeUrl()}
        realtimeCursor={realtimeCursor}
      >
        <WorkspaceCachePersistence
          userId={context.principal.userId}
          organizationId={context.principal.organizationId}
        />
        {children}
      </AppShell>
    </HydrationBoundary>
  );
}
