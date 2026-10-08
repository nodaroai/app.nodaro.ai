/**
 * The template seeder claim (decided 2026-10-08): on Cloud, the first
 * environment that seeds claims the database in `app_settings`, keyed by its
 * public URL; any other environment sharing the database refuses to write a
 * template row, logs one warning, and boot carries on. Community and business
 * never claim and seed exactly as before.
 *
 * Drives the real `seedTutorialTemplates()` against an in-memory store (the
 * harness of cloud-marketplace-seed.test.ts) that, unlike that one, enforces
 * the UNIQUE key on `app_settings` — without it the race below would pass
 * vacuously. Both Cloud writers are covered: the marketplace lane and
 * operator packs (with their categories).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const docs = vi.hoisted(() => ({ value: [] as unknown[] }))

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>()
  return {
    ...actual,
    readdir: vi.fn(async (p: string) => {
      // The base TEMPLATES_DIR; pack dirs come from the real fs.
      if (String(p).includes("tutorial-seed")) return docs.value.map((_, i) => `t${i}.json`)
      return actual.readdir(p)
    }),
    readFile: vi.fn(async (p: string) => {
      const m = /t(\d+)\.json$/.exec(String(p))
      if (m && !String(p).includes("nodaro-claimseed-")) return JSON.stringify(docs.value[Number(m[1])])
      return actual.readFile(p, "utf8")
    }),
  }
})

type Row = Record<string, unknown>

const store = vi.hoisted(() => ({
  users: [] as Row[],
  profiles: [] as Row[],
  projects: [] as Row[],
  workflows: [] as Row[],
  workflow_templates: [] as Row[],
  tutorial_categories: [] as Row[],
  app_settings: [] as Row[],
  seq: 0,
  calls: [] as Array<{ table: string; op: string }>,
  failInsertOn: null as string | null,
  failSelectOn: null as string | null,
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
      store.calls.push({ table: this.name, op: this.op })
      if (this.op === "insert") {
        if (store.failInsertOn === this.name) return { data: null, error: { code: "42501", message: "denied" } }
        if (this.name === "app_settings" && table(this.name).some((r) => r.key === this.payload.key)) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }
        }
        const row = { id: nextId(this.name), ...this.payload }
        table(this.name).push(row)
        return { data: row, error: null }
      }
      if (this.op === "select" && store.failSelectOn === this.name) {
        return { data: null, error: { code: "08006", message: "connection failure" } }
      }
      if (this.op === "update") {
        for (const r of this.matches()) Object.assign(r, this.payload)
        return { data: null, error: null }
      }
      return { data: this.matches(), error: null }
    }

    async maybeSingle() {
      const { data, error } = this.run()
      return { data: (data as Row[] | null)?.[0] ?? null, error }
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
            store.calls.push({ table: "auth.users", op: "insert" })
            const user = { id: nextId("user"), email }
            store.users.push(user)
            store.profiles.push({ id: user.id, email })
            return { data: { user }, error: null }
          },
        },
      },
    },
  }
})

import { config } from "../../config.js"
import { seedTutorialTemplates } from "../index.js"
import { claimTemplateSeedingAs, publicUrlForSeeding, seederIdentity, TEMPLATE_SEEDER_CLAIM_KEY } from "../seeder-claim.js"

const REAL = {
  EDITION: config.EDITION,
  FLAG: config.NODARO_SEED_MARKETPLACE_TEMPLATES,
  PUBLIC_URL: config.PUBLIC_URL,
}

const PROD = "https://app.example.test"
const STAGING = "https://next.example.test"

function marketplaceDoc() {
  return {
    slug: "podcast-tighten-episode", name: "Tighten Episode", markdownDescription: "m1",
    listedIn: ["marketplace"], tutorialCategorySlug: "workflows", tutorialSortOrder: 0,
    nodes: [], edges: [],
  }
}
function tutorialDoc() {
  return {
    slug: "welcome-demo", name: "Welcome", markdownDescription: "v1",
    tutorialCategorySlug: "basics", tutorialSortOrder: 1, nodes: [], edges: [],
  }
}

/** Runs the seeder; returns the [tutorial-seed] warnings it logged. */
async function seed(): Promise<string[]> {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  try {
    await seedTutorialTemplates({ delaysMs: [] })
    return warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("[tutorial-seed]"))
  } finally {
    warn.mockRestore()
  }
}

const writes = () => store.calls.filter((c) => c.op !== "select")
const contentWrites = () => writes().filter((c) => c.table !== "app_settings")
const claimRows = () => store.app_settings.filter((r) => r.key === TEMPLATE_SEEDER_CLAIM_KEY)

function reset() {
  for (const k of ["users", "profiles", "projects", "workflows", "workflow_templates", "tutorial_categories", "app_settings"] as const) {
    store[k].length = 0
  }
  store.seq = 0
  store.calls.length = 0
  store.failInsertOn = null
  store.failSelectOn = null
}

let packRoot: string

beforeEach(async () => {
  reset()
  config.EDITION = "cloud"
  config.NODARO_SEED_MARKETPLACE_TEMPLATES = true
  config.PUBLIC_URL = PROD
  docs.value = [tutorialDoc(), marketplaceDoc()]
  packRoot = await mkdtemp(join(tmpdir(), "nodaro-claimseed-"))
  delete process.env.NODARO_TUTORIAL_PACKS
})

afterEach(async () => {
  config.EDITION = REAL.EDITION
  config.NODARO_SEED_MARKETPLACE_TEMPLATES = REAL.FLAG
  config.PUBLIC_URL = REAL.PUBLIC_URL
  delete process.env.NODARO_TUTORIAL_PACKS
  await rm(packRoot, { recursive: true, force: true })
})

async function writePack(): Promise<void> {
  const dir = join(packRoot, "demo")
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "manifest.json"), JSON.stringify({
    name: "Demo", categories: [{ slug: "demo-basics", name: "Demo Basics" }],
  }))
  await writeFile(join(dir, "demo-welcome.json"), JSON.stringify({
    slug: "demo-welcome", name: "Demo", markdownDescription: "p1",
    tutorialCategorySlug: "demo-basics", tutorialSortOrder: 0,
    nodes: [{ id: "n1", type: "generate-image", data: { generatedResults: [{ url: "https://cdn.example.com/a.png" }] } }],
    edges: [],
  }))
  process.env.NODARO_TUTORIAL_PACKS = dir
}

describe("template seeder claim — Cloud", () => {
  it("the first environment that seeds takes the claim, keyed by its public URL", async () => {
    expect(await seed()).toEqual([])
    expect(claimRows()).toHaveLength(1)
    expect((claimRows()[0]!.value as { url: string }).url).toBe(PROD)
    expect(store.workflow_templates.map((r) => r.slug)).toEqual(["podcast-tighten-episode"])
  })

  it("the claim is taken before any other write", async () => {
    await seed()
    expect(writes()[0]).toEqual({ table: "app_settings", op: "insert" })
  })

  it("the holder reseeds on its next boot (the same origin, however PUBLIC_URL is spelt)", async () => {
    await seed()
    store.workflow_templates.length = 0
    config.PUBLIC_URL = `${PROD.toUpperCase()}/`
    expect(await seed()).toEqual([])
    expect(store.workflow_templates.map((r) => r.slug)).toEqual(["podcast-tighten-episode"])
    expect(claimRows()).toHaveLength(1)
  })

  it("a second environment refuses: no write of any kind, one warning naming both URLs, no throw", async () => {
    await seed()
    const snapshot = () => JSON.stringify({ ...store, calls: undefined })
    store.calls.length = 0
    const before = snapshot()

    config.PUBLIC_URL = STAGING
    docs.value = [tutorialDoc(), { ...marketplaceDoc(), markdownDescription: "staging wording" }]
    const warnings = await seed()

    expect(writes()).toEqual([])
    expect(snapshot()).toBe(before)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(PROD)
    expect(warnings[0]).toContain(STAGING)
  })

  it("operator packs: a second environment writes no category and no pack template", async () => {
    await writePack()
    expect(await seed()).toEqual([])
    expect(store.workflow_templates.map((r) => r.slug).sort()).toEqual(["demo-welcome", "podcast-tighten-episode"])

    reset()
    store.app_settings.push({ id: "s1", key: TEMPLATE_SEEDER_CLAIM_KEY, value: { url: PROD } })
    config.PUBLIC_URL = STAGING
    expect(await seed()).toHaveLength(1)
    expect(writes()).toEqual([])
    expect(store.tutorial_categories).toEqual([])
    expect(store.workflow_templates).toEqual([])
  })

  it("operator packs alone (no marketplace lane) take the claim too", async () => {
    config.NODARO_SEED_MARKETPLACE_TEMPLATES = false
    await writePack()
    expect(await seed()).toEqual([])
    expect((claimRows()[0]!.value as { url: string }).url).toBe(PROD)
    expect(store.workflow_templates.map((r) => r.slug)).toEqual(["demo-welcome"])
  })

  it("an environment with nothing to seed never reads or takes the claim", async () => {
    config.NODARO_SEED_MARKETPLACE_TEMPLATES = false
    expect(await seed()).toEqual([])
    expect(store.calls).toEqual([])
  })

  it("the claim's own URL decides, never PUBLIC_URL being set: a set URL that matches seeds, one that differs refuses", async () => {
    store.app_settings.push({ id: "s1", key: TEMPLATE_SEEDER_CLAIM_KEY, value: { url: PROD } })
    expect(await seed()).toEqual([])
    expect(store.workflow_templates.map((r) => r.slug)).toEqual(["podcast-tighten-episode"])
    expect(claimRows()).toHaveLength(1)

    store.calls.length = 0
    config.PUBLIC_URL = STAGING
    const warnings = await seed()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(PROD)
    expect(warnings[0]).toContain(STAGING)
    expect(writes()).toEqual([])
    expect((claimRows()[0]!.value as { url: string }).url).toBe(PROD)
  })

  it("a claim hand-edited into another shape is not ours: refuse", async () => {
    store.app_settings.push({ id: "s1", key: TEMPLATE_SEEDER_CLAIM_KEY, value: "garbage" })
    expect(await seed()).toHaveLength(1)
    expect(contentWrites()).toEqual([])
  })

  it("a claim write that fails for another reason skips the run without writing content", async () => {
    store.failInsertOn = "app_settings"
    const warnings = await seed()
    expect(warnings.some((w) => w.includes("skipped"))).toBe(true)
    expect(contentWrites()).toEqual([])
  })
})

describe("template seeder claim — Cloud with PUBLIC_URL unset (decided 2026-10-08, round 5)", () => {
  it("no claim exists: seeds exactly as with a URL, writes no claim, warns nothing", async () => {
    config.PUBLIC_URL = ""
    expect(await seed()).toEqual([])
    expect(store.workflow_templates.map((r) => r.slug)).toEqual(["podcast-tighten-episode"])
    expect(claimRows()).toEqual([])
    expect(writes().some((c) => c.table === "app_settings")).toBe(false)
  })

  it("no claim exists, operator packs: seeds the pack too, still no claim", async () => {
    config.PUBLIC_URL = ""
    await writePack()
    expect(await seed()).toEqual([])
    expect(store.workflow_templates.map((r) => r.slug).sort()).toEqual(["demo-welcome", "podcast-tighten-episode"])
    expect(claimRows()).toEqual([])
  })

  it("whitespace alone counts as unset: seeds without claiming", async () => {
    config.PUBLIC_URL = "   "
    expect(await seed()).toEqual([])
    expect(store.workflow_templates).toHaveLength(1)
    expect(claimRows()).toEqual([])
  })

  it("another environment holds the claim: refuses, writes nothing, one warning naming the holder", async () => {
    store.app_settings.push({ id: "s1", key: TEMPLATE_SEEDER_CLAIM_KEY, value: { url: PROD } })
    config.PUBLIC_URL = ""
    const warnings = await seed()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(PROD)
    expect(warnings[0]).toContain("PUBLIC_URL")
    expect(writes()).toEqual([])
    expect(store.workflow_templates).toEqual([])
  })

  it("a claim hand-edited into another shape still counts as held: refuse", async () => {
    store.app_settings.push({ id: "s1", key: TEMPLATE_SEEDER_CLAIM_KEY, value: "garbage" })
    config.PUBLIC_URL = ""
    expect(await seed()).toHaveLength(1)
    expect(writes()).toEqual([])
  })

  it("seeding unclaimed leaves the claim free: the next environment with a URL takes it", async () => {
    config.PUBLIC_URL = ""
    await seed()
    config.PUBLIC_URL = STAGING
    expect(await seed()).toEqual([])
    expect((claimRows()[0]!.value as { url: string }).url).toBe(STAGING)
  })

  it("a claim read that errors throws into the seeder's own handling (no content written)", async () => {
    config.PUBLIC_URL = ""
    store.failSelectOn = "app_settings"
    const warnings = await seed()
    expect(warnings.some((w) => w.includes("skipped"))).toBe(true)
    expect(contentWrites()).toEqual([])
  })
})

describe("template seeder claim — Cloud with PUBLIC_URL set but malformed (decided 2026-10-08, round 6)", () => {
  // Each value carries a secret-shaped token the warning must never echo.
  const MALFORMED = [
    { value: "app.example.test/?token=hunter2", problem: "is not a URL" },
    { value: "ftp://ops:hunter2@app.example.test", problem: "not http(s)" },
  ]

  for (const { value, problem } of MALFORMED) {
    it(`no claim exists: refuses (${problem}), writes no template and no claim, one warning without the value`, async () => {
      config.PUBLIC_URL = value
      const warnings = await seed()
      expect(writes()).toEqual([])
      expect(store.workflow_templates).toEqual([])
      expect(claimRows()).toEqual([])
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain("PUBLIC_URL")
      expect(warnings[0]).toContain(problem)
      expect(warnings[0]).not.toContain("hunter2")
    })

    it(`a claim exists: refuses (${problem}) and leaves the claim as it was`, async () => {
      store.app_settings.push({ id: "s1", key: TEMPLATE_SEEDER_CLAIM_KEY, value: { url: PROD } })
      config.PUBLIC_URL = value
      const warnings = await seed()
      expect(writes()).toEqual([])
      expect(store.workflow_templates).toEqual([])
      expect(claimRows()).toEqual([{ id: "s1", key: TEMPLATE_SEEDER_CLAIM_KEY, value: { url: PROD } }])
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(problem)
      expect(warnings[0]).not.toContain("hunter2")
    })
  }

  it("operator packs: refuses, no category and no pack template", async () => {
    await writePack()
    config.PUBLIC_URL = "not a url"
    expect(await seed()).toHaveLength(1)
    expect(writes()).toEqual([])
    expect(store.tutorial_categories).toEqual([])
  })

  it("unset is not malformed: with no claim it still seeds, unclaimed (round 5)", async () => {
    config.PUBLIC_URL = ""
    expect(await seed()).toEqual([])
    expect(store.workflow_templates.map((r) => r.slug)).toEqual(["podcast-tighten-episode"])
    expect(claimRows()).toEqual([])
  })

  it("community with a malformed PUBLIC_URL still seeds (no claim off Cloud)", async () => {
    config.EDITION = "community"
    config.PUBLIC_URL = "not a url"
    expect(await seed()).toEqual([])
    expect(store.workflow_templates).toHaveLength(2)
  })
})

describe("template seeder claim — race", () => {
  it("two environments racing on an empty claim: exactly one wins, the other refuses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const [a, b] = await Promise.all([claimTemplateSeedingAs(PROD), claimTemplateSeedingAs(STAGING)])
      // Both read an empty claim before either inserted: the race really ran.
      const ops = store.calls.map((c) => c.op)
      expect(ops.slice(0, 2)).toEqual(["select", "select"])
      expect([a, b].filter(Boolean)).toHaveLength(1)
      expect(claimRows()).toHaveLength(1)
      const winner = (claimRows()[0]!.value as { url: string }).url
      expect(winner).toBe(a ? PROD : STAGING)
      expect(warn.mock.calls).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })

  it("two replicas of one environment racing both proceed", async () => {
    const [a, b] = await Promise.all([claimTemplateSeedingAs(PROD), claimTemplateSeedingAs(PROD)])
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(claimRows()).toHaveLength(1)
  })
})

describe("template seeder claim — community and business", () => {
  for (const edition of ["community", "business"] as const) {
    it(`${edition}: never reads or writes a claim, and seeds even where one names another URL`, async () => {
      config.EDITION = edition
      store.app_settings.push({ id: "s1", key: TEMPLATE_SEEDER_CLAIM_KEY, value: { url: "https://elsewhere.test" } })
      store.tutorial_categories.push({ id: "c1", slug: "basics" }, { id: "c2", slug: "workflows" })
      expect(await seed()).toEqual([])
      expect(store.calls.some((c) => c.table === "app_settings")).toBe(false)
      expect(store.workflow_templates.map((r) => r.slug).sort()).toEqual(["podcast-tighten-episode", "welcome-demo"])
      expect(claimRows()).toHaveLength(1)
    })
  }

  it("community with PUBLIC_URL unset still seeds", async () => {
    config.EDITION = "community"
    config.PUBLIC_URL = ""
    expect(await seed()).toEqual([])
    expect(store.workflow_templates).toHaveLength(2)
  })
})

describe("publicUrlForSeeding", () => {
  it("tells unset, malformed and valid apart, and never returns the raw value", () => {
    expect(publicUrlForSeeding("")).toEqual({ kind: "unset" })
    expect(publicUrlForSeeding("  ")).toEqual({ kind: "unset" })
    expect(publicUrlForSeeding("https://App.Example.test/x")).toEqual({ kind: "valid", origin: "https://app.example.test" })
    const bad = publicUrlForSeeding("ftp://ops:hunter2@app.example.test")
    expect(bad.kind).toBe("malformed")
    expect(JSON.stringify(bad)).not.toContain("hunter2")
    expect(publicUrlForSeeding("not a url").kind).toBe("malformed")
  })
})

describe("seederIdentity", () => {
  it("is the origin of PUBLIC_URL, never a fallback", () => {
    expect(seederIdentity("https://App.Example.test/")).toBe("https://app.example.test")
    expect(seederIdentity("https://app.example.test/some/path")).toBe("https://app.example.test")
    expect(seederIdentity("")).toBeNull()
    expect(seederIdentity("not a url")).toBeNull()
    expect(seederIdentity("ftp://app.example.test")).toBeNull()
  })
})
