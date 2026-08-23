/**
 * A content reseed must not overwrite what the INSTALLATION decided.
 *
 * The seeder is a slug-keyed upsert: one `row` object fed BOTH the INSERT (a
 * tutorial this installation has never seen) and the UPDATE (the content
 * changed since the copy on disk). Two columns do not belong in the second —
 * `is_active` and `listed_in`, i.e. OPERATOR_OWNED_COLUMNS. A tutorial is
 * switched off, or taken out of the Tutorials tab, because the flow cannot run
 * HERE: no provider balance, no key for that lane. A reworded tutorial carries
 * no information about that, so it must not overrule it.
 *
 * These tests drive the real `seedTutorialTemplates()` against an in-memory
 * store, because the defect lives in which payload each branch sends — a
 * property no test of the row builder alone would pin. The last of them is the
 * structural form: no UPDATE payload may carry ANY operator-owned column, so
 * the next column added to the shared literal is caught without a new test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// --- template docs on "disk" ------------------------------------------------
// Controlled per test so a reseed can carry genuinely different content: an
// unchanged doc short-circuits on the fingerprint marker and never reaches
// the UPDATE at all.
const docs = vi.hoisted(() => ({ value: [] as unknown[] }))

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>()
  return {
    ...actual,
    readdir: vi.fn(async () => docs.value.map((_, i) => `t${i}.json`)),
    readFile: vi.fn(async (p: string) => {
      const idx = Number(/t(\d+)\.json$/.exec(String(p))?.[1] ?? -1)
      return JSON.stringify(docs.value[idx])
    }),
  }
})

// --- the store --------------------------------------------------------------
type Row = Record<string, unknown>

const store = vi.hoisted(() => ({
  users: [] as Row[],
  projects: [] as Row[],
  workflows: [] as Row[],
  workflow_templates: [] as Row[],
  tutorial_categories: [] as Row[],
  seq: 0,
  fromCalls: 0,
  updatePayloads: [] as Array<{ table: string; payload: Row }>,
}))

vi.mock("../../supabase.js", () => {
  const nextId = (p: string) => `${p}-${++store.seq}`
  const table = (name: string): Row[] => (store as unknown as Record<string, Row[]>)[name]

  class Builder implements PromiseLike<{ data: unknown; error: unknown }> {
    private filters: [string, unknown][] = []
    private op: "select" | "insert" | "update" = "select"
    private payload: Row = {}
    private projection: string[] | null = null
    constructor(private name: string) {}

    select(cols?: string) {
      // Production selects "id, workflow_id, markdown_description" — NOT
      // is_active. Returning whole rows would let a future read of an
      // unselected column pass here and be `undefined` against real Supabase,
      // on the exact column this suite exists for.
      this.projection = cols && cols !== "*"
        ? cols.split(",").map((c) => c.trim()).filter(Boolean)
        : null
      return this
    }
    limit() { return this }
    eq(col: string, val: unknown) { this.filters.push([col, val]); return this }
    insert(row: Row) { this.op = "insert"; this.payload = row; return this }
    update(row: Row) { this.op = "update"; this.payload = row; return this }

    private matches(): Row[] {
      return table(this.name).filter((r) => this.filters.every(([c, v]) => r[c] === v))
    }

    private run(): { data: unknown; error: unknown } {
      if (this.op === "insert") {
        const row = { id: nextId(this.name), ...this.payload }
        table(this.name).push(row)
        return { data: row, error: null }
      }
      if (this.op === "update") {
        store.updatePayloads.push({ table: this.name, payload: this.payload })
        for (const r of this.matches()) Object.assign(r, this.payload)
        return { data: null, error: null }
      }
      return { data: this.matches().map((r) => this.project(r)), error: null }
    }

    private project(row: Row): Row {
      if (!this.projection) return row
      return Object.fromEntries(this.projection.map((c) => [c, row[c]]))
    }

    async maybeSingle() {
      const { data, error } = this.run()
      return { data: (data as Row[])[0] ?? null, error }
    }
    async single() {
      const { data, error } = this.run()
      const row = Array.isArray(data) ? data[0] : data
      return row ? { data: row, error } : { data: null, error: { message: "no rows" } }
    }
    then<R1, R2>(
      onOk?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
      onErr?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
    ): PromiseLike<R1 | R2> {
      return Promise.resolve(this.run()).then(onOk, onErr)
    }
  }

  return {
    supabase: {
      from: (name: string) => {
        store.fromCalls += 1
        return new Builder(name)
      },
      auth: {
        admin: {
          listUsers: async () => ({ data: { users: store.users }, error: null }),
          createUser: async ({ email }: { email: string }) => {
            const user = { id: nextId("user"), email }
            store.users.push(user)
            return { data: { user }, error: null }
          },
        },
      },
    },
  }
})

import { config } from "../../config.js"
import { OPERATOR_OWNED_COLUMNS, seedTutorialTemplates } from "../index.js"

// The shared test setup pins EDITION=cloud, where the seeder is a deliberate
// no-op (staging and production share one Supabase project). Self-host is the
// configuration under test.
const REAL_EDITION = config.EDITION

function doc(overrides: Record<string, unknown> = {}) {
  return {
    slug: "welcome-demo",
    name: "Welcome",
    markdownDescription: "v1",
    tutorialCategorySlug: "basics",
    tutorialSortOrder: 1,
    nodes: [],
    edges: [],
    ...overrides,
  }
}

/**
 * No retry schedule — a fake store never has a transport failure to wait out.
 *
 * `seedTutorialTemplates` catches everything and reports it through
 * console.warn, which src/test/setup.ts replaces with a noop. Left alone, a
 * run that died in the fs mock or the store would be indistinguishable from a
 * clean run and half these assertions would pass for the wrong reason. So spy
 * on warn and fail on any swallowed error.
 */
async function seed(): Promise<void> {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  try {
    await seedTutorialTemplates({ delaysMs: [] })
    const swallowed = warn.mock.calls.filter((c) => String(c[0]).includes("[tutorial-seed]"))
    expect(swallowed).toEqual([])
  } finally {
    warn.mockRestore()
  }
}

const template = () => store.workflow_templates[0]!

describe("tutorial seeder — operator decisions survive a content reseed", () => {
  beforeEach(() => {
    config.EDITION = "community"
    store.users.length = 0
    store.projects.length = 0
    store.workflows.length = 0
    store.workflow_templates.length = 0
    store.tutorial_categories.length = 0
    store.tutorial_categories.push({ id: "cat-basics", slug: "basics" })
    store.seq = 0
    store.fromCalls = 0
    store.updatePayloads.length = 0
    docs.value = [doc()]
  })

  // Per-test, not afterAll: EDITION is a process global and the cloud case
  // below leaves it set, so anything added between tests would inherit it.
  afterEach(() => {
    config.EDITION = REAL_EDITION
  })

  it("seeds a new tutorial ACTIVE (the insert path keeps its default)", async () => {
    await seed()
    expect(store.workflow_templates).toHaveLength(1)
    expect(template().slug).toBe("welcome-demo")
    expect(template().is_active).toBe(true)
  })

  it("leaves a deactivated tutorial hidden when its content is reseeded", async () => {
    await seed()
    expect(template().is_active).toBe(true)

    // The operator hides it — no provider balance for this flow on this box.
    template().is_active = false

    // A later release reworks the copy: same slug, new fingerprint.
    docs.value = [doc({ markdownDescription: "v2", name: "Welcome, rewritten" })]
    await seed()

    // The content DID reach the row — this is a real update, not a skip.
    expect(template().markdown_description).toContain("v2")
    expect(template().name).toBe("Welcome, rewritten")
    // ...and the operator's decision still stands.
    expect(template().is_active).toBe(false)
  })

  it("leaves an un-listed tutorial un-listed when its content is reseeded", async () => {
    await seed()
    expect(template().listed_in).toEqual(["tutorial"])

    // The admin-only tutorial-flag route removes the tag; unlike the generic
    // template routes it gates on role, not ownership, so it is the ONE lever
    // that actually reaches a seeded row.
    template().listed_in = []

    docs.value = [doc({ markdownDescription: "v2" })]
    await seed()

    expect(template().markdown_description).toContain("v2")
    expect(template().listed_in).toEqual([])
  })

  it("preserves a marketplace tag an admin added alongside the tutorial tag", async () => {
    await seed()
    // listed_in is an extensible tag array; rewriting it wholesale on reseed
    // dropped any other tag with it.
    template().listed_in = ["tutorial", "marketplace"]

    docs.value = [doc({ markdownDescription: "v2" })]
    await seed()

    expect(template().listed_in).toEqual(["tutorial", "marketplace"])
  })

  it("sends no operator-owned column in any reseed UPDATE", async () => {
    // The structural form of the two cases above: whatever columns the
    // installation owns, a content update must not carry them. This is what
    // catches the NEXT column added to the shared payload.
    await seed()
    docs.value = [doc({ markdownDescription: "v2", name: "Rewritten" })]
    await seed()

    const templateUpdates = store.updatePayloads.filter((u) => u.table === "workflow_templates")
    expect(templateUpdates.length).toBeGreaterThan(0)
    for (const { payload } of templateUpdates) {
      expect(Object.keys(payload).filter((k) => OPERATOR_OWNED_COLUMNS.includes(k))).toEqual([])
    }
  })

  it("does not touch the row at all when the content is unchanged", async () => {
    await seed()
    template().is_active = false
    const before = { ...template() }

    await seed()

    expect(template()).toEqual(before)
    expect(store.workflow_templates).toHaveLength(1)
  })

  it("is a no-op on cloud, where staging and production share one database", async () => {
    config.EDITION = "cloud"
    await seed()
    // An empty table cannot tell "returned early" from "threw on line one" —
    // beforeEach already emptied it. The database never being touched can.
    expect(store.fromCalls).toBe(0)
    expect(store.workflow_templates).toHaveLength(0)
  })

  it("reads only the columns it selects (the mock cannot mask an unselected read)", async () => {
    // Production selects "id, workflow_id, markdown_description"; is_active is
    // deliberately not among them. Pinned so a follow-up that reads
    // existing.is_active fails here instead of silently being undefined in
    // production.
    await seed()
    docs.value = [doc({ markdownDescription: "v2" })]
    await seed()
    expect(store.fromCalls).toBeGreaterThan(0)
    expect(template().is_active).toBe(true)
  })
})
