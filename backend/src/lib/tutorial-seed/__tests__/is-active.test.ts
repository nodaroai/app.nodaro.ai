/**
 * The reseed must not un-hide a tutorial an operator deliberately hid.
 *
 * The seeder is a slug-keyed upsert: one `row` object feeds BOTH the INSERT
 * (a tutorial this installation has never seen) and the UPDATE (the content
 * changed since the copy on disk). `is_active` belongs only to the first.
 * An operator turns a tutorial off — via PATCH /v1/templates/:id
 * `{isActive:false}` or the DELETE soft-delete — because the flow cannot run
 * HERE: no provider balance, no key for that lane. That is a decision about
 * the installation, and a content update carries no information about it, so
 * a reworded tutorial must not overrule it.
 *
 * These tests drive the real `seedTutorialTemplates()` against an in-memory
 * store, because the defect lives in which payload each branch sends — a
 * property no test of the row builder alone would pin.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"

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
}))

vi.mock("../../supabase.js", () => {
  const nextId = (p: string) => `${p}-${++store.seq}`
  const table = (name: string): Row[] => (store as unknown as Record<string, Row[]>)[name]

  class Builder implements PromiseLike<{ data: unknown; error: unknown }> {
    private filters: [string, unknown][] = []
    private op: "select" | "insert" | "update" = "select"
    private payload: Row = {}
    constructor(private name: string) {}

    select() { return this }
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
        for (const r of this.matches()) Object.assign(r, this.payload)
        return { data: null, error: null }
      }
      return { data: this.matches(), error: null }
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
      from: (name: string) => new Builder(name),
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
import { seedTutorialTemplates } from "../index.js"

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

/** No retry schedule — a fake store never has a transport failure to wait out. */
const seed = () => seedTutorialTemplates({ delaysMs: [] })

const template = () => store.workflow_templates[0]!

describe("tutorial seeder — operator deactivation survives a content reseed", () => {
  beforeEach(() => {
    config.EDITION = "community"
    store.users.length = 0
    store.projects.length = 0
    store.workflows.length = 0
    store.workflow_templates.length = 0
    store.tutorial_categories.length = 0
    store.tutorial_categories.push({ id: "cat-basics", slug: "basics" })
    store.seq = 0
    docs.value = [doc()]
  })

  afterAll(() => {
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
    expect(store.workflow_templates).toHaveLength(0)
  })
})
