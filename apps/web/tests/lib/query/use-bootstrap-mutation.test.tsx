import { describe, expect, test } from 'bun:test';
import type { BrandRow } from '@gravity/shared/records';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { upsertById } from '@/lib/query/bootstrap-cache.ts';
import { apiFetch } from '@/lib/query/fetcher.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import { type Bootstrap, brandEnvelopeSchema } from '@/lib/query/schemas.ts';
import { useBootstrapMutation } from '@/lib/query/use-bootstrap-mutation.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { installDeferredFetch } from '../../support/deferred-fetch.ts';
import { mutationClient, wrapperFor } from '../../support/query-wrapper.tsx';

const server = installDeferredFetch();

interface RenameBrand {
  readonly id: string;
  readonly name: string;
}

function useRenameBrand() {
  return useBootstrapMutation<RenameBrand, BrandRow>({
    mutationFn: async (input) =>
      (
        await apiFetch(`/api/brands/${input.id}`, brandEnvelopeSchema, {
          method: 'PATCH',
          body: { name: input.name },
        })
      ).brand,
    optimistic: (bootstrap, input) => ({
      ...bootstrap,
      brands: bootstrap.brands.map((brand) =>
        brand.id === input.id ? { ...brand, name: input.name } : brand,
      ),
    }),
    settle: (bootstrap, brand) => ({ ...bootstrap, brands: upsertById(bootstrap.brands, brand) }),
    failure: (input) => `Could not rename the brand to ${input.name}`,
  });
}

function setup() {
  const client = mutationClient();
  client.setQueryData(queryKeys.bootstrap, bootstrapFixture());
  const brandName = () => client.getQueryData<Bootstrap>(queryKeys.bootstrap)?.brands[0]?.name;
  return { brandName, ...renderHook(() => useRenameBrand(), { wrapper: wrapperFor(client) }) };
}

const [yodu] = bootstrapFixture().brands;

describe('useBootstrapMutation', () => {
  test('applies the optimistic change while pending and settles with the server row', async () => {
    if (yodu === undefined) throw new Error('The fixture has a brand.');
    const { brandName, result } = setup();
    act(() => {
      result.current.mutate({ id: 'b1', name: 'Yodu Labs' });
    });
    await waitFor(() => expect(brandName()).toBe('Yodu Labs'));
    await waitFor(() => expect(server.waiting()).toBe(1));
    expect(server.sent).toEqual([
      { path: '/api/brands/b1', method: 'PATCH', body: { name: 'Yodu Labs' } },
    ]);
    server.answer(200, { brand: { ...yodu, name: 'Yodu Studio', syncId: 9 } });
    await waitFor(() => expect(brandName()).toBe('Yodu Studio'));
  });

  test('restores the previous bootstrap after a refusal and Retry resends', async () => {
    const { brandName, result } = setup();
    act(() => {
      result.current.mutate({ id: 'b1', name: 'Yodu Labs' });
    });
    await waitFor(() => expect(brandName()).toBe('Yodu Labs'));
    await waitFor(() => expect(server.waiting()).toBe(1));
    server.answer(409, { error: { code: 'conflict', message: 'That name is taken.' } });
    await waitFor(() => expect(brandName()).toBe('Yodu'));
    expect(await screen.findByText('Could not rename the brand to Yodu Labs')).toBeInTheDocument();
    expect(screen.getByText('That name is taken.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(brandName()).toBe('Yodu Labs'));
    await waitFor(() => expect(server.waiting()).toBe(1));
    expect(server.sent).toHaveLength(2);
  });
});
