import { db, sql } from '@gravity/db';
import postgres from 'postgres';

export async function writerBackendPid(): Promise<number> {
  const [row] = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
  const pid = Number(row?.['pid']);
  if (!Number.isInteger(pid)) throw new Error('could not read the writer backend pid');
  return pid;
}

export async function waitForLockWaiter(
  observer: postgres.Sql,
  writerPid: number,
  holderPid: number,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await observer<{ waiting: number }[]>`
      select count(*)::int as waiting from pg_stat_activity
      where pid = ${writerPid} and ${holderPid} = any(pg_blocking_pids(pid))`;
    if ((row?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('the write never waited on the rival lock');
}

export async function racingRival<T>(
  hold: (tx: postgres.TransactionSql) => Promise<unknown>,
  write: () => Promise<T>,
  afterRelease: (tx: postgres.TransactionSql) => Promise<unknown> = async () => undefined,
): Promise<T> {
  const rival = postgres(String(process.env['DATABASE_URL']), {
    max: 2,
    onnotice: () => undefined,
  });
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = (): void => undefined;
  const taken = new Promise<void>((resolve) => {
    held = resolve;
  });
  const writerPid = await writerBackendPid();
  let holderPid = 0;
  const holder = rival.begin(async (tx) => {
    const [me] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    holderPid = me?.pid ?? 0;
    await hold(tx);
    held();
    await released;
    await afterRelease(tx);
  });
  let writing: Promise<{ ok: true; value: T } | { ok: false; error: unknown }> | undefined;
  try {
    await Promise.race([taken, holder]);
    writing = write().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await waitForLockWaiter(rival, writerPid, holderPid);
  } finally {
    release();
    await holder;
    await rival.end();
  }
  const outcome = await writing;
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
