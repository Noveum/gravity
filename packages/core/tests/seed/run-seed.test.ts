import { afterEach, describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const RUN_SEED = fileURLToPath(new URL('../../src/seed/run-seed.ts', import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

let listener: ReturnType<typeof Bun.listen> | null = null;

afterEach(() => {
  listener?.stop(true);
  listener = null;
});

function countingListener(): { readonly port: number; readonly connections: () => number } {
  let connections = 0;
  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(socket) {
        connections += 1;
        socket.end();
      },
      data() {
        return undefined;
      },
    },
  });
  listener = server;
  return { port: server.port, connections: () => connections };
}

async function runSeed(env: Record<string, string>): Promise<{ code: number; stderr: string }> {
  const child = Bun.spawn(['bun', RUN_SEED], {
    cwd: PACKAGE_ROOT,
    env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { code, stderr };
}

describe('run-seed', () => {
  test('refuses production and an ambiguous authority before it opens any connection', async () => {
    const database = countingListener();
    const local = `postgres://gravity:gravity@127.0.0.1:${database.port}/gravity`;
    const production = await runSeed({ DATABASE_URL: local, NODE_ENV: ' Production ' });
    expect(production.code).toBe(1);
    expect(production.stderr).toContain('NODE_ENV is production');
    const ambiguous = await runSeed({
      DATABASE_URL: `postgres://gravity:gravity@db.remote.io@127.0.0.1:${database.port}/gravity`,
      NODE_ENV: 'development',
    });
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.stderr).toContain('--allow-remote');
    expect(database.connections()).toBe(0);
  });
});
