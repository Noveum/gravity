import type { Database } from "../../packages/database/client";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

// PGlite has one connection. Replay a concurrent writer's committed change at
// the lock boundary so access revocation races can be tested deterministically.
export function databaseWithLockInterleave(
  database: Database,
  interleave: (tx: Transaction, sql: string) => Promise<void>,
) {
  let interleaved = false;
  const intercepted = new Proxy(database, {
    get(db, property, receiver) {
      if (property !== "transaction")
        return Reflect.get(db, property, receiver);
      return (run: Parameters<Database["transaction"]>[0]) =>
        db.transaction(async (tx) => {
          const wrapQuery = (query: object): object =>
            new Proxy(query, {
              get(builder, key, builderReceiver) {
                const member = Reflect.get(builder, key, builderReceiver);
                if (typeof member !== "function") return member;
                return (...args: unknown[]) => {
                  const result: unknown = Reflect.apply(member, builder, args);
                  if (key === "for" && !interleaved) {
                    const { sql } = Reflect.apply(
                      Reflect.get(builder, "toSQL"),
                      builder,
                      [],
                    ) as { sql: string };
                    interleaved = true;
                    return (async () => {
                      await interleave(tx, sql);
                      return await (result as PromiseLike<unknown>);
                    })();
                  }
                  return result !== null && typeof result === "object"
                    ? wrapQuery(result)
                    : result;
                };
              },
            });
          const wrapped = new Proxy(tx, {
            get(target, key, targetReceiver) {
              const member = Reflect.get(target, key, targetReceiver);
              if (key === "select")
                return (...args: unknown[]) =>
                  wrapQuery(Reflect.apply(member, target, args) as object);
              return typeof member === "function"
                ? member.bind(target)
                : member;
            },
          });
          return run(wrapped);
        });
    },
  });
  return { database: intercepted, didInterleave: () => interleaved };
}
