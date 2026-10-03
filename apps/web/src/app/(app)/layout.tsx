import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { WorkspaceCachePersistence } from '@/lib/query/persistence.tsx';
import { configuredRealtimeUrl } from '@/lib/realtime/url.ts';

export default async function AppLayout({ children }: { readonly children: ReactNode }) {
  const context = await pageContext({ allowDeleting: true });
  return (
    <AppShell
      workspace={{
        id: context.principal.organizationId,
        name: context.organizationName,
        slug: context.organizationSlug,
      }}
      user={{ id: context.principal.userId, name: context.userName, email: context.userEmail }}
      realtimeUrl={configuredRealtimeUrl()}
    >
      <WorkspaceCachePersistence
        userId={context.principal.userId}
        organizationId={context.principal.organizationId}
      />
      {children}
    </AppShell>
  );
}
