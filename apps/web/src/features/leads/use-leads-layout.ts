'use client';

import type { ViewPreferenceRow } from '@gravity/shared/records';
import type { ViewLayout } from '@gravity/shared/validators';
import { useCallback, useRef, useState } from 'react';
import { apiFetch } from '@/lib/query/fetcher.ts';
import { type Bootstrap, preferenceEnvelopeSchema } from '@/lib/query/schemas.ts';
import { useBootstrap } from '@/lib/query/use-bootstrap.ts';
import { useBootstrapMutation } from '@/lib/query/use-bootstrap-mutation.ts';

export const LEADS_LAYOUT_PAGE = 'leads';

interface LayoutRequest {
  readonly preference: ViewPreferenceRow;
  readonly sequence: number;
}

function withPreference(bootstrap: Bootstrap, preference: ViewPreferenceRow): Bootstrap {
  return {
    ...bootstrap,
    viewPreferences: [
      ...bootstrap.viewPreferences.filter(
        (entry) => !(entry.page === preference.page && entry.scope === preference.scope),
      ),
      preference,
    ],
  };
}

export function savedLeadsLayout(
  preferences: readonly ViewPreferenceRow[] | undefined,
  pipelineId: string,
): ViewLayout {
  return (
    preferences?.find((entry) => entry.page === LEADS_LAYOUT_PAGE && entry.scope === pipelineId)
      ?.layout ?? 'list'
  );
}

export function useLeadsLayout(pipelineId: string): {
  layout: ViewLayout;
  toggle: () => void;
} {
  const { data } = useBootstrap();
  const saved = savedLeadsLayout(data?.viewPreferences, pipelineId);
  const latest = useRef(0);
  const [requested, setRequested] = useState<LayoutRequest | null>(null);
  const current = requested?.preference.scope === pipelineId ? requested : null;
  const layout = current?.preference.layout ?? saved;
  const save = useBootstrapMutation<LayoutRequest, LayoutRequest>({
    mutationFn: async (request) => {
      const { preference } = await apiFetch('/api/view-preferences', preferenceEnvelopeSchema, {
        method: 'PUT',
        body: request.preference,
      });
      return { preference, sequence: request.sequence };
    },
    optimistic: (bootstrap, request) => withPreference(bootstrap, request.preference),
    settle: (bootstrap, result) =>
      result.sequence === latest.current ? withPreference(bootstrap, result.preference) : bootstrap,
    failure: () => 'Could not remember the layout',
  });
  const { mutate } = save;

  const toggle = useCallback(() => {
    latest.current += 1;
    const request: LayoutRequest = {
      sequence: latest.current,
      preference: {
        page: LEADS_LAYOUT_PAGE,
        scope: pipelineId,
        layout: layout === 'list' ? 'board' : 'list',
        display: {},
      },
    };
    setRequested(request);
    mutate(request, {
      onSettled: () =>
        setRequested((shown) => (shown?.sequence === request.sequence ? null : shown)),
    });
  }, [layout, pipelineId, mutate]);

  return { layout, toggle };
}
