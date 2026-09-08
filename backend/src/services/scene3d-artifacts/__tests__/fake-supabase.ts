import { vi } from "vitest"

/**
 * A tiny in-memory stand-in for the PostgREST builder, for the handful of
 * sentences `db.ts` actually speaks: `select().eq().maybeSingle()`,
 * `select().in()` and `delete().eq()`.
 *
 * Chained `vi.fn()` mocks were the alternative and they encode the SHAPE of
 * the query into every test — swap two `.eq()` calls and a green test goes
 * red for no reason, while a query that forgot its owner filter stays green
 * because the mock returns whatever it was told to. Filtering real rows means
 * a missing `.eq("user_id", …)` shows up as the wrong row coming back, which
 * is the bug those filters exist to prevent.
 */
export type Row = Record<string, unknown>

export interface FakeTables {
  scene3d_deliveries?: Row[]
  scene3d_delivery_artifacts?: Row[]
  scene3d_revisions?: Row[]
  scene3d_revision_artifacts?: Row[]
  scene3d_artifacts?: Row[]
  scene3d_artifact_gc?: Row[]
  scene3d_upload_intents?: Row[]
  jobs?: Row[]
}

export interface FakeSupabase {
  tables: Required<FakeTables>
  from: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
  /** Force the next read of a table to fail, like a dropped connection. */
  failTable: (table: keyof FakeTables, message: string) => void
}

export function createFakeSupabase(seed: FakeTables = {}): FakeSupabase {
  const tables = {
    scene3d_deliveries: seed.scene3d_deliveries ?? [],
    scene3d_delivery_artifacts: seed.scene3d_delivery_artifacts ?? [],
    scene3d_revisions: seed.scene3d_revisions ?? [],
    scene3d_revision_artifacts: seed.scene3d_revision_artifacts ?? [],
    scene3d_artifacts: seed.scene3d_artifacts ?? [],
    scene3d_artifact_gc: seed.scene3d_artifact_gc ?? [],
    scene3d_upload_intents: seed.scene3d_upload_intents ?? [],
    jobs: seed.jobs ?? [],
  }
  const failures = new Map<string, string>()

  const from = vi.fn((table: string) => {
    const eqs: Array<[string, unknown]> = []
    let inFilter: [string, unknown[]] | null = null
    let deleting = false
    let inserting: Row | null = null
    let patch: Row | null = null

    const rows = (): Row[] => {
      let out = (tables as Record<string, Row[]>)[table] ?? []
      for (const [column, value] of eqs) out = out.filter((row) => row[column] === value)
      if (inFilter) out = out.filter((row) => inFilter![1].includes(row[inFilter![0]]))
      return out
    }

    const settle = () => {
      const message = failures.get(table)
      if (message) return { data: null, error: { message } }
      const source = (tables as Record<string, Row[]>)[table]
      if (inserting) {
        const keys = Object.keys(inserting)
        const key = keys.includes("artifact_id") ? "artifact_id" : "id"
        if (source.some((row) => row[key] === (inserting as Row)[key])) {
          return { data: null, error: { code: "23505", message: "duplicate key" } }
        }
        source.push({ ...inserting })
        return { data: [{ ...inserting }], error: null }
      }
      const matched = rows()
      if (patch) {
        for (const row of matched) Object.assign(row, patch)
        return { data: matched.map((row) => ({ ...row })), error: null }
      }
      if (deleting) {
        for (const row of matched) source.splice(source.indexOf(row), 1)
        return { data: null, error: null }
      }
      return { data: matched, error: null }
    }

    const builder = {
      select: () => builder,
      delete: () => {
        deleting = true
        return builder
      },
      insert: (row: Row) => {
        inserting = row
        return builder
      },
      update: (row: Row) => {
        patch = row
        return builder
      },
      eq: (column: string, value: unknown) => {
        eqs.push([column, value])
        return builder
      },
      in: (column: string, values: unknown[]) => {
        inFilter = [column, values]
        return builder
      },
      maybeSingle: async () => {
        const settled = settle()
        if (settled.error) return settled
        return { data: (settled.data as Row[])[0] ?? null, error: null }
      },
      then: (
        resolve: (value: { data: unknown; error: unknown }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(settle()).then(resolve, reject),
    }
    return builder
  })

  return {
    tables,
    from,
    rpc: vi.fn(),
    failTable: (table, message) => failures.set(table, message),
  }
}
