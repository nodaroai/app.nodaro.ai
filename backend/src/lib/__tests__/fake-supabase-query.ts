/**
 * A chainable stand-in for a Supabase query builder, for tests that need to
 * see WHICH filters a query carried, not just its result.
 *
 * Every builder call (`select`, `eq`, `is`, `in`, `insert`, `upsert`, …) is
 * recorded on the query and returns the same builder; awaiting the builder, or
 * calling `single` / `maybeSingle`, answers with `respond(query)`.
 */
export interface RecordedQuery {
  readonly table: string
  readonly ops: Array<{ readonly m: string; readonly a: readonly unknown[] }>
}

export type QueryResult = { data: unknown; error: unknown }

export function has(q: RecordedQuery, m: string, ...a: unknown[]): boolean {
  return q.ops.some((op) => op.m === m && a.every((v, i) => JSON.stringify(op.a[i]) === JSON.stringify(v)))
}

export function argOf(q: RecordedQuery, m: string): readonly unknown[] | undefined {
  return q.ops.find((op) => op.m === m)?.a
}

export function makeFakeFrom(log: RecordedQuery[], respond: (q: RecordedQuery) => QueryResult) {
  return (table: string) => {
    const q: RecordedQuery = { table, ops: [] }
    log.push(q)
    const proxy: unknown = new Proxy({}, {
      get(_target, prop) {
        if (prop === "then") {
          return (res: (v: QueryResult) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve().then(() => respond(q)).then(res, rej)
        }
        if (prop === "single" || prop === "maybeSingle") {
          return () => Promise.resolve().then(() => respond(q))
        }
        return (...a: unknown[]) => {
          q.ops.push({ m: String(prop), a })
          return proxy
        }
      },
    })
    return proxy
  }
}
