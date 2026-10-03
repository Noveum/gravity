import postgres from 'postgres';

export async function waitForLockWaiter(observer: postgres.Sql): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await observer<{ waiting: number }[]>`
      select count(*)::int as waiting from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`;
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
  const holder = rival.begin(async (tx) => {
    await hold(tx);
    held();
    await released;
    await afterRelease(tx);
  });
  let writing: Promise<{ ok: true; value: T } | { ok: false; error: unknown }> | undefined;
  try {
    await taken;
    writing = write().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await waitForLockWaiter(rival);
  } finally {
    release();
    await holder;
    await rival.end();
  }
  const outcome = await writing;
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
