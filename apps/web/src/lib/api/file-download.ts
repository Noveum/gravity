import { fileDownload } from '@gravity/core';
import type { Principal } from '@gravity/shared/policy';

export async function downloadResponse(
  principal: Principal | null,
  id: string,
  preview: boolean,
): Promise<Response> {
  const file = await fileDownload(principal, id, preview);
  const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
  if (file.url !== null)
    return new Response(null, { status: 302, headers: { ...headers, location: file.url } });
  return new Response(file.body, {
    headers: {
      ...headers,
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    },
  });
}
