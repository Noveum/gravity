import { beforeEach, describe, expect, test } from 'bun:test';
import { consumeRequestRateLimit, createBrand } from '@gravity/core';
import {
  createMemberPrincipal,
  createWorkspace,
  resetDatabase,
  type TestWorkspace,
} from '@gravity/core/test-support';
import { db, schema } from '@gravity/db';
import { POST } from '@/app/api/imports/preview/route.ts';
import { IMPORT_PREVIEW_RATE, importRateKey, MAX_IMPORT_REQUEST_BYTES } from '@/lib/api/imports.ts';
import { signedInAs, signedOut } from '../../../../../tests-support.ts';
import { withNativeFetch } from '../../../../support/native-fetch.ts';

let workspace: TestWorkspace;
let pipelineId = '';

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  pipelineId = (
    await createBrand({ principal: workspace.admin }, { name: 'Lumen', pipelineKey: 'LUM' })
  ).pipeline.id;
  await signedInAs(workspace.adminUser.id, workspace.organizationId);
});

function preview(body: unknown): Promise<Response> {
  return POST(
    new Request('http://localhost:3300/api/imports/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

function streamed(
  headers: Record<string, string>,
  source: UnderlyingDefaultSource<Uint8Array>,
): Request {
  return new Request('http://localhost:3300/api/imports/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: new ReadableStream<Uint8Array>(source, { highWaterMark: 0 }),
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

async function errorCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code;
}

const BODY = {
  format: 'csv',
  content: 'Name,Email\nAda Lovelace,ada@vela.example\n',
  target: 'leads',
  mapping: { Name: 'person.name', Email: 'person.email' },
};

describe('/api/imports/preview', () => {
  test('returns the dry run and writes nothing', async () => {
    const response = await preview({ ...BODY, pipelineId });
    expect(response.status).toBe(200);
    const { report } = (await response.json()) as {
      report: { totals: { created: number; leadsCreated: number } };
    };
    expect(report.totals).toMatchObject({ created: 1, leadsCreated: 1 });
    expect(await db.select().from(schema.person)).toHaveLength(0);
  });

  test('refuses a body over the cap with 413 before parsing it', async () => {
    const response = await preview('x'.repeat(MAX_IMPORT_REQUEST_BYTES + 1));
    expect(response.status).toBe(413);
    expect(await errorCode(response)).toBe('payload_too_large');
  });

  test('refuses on the declared content-length without reading the body', async () => {
    await withNativeFetch(async () => {
      let pulls = 0;
      const request = streamed(
        { 'content-length': String(MAX_IMPORT_REQUEST_BYTES + 1) },
        {
          pull(controller) {
            pulls += 1;
            controller.enqueue(new TextEncoder().encode('{}'));
          },
        },
      );
      const response = await POST(request);
      expect(response.status).toBe(413);
      expect(pulls).toBe(0);
      expect(request.bodyUsed).toBe(false);
    });
  });

  test('a chunked body over the cap with no content-length ends with 413 and is cancelled', async () => {
    await withNativeFetch(async () => {
      const chunk = new TextEncoder().encode('x'.repeat(256 * 1024));
      let pulls = 0;
      let cancelled = false;
      const request = streamed(
        {},
        {
          pull(controller) {
            pulls += 1;
            controller.enqueue(chunk);
          },
          cancel() {
            cancelled = true;
          },
        },
      );
      expect(request.headers.get('content-length')).toBeNull();
      const outcome = await Promise.race([
        POST(request).then((response) => response.status),
        Bun.sleep(3_000).then(() => 'timed out'),
      ]);
      expect(outcome).toBe(413);
      expect(cancelled).toBe(true);
      expect(pulls).toBeLessThanOrEqual(Math.ceil(MAX_IMPORT_REQUEST_BYTES / chunk.byteLength) + 2);
    });
  });

  test('refuses a body that is not UTF-8 with 415', async () => {
    await withNativeFetch(async () => {
      const head = new TextEncoder().encode('{"format":"csv","content":"Name\\n');
      const tail = new TextEncoder().encode('"}');
      const bytes = new Uint8Array([...head, 0xc3, 0x28, ...tail]);
      const response = await POST(
        new Request('http://localhost:3300/api/imports/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: bytes,
        }),
      );
      expect(response.status).toBe(415);
    });
  });

  test('refuses a body that is not JSON with 422', async () => {
    const response = await preview('{"format":');
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('validation_failed');
  });

  test('refuses a role without import rights', async () => {
    const contributor = await createMemberPrincipal(workspace, 'contributor');
    await signedInAs(contributor.userId, workspace.organizationId);
    expect((await preview({ ...BODY, pipelineId })).status).toBe(403);
  });

  test('refuses a signed out caller', async () => {
    signedOut();
    expect((await preview({ ...BODY, pipelineId })).status).toBe(401);
  });

  test('refuses a preview once the hourly budget is spent', async () => {
    for (let index = 0; index < IMPORT_PREVIEW_RATE.max; index += 1) {
      await consumeRequestRateLimit(importRateKey('preview', workspace.admin), IMPORT_PREVIEW_RATE);
    }
    const response = await preview({ ...BODY, pipelineId });
    expect(response.status).toBe(429);
    expect(await errorCode(response)).toBe('rate_limited');
  });
});
