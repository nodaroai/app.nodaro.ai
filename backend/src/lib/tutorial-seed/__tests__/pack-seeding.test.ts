/**
 * Pack tutorials seed through the SAME slug-keyed upsert as the base set, so
 * they inherit the fingerprint reseed and OPERATOR_OWNED_COLUMNS contract for
 * free. These tests pin: (1) inert default — no packs env is byte-identical to
 * base-only; (2) a pack's category is ensured before its template inserts, so
 * the migration-114 CHECK never fires; (3) a pack tutorial an operator hid
 * stays hidden across a content reseed; (4) Cloud seeds operator packs and
 * ONLY those — a dedicated hosted instance (EDITION=cloud on its own Supabase)
 * gets its pack, while Nodaro's shared cloud (no packs env) makes no call at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// --- fs mock: base templates on "disk" (same shape as operator-owned-columns.test.ts) ---
const docs = vi.hoisted(() => ({ value: [] as unknown[] }))
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>()
  return {
    ...actual,
    readdir: vi.fn(async (p: string) => {
      // The base TEMPLATES_DIR read returns t<i>.json; pack dirs are read from
      // the REAL fs via loadTutorialPacks, so only intercept the base dir.
      if (String(p).includes("tutorial-seed")) return docs.value.map((_, i) => `t${i}.json`)
      return actual.readdir(p)
    }),
    readFile: vi.fn(async (p: string) => {
      const m = /t(\d+)\.json$/.exec(String(p))
      if (m && !String(p).includes("nodaro-packseed-")) return JSON.stringify(docs.value[Number(m[1])])
      return actual.readFile(p, "utf8")
    }),
  }
})

// --- the store (copied verbatim from operator-owned-columns.test.ts) ---
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

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { config } from "../../config.js"
import { OPERATOR_OWNED_COLUMNS, seedTutorialTemplates } from "../index.js"

const REAL_EDITION = config.EDITION

function baseDoc(over: Record<string, unknown> = {}) {
  return { slug: "welcome-demo", name: "Welcome", markdownDescription: "v1",
    tutorialCategorySlug: "basics", tutorialSortOrder: 1, nodes: [], edges: [], ...over }
}

async function packDoc(dir: string, slug: string) {
  await writeFile(join(dir, `${slug}.json`), JSON.stringify({
    slug, name: slug, markdownDescription: "p1",
    tutorialCategorySlug: "demo-basics", tutorialSortOrder: 0,
    nodes: [{ id: "n1", type: "generate-image", data: { generatedResults: [{ url: "https://cdn.example.com/a.png" }] } }],
    edges: [],
  }))
}

/**
 * Drives the real seeder and fails on any swallowed [tutorial-seed] warning —
 * copied verbatim from operator-owned-columns.test.ts. Task 4's paths are all
 * clean (a valid pack), so any warning here is a real failure.
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

describe("tutorial seeder — operator-supplied packs", () => {
  let packRoot: string
  beforeEach(async () => {
    config.EDITION = "community"
    // reset store (copied resets from operator-owned-columns.test.ts) …
    store.users.length = 0
    store.projects.length = 0
    store.workflows.length = 0
    store.workflow_templates.length = 0
    store.tutorial_categories.length = 0
    store.seq = 0
    store.fromCalls = 0
    store.updatePayloads.length = 0
    // … and seed the base 'basics' category the base doc references:
    store.tutorial_categories.push({ id: "cat-basics", slug: "basics", name: "Basics" })
    docs.value = [baseDoc()]
    packRoot = await mkdtemp(join(tmpdir(), "nodaro-packseed-"))
    delete process.env.NODARO_TUTORIAL_PACKS
  })
  afterEach(async () => {
    config.EDITION = REAL_EDITION
    await rm(packRoot, { recursive: true, force: true })
    delete process.env.NODARO_TUTORIAL_PACKS
  })

  it("is inert with no packs env — only the base tutorial is seeded", async () => {
    await seed()
    expect(store.workflow_templates.map((r) => r.slug)).toEqual(["welcome-demo"])
  })

  it("writes estimated_credits / node_types_used / providers_used / creator_display_name and a category description", async () => {
    const dir = join(packRoot, "demo")
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "manifest.json"), JSON.stringify({
      name: "Demo",
      creatorDisplayName: "Acme Team",
      categories: [{ slug: "demo-basics", name: "Demo Basics", description: "Basic tutorials" }],
    }))
    await writeFile(join(dir, "demo-a.json"), JSON.stringify({
      slug: "demo-a", name: "A", tutorialCategorySlug: "demo-basics", tutorialSortOrder: 0,
      nodes: [{ id: "n1", type: "generate-image", data: {
        generatedResults: [{ url: "https://cdn.example.com/a.png" }],
      } }],
      edges: [],
      estimatedCredits: 42, nodeTypesUsed: ["generate-image"], providersUsed: ["nano-banana"],
    }))
    process.env.NODARO_TUTORIAL_PACKS = dir

    await seed()

    const cat = store.tutorial_categories.find((c) => c.slug === "demo-basics")
    expect(cat?.description).toBe("Basic tutorials")
    const row = store.workflow_templates.find((r) => r.slug === "demo-a")
    expect(row?.estimated_credits).toBe(42)
    expect(row?.node_types_used).toEqual(["generate-image"])
    expect(row?.providers_used).toEqual(["nano-banana"])
    expect(row?.creator_display_name).toBe("Acme Team")
  })

  it("defaults the facets to DB-safe empties and creator to the system name when a doc omits them", async () => {
    // base-only run (beforeEach clears the packs env); the base welcome-demo doc
    // sets none of the new fields, so it must fall back to 0 / [] / [] / "Nodaro".
    await seed()

    const row = store.workflow_templates.find((r) => r.slug === "welcome-demo")
    expect(row?.estimated_credits).toBe(0)
    expect(row?.node_types_used).toEqual([])
    expect(row?.providers_used).toEqual([])
    expect(row?.creator_display_name).toBe("Nodaro")
  })

  it("ensures a pack's category then seeds its tutorial active", async () => {
    const dir = join(packRoot, "demo")
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "manifest.json"), JSON.stringify({
      name: "Demo", categories: [{ slug: "demo-basics", name: "Demo Basics", sortOrder: 0 }],
    }))
    await packDoc(dir, "demo-welcome")
    process.env.NODARO_TUTORIAL_PACKS = dir

    await seed()

    // Category created (select-then-insert), template seeded active.
    expect(store.tutorial_categories.some((c) => c.slug === "demo-basics")).toBe(true)
    const row = store.workflow_templates.find((r) => r.slug === "demo-welcome")!
    expect(row).toBeTruthy()
    expect(row.is_active).toBe(true)
    expect(row.listed_in).toEqual(["tutorial"])
  })

  it("keeps a hidden pack tutorial hidden across a content reseed (OPERATOR_OWNED_COLUMNS)", async () => {
    const dir = join(packRoot, "demo")
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "manifest.json"), JSON.stringify({
      name: "Demo", categories: [{ slug: "demo-basics", name: "Demo Basics" }],
    }))
    await packDoc(dir, "demo-welcome")
    process.env.NODARO_TUTORIAL_PACKS = dir

    await seed()
    const row = () => store.workflow_templates.find((r) => r.slug === "demo-welcome")!
    row().is_active = false // operator hides it

    // Reword the pack tutorial (new fingerprint) and reseed.
    await writeFile(join(dir, "demo-welcome.json"), JSON.stringify({
      slug: "demo-welcome", name: "Demo Welcome v2", markdownDescription: "p2",
      tutorialCategorySlug: "demo-basics", tutorialSortOrder: 0,
      nodes: [{ id: "n1", type: "generate-image", data: { generatedResults: [{ url: "https://cdn.example.com/a.png" }] } }],
      edges: [],
    }))
    await seed()

    expect(row().markdown_description).toContain("p2") // content updated
    expect(row().is_active).toBe(false)                // operator decision preserved
    const updates = store.updatePayloads.filter((u) => u.table === "workflow_templates")
    for (const { payload } of updates) {
      expect(Object.keys(payload).filter((k) => OPERATOR_OWNED_COLUMNS.includes(k))).toEqual([])
    }
  })

  it("on Cloud with a pack: seeds the pack, never the built-in set", async () => {
    // A dedicated hosted instance: EDITION=cloud, its own Supabase, tutorials
    // shipped as a pack. The built-in welcome-demo must NOT appear — on the
    // shared cloud those rows belong to a real user, and on a dedicated
    // instance they are Nodaro's English content, not the tenant's.
    config.EDITION = "cloud"
    const dir = join(packRoot, "demo")
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "manifest.json"), JSON.stringify({
      name: "Demo", categories: [{ slug: "demo-basics", name: "Demo Basics" }],
    }))
    await packDoc(dir, "demo-welcome")
    process.env.NODARO_TUTORIAL_PACKS = dir

    await seed()

    expect(store.workflow_templates.map((r) => r.slug)).toEqual(["demo-welcome"])
    expect(store.workflow_templates[0].is_active).toBe(true)
    expect(store.tutorial_categories.some((c) => c.slug === "demo-basics")).toBe(true)
  })

  it("on Cloud with a pack: a pack slug colliding with a built-in is still rejected", async () => {
    // The built-in slugs feed the de-dup even though they are not seeded, so a
    // pack can never shadow a built-in a real user owns on the shared cloud.
    config.EDITION = "cloud"
    const dir = join(packRoot, "demo")
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "manifest.json"), JSON.stringify({
      name: "Demo", categories: [{ slug: "demo-basics", name: "Demo Basics" }],
    }))
    await packDoc(dir, "welcome-demo") // same slug as the built-in doc
    process.env.NODARO_TUTORIAL_PACKS = dir

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await seedTutorialTemplates({ delaysMs: [] })
      expect(warn.mock.calls.some((c) => /slug_conflict/.test(String(c[0])))).toBe(true)
    } finally {
      warn.mockRestore()
    }
    expect(store.workflow_templates).toEqual([])
  })

  it("on Cloud with no packs env: byte-identical no-op — zero Supabase calls, no system account", async () => {
    config.EDITION = "cloud"
    await seed()
    expect(store.fromCalls).toBe(0)
    expect(store.users).toEqual([])
    expect(store.workflow_templates).toEqual([])
  })
})
