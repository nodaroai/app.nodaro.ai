/**
 * The narrow Cloud marketplace seeding lane (NODARO_SEED_MARKETPLACE_TEMPLATES).
 *
 * On Cloud the built-in TUTORIAL set is never seeded — staging and production
 * share one Supabase project and those slugs belong to real users. But the
 * built-in MARKETPLACE templates (the podcast editing templates — docs whose
 * `listedIn` includes "marketplace") are platform-owned SYSTEM slugs no real
 * user owns, so seeding them under the system account is safe. It is gated
 * behind an explicit opt-in, default OFF, so Nodaro's shared cloud stays
 * byte-identical until an operator flips the lever.
 *
 * These tests drive the real `seedTutorialTemplates()` against an in-memory
 * store (the same harness as operator-owned-columns.test.ts) and prove: (1)
 * default off is a true no-op — no Supabase call, no system account; (2) with
 * the lever on, ONLY the marketplace subset seeds, never the tutorial set; (3)
 * a reboot inserts nothing and issues no UPDATE (idempotent on the fingerprint
 * marker); (4) a user-owned row sharing the slug is never touched (seedOne is
 * creator-scoped).
 *
 * Note on (4): the mock store does not enforce the real UNIQUE(slug) constraint
 * (migration 076). In production a genuine collision — a real user already
 * holding that exact slug — surfaces as a 23505 on the INSERT, which seedDoc
 * catches and logs (warn + skip), never a clobber. The assertion here pins the
 * safety property the seeder controls: it never UPDATEs a row it does not own.
 *
 * The last block pins the edition gate for templates built on a Cloud-only
 * node (Content Recipe / Content Ideas): off Cloud they are never seeded, since
 * the workflow routes refuse to save such a graph there; on Cloud they seed
 * like any other built-in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// --- template docs on "disk" (same shape as operator-owned-columns.test.ts) --
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

// --- the store (copied verbatim from operator-owned-columns.test.ts) ---------
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
            // handle_new_user mints the profile row; ensureSystemUser resolves
            // by profiles.email first.
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

// A Cloud run seeds only from the environment holding the database's seeder
// claim (seeder-claim.ts), keyed by PUBLIC_URL: give each test an empty claim
// and this environment's URL, so the first Cloud seed takes the claim.
const REAL_PUBLIC_URL = config.PUBLIC_URL
beforeEach(() => {
  config.PUBLIC_URL = "https://app.example.test"
  store.app_settings.length = 0
})
afterEach(() => {
  config.PUBLIC_URL = REAL_PUBLIC_URL
})

const REAL_EDITION = config.EDITION
const REAL_FLAG = config.NODARO_SEED_MARKETPLACE_TEMPLATES

function tutorialDoc(over: Record<string, unknown> = {}) {
  return {
    slug: "welcome-demo",
    name: "Welcome",
    markdownDescription: "v1",
    tutorialCategorySlug: "basics",
    tutorialSortOrder: 1,
    nodes: [],
    edges: [],
    ...over,
  }
}

function marketplaceDoc(over: Record<string, unknown> = {}) {
  return {
    slug: "podcast-tighten-episode",
    name: "Tighten Episode",
    markdownDescription: "m1",
    listedIn: ["marketplace"],
    tutorialCategorySlug: "workflows",
    tutorialSortOrder: 0,
    nodes: [],
    edges: [],
    ...over,
  }
}

/** Drives the real seeder and fails on any swallowed [tutorial-seed] warning
 *  (setup.ts noops console.warn) — mirrors operator-owned-columns.test.ts. */
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

describe("tutorial seeder — Cloud marketplace lane", () => {
  beforeEach(() => {
    config.EDITION = "cloud"
    config.NODARO_SEED_MARKETPLACE_TEMPLATES = false
    store.users.length = 0
    store.profiles.length = 0
    store.projects.length = 0
    store.workflows.length = 0
    store.workflow_templates.length = 0
    store.tutorial_categories.length = 0
    store.seq = 0
    store.fromCalls = 0
    store.updatePayloads.length = 0
    // A tutorial built-in AND a marketplace built-in ship in the image.
    docs.value = [tutorialDoc(), marketplaceDoc()]
  })

  afterEach(() => {
    config.EDITION = REAL_EDITION
    config.NODARO_SEED_MARKETPLACE_TEMPLATES = REAL_FLAG
  })

  it("is a byte-identical no-op on Cloud when the lever is OFF (default)", async () => {
    await seed()
    // An empty table cannot tell "returned early" from "threw on line one" —
    // the database never being touched can.
    expect(store.fromCalls).toBe(0)
    expect(store.users).toEqual([])
    expect(store.workflow_templates).toEqual([])
  })

  it("seeds ONLY the marketplace built-ins when the lever is ON — never the tutorial set", async () => {
    config.NODARO_SEED_MARKETPLACE_TEMPLATES = true
    await seed()

    expect(store.workflow_templates).toHaveLength(1)
    const row = store.workflow_templates[0]!
    expect(row.slug).toBe("podcast-tighten-episode")
    // doc.listedIn applied on INSERT (SEEDED_DEFAULTS would have said tutorial).
    expect(row.listed_in).toEqual(["marketplace"])
    expect(row.is_active).toBe(true)
    // the ["tutorial"] built-in is NOT written to the shared cloud DB.
    expect(store.workflow_templates.some((r) => r.slug === "welcome-demo")).toBe(false)
  })

  it("is idempotent on re-run — a reboot inserts nothing and issues no UPDATE", async () => {
    config.NODARO_SEED_MARKETPLACE_TEMPLATES = true
    await seed()
    expect(store.workflow_templates).toHaveLength(1)
    const usersAfterFirstBoot = store.users.length

    // Watch only the second boot.
    store.updatePayloads.length = 0
    await seed()

    expect(store.workflow_templates).toHaveLength(1) // no duplicate row
    expect(store.users.length).toBe(usersAfterFirstBoot) // system account not re-created
    // seedOne short-circuits on the fingerprint marker before any write — the
    // precise no-op signal is zero template UPDATEs, not just an unchanged count.
    const tplUpdates = store.updatePayloads.filter((u) => u.table === "workflow_templates")
    expect(tplUpdates).toEqual([])
  })

  it("never overwrites a user-owned row that shares the slug", async () => {
    config.NODARO_SEED_MARKETPLACE_TEMPLATES = true
    // A real user published a template at the same slug. seedOne is scoped to
    // the system account by creator_id, so this must stay untouched.
    const userRow = {
      id: "user-tpl-1",
      slug: "podcast-tighten-episode",
      creator_id: "real-user-xyz",
      name: "My Own Podcast Cut",
      markdown_description: "user content, no seed marker",
      listed_in: ["marketplace"],
      is_active: true,
    }
    store.workflow_templates.push({ ...userRow })

    await seed()

    // the user's row is byte-for-byte intact
    const stillThere = store.workflow_templates.find((r) => r.id === "user-tpl-1")!
    expect(stillThere).toEqual(userRow)
    // no UPDATE ever targeted a workflow_templates row (INSERT path only)
    expect(store.updatePayloads.filter((u) => u.table === "workflow_templates")).toEqual([])
    // a SEPARATE system-owned row was created for the marketplace template
    const systemRows = store.workflow_templates.filter((r) => r.creator_id !== "real-user-xyz")
    expect(systemRows).toHaveLength(1)
    expect(systemRows[0]!.slug).toBe("podcast-tighten-episode")
    expect(systemRows[0]!.listed_in).toEqual(["marketplace"])
  })
})

function cloudOnlyDoc(over: Record<string, unknown> = {}) {
  return {
    slug: "steal-the-format",
    name: "Steal the format",
    markdownDescription: "s1",
    tutorialCategorySlug: "workflows",
    tutorialSortOrder: 45,
    nodes: [
      { id: "recipe", type: "content-recipe", position: { x: 0, y: 0 }, data: {} },
      { id: "ideas", type: "content-ideas", position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [],
    ...over,
  }
}

describe("tutorial seeder — templates built on a Cloud-only node", () => {
  beforeEach(() => {
    store.users.length = 0
    store.profiles.length = 0
    store.projects.length = 0
    store.workflows.length = 0
    store.workflow_templates.length = 0
    store.tutorial_categories.length = 0
    store.seq = 0
    store.fromCalls = 0
    store.updatePayloads.length = 0
    config.NODARO_SEED_MARKETPLACE_TEMPLATES = false
  })

  afterEach(() => {
    config.EDITION = REAL_EDITION
    config.NODARO_SEED_MARKETPLACE_TEMPLATES = REAL_FLAG
  })

  for (const edition of ["community", "business"] as const) {
    it(`${edition}: skips it (and says so), seeds the rest`, async () => {
      config.EDITION = edition
      docs.value = [tutorialDoc(), cloudOnlyDoc()]
      const log = vi.spyOn(console, "log").mockImplementation(() => {})
      try {
        await seed()
        expect(store.workflow_templates.map((r) => r.slug)).toEqual(["welcome-demo"])
        const lines = log.mock.calls.map((c) => String(c[0]))
        expect(lines.some((l) => l.includes("steal-the-format (content-recipe, content-ideas)"))).toBe(true)
      } finally {
        log.mockRestore()
      }
    })
  }

  it("reads the doc's own nodes, not its authored nodeTypesUsed", async () => {
    config.EDITION = "community"
    docs.value = [cloudOnlyDoc({ nodeTypesUsed: ["text-prompt"] })]
    await seed()
    expect(store.workflow_templates).toEqual([])
  })

  it("cloud: a marketplace-listed one seeds like any other built-in", async () => {
    config.EDITION = "cloud"
    config.NODARO_SEED_MARKETPLACE_TEMPLATES = true
    docs.value = [cloudOnlyDoc({ listedIn: ["marketplace"] })]
    await seed()
    expect(store.workflow_templates.map((r) => r.slug)).toEqual(["steal-the-format"])
  })
})

// The podcast templates' Preview is gated in code (decided 2026-10-08): the
// sync writes a render set to Preview only where the preview stop rule
// (PREVIEW_STOP_RULE_ENABLED) is on, and at Final, with the Final graph's
// listing, where it is off. Turning the flag on and restarting flips the row.
describe("tutorial seeder — a template whose render is set to Preview", () => {
  const REAL_STOP_RULE = config.PREVIEW_STOP_RULE_ENABLED
  const setStopRule = (on: boolean) => {
    ;(config as { PREVIEW_STOP_RULE_ENABLED: boolean }).PREVIEW_STOP_RULE_ENABLED = on
  }
  const previewDoc = () =>
    marketplaceDoc({
      estimatedCredits: 132,
      estimatedPerMinuteCredits: 15,
      description: ON_DESCRIPTION,
      withoutPreviewStopRule: {
        estimatedCredits: 82,
        estimatedPerMinuteCredits: 14,
        description: OFF_DESCRIPTION,
        notes: { intro: { text: OFF_NOTE, height: 300 } },
      },
      nodes: [
        {
          id: "intro",
          type: "sticky-note",
          position: { x: 0, y: -400 },
          data: { text: ON_NOTE, height: 440 },
          measured: { width: 460, height: 440 },
        },
        { id: "rec", type: "upload-video", position: { x: 0, y: 0 }, data: {} },
        { id: "render", type: "apply-edl", position: { x: 0, y: 0 }, data: { label: "Apply Cut", quality: "proxy" } },
      ],
      edges: [{ id: "e1", source: "rec", target: "render", targetHandle: "sources" }],
    })
  const ON_DESCRIPTION = "Renders a 720p Preview first; review it, then Render final."
  const OFF_DESCRIPTION = "Renders the final video."
  const ON_NOTE = "Apply Cut renders a Preview first. Review it, then choose Render final."
  const OFF_NOTE = "Apply Cut renders the result."
  const introNote = (nodes: unknown) =>
    (nodes as Array<{ id: string; data: { text?: string; height?: number }; measured?: { height?: number } }>).find(
      (n) => n.id === "intro",
    )!
  /** The description and the intro note, as written to the template row AND its workflow. */
  const texts = (row: Row) => ({
    description: row.description,
    snapshotNote: introNote(row.snapshot_nodes).data.text,
    snapshotHeight: [introNote(row.snapshot_nodes).data.height, introNote(row.snapshot_nodes).measured?.height],
    workflowNote: introNote(workflowOf(row).nodes).data.text,
  })
  const ON_TEXTS = { description: ON_DESCRIPTION, snapshotNote: ON_NOTE, snapshotHeight: [440, 440], workflowNote: ON_NOTE }
  const OFF_TEXTS = { description: OFF_DESCRIPTION, snapshotNote: OFF_NOTE, snapshotHeight: [300, 300], workflowNote: OFF_NOTE }
  const renderQuality = (nodes: unknown) =>
    (nodes as Array<{ id: string; data: { quality?: string } }>).find((n) => n.id === "render")?.data.quality
  const templateRow = () => store.workflow_templates.find((r) => r.slug === "podcast-tighten-episode")!
  const workflowOf = (row: Row) => store.workflows.find((w) => w.id === row.workflow_id)!

  beforeEach(() => {
    config.EDITION = "cloud"
    config.NODARO_SEED_MARKETPLACE_TEMPLATES = true
    store.users.length = 0
    store.profiles.length = 0
    store.projects.length = 0
    store.workflows.length = 0
    store.workflow_templates.length = 0
    store.tutorial_categories.length = 0
    store.seq = 0
    store.fromCalls = 0
    store.updatePayloads.length = 0
    docs.value = [previewDoc()]
  })

  afterEach(() => {
    config.EDITION = REAL_EDITION
    config.NODARO_SEED_MARKETPLACE_TEMPLATES = REAL_FLAG
    setStopRule(REAL_STOP_RULE)
  })

  it("rule off: writes the render at Final, with the Final graph's listing", async () => {
    setStopRule(false)
    await seed()
    const row = templateRow()
    expect(renderQuality(row.snapshot_nodes)).toBe("final")
    expect(renderQuality(workflowOf(row).nodes)).toBe("final")
    expect([row.estimated_credits, row.estimated_per_minute_credits]).toEqual([82, 14])
    expect(texts(row)).toEqual(OFF_TEXTS)
  })

  it("rule on: writes the render at Preview, with the authored listing", async () => {
    setStopRule(true)
    await seed()
    const row = templateRow()
    expect(renderQuality(row.snapshot_nodes)).toBe("proxy")
    expect(renderQuality(workflowOf(row).nodes)).toBe("proxy")
    expect([row.estimated_credits, row.estimated_per_minute_credits]).toEqual([132, 15])
    expect(texts(row)).toEqual(ON_TEXTS)
  })

  it("turning the rule on, then a restart, flips the row; a further restart writes nothing", async () => {
    setStopRule(false)
    await seed()
    expect(renderQuality(templateRow().snapshot_nodes)).toBe("final")
    expect(texts(templateRow())).toEqual(OFF_TEXTS)

    setStopRule(true)
    store.updatePayloads.length = 0
    await seed()
    const row = templateRow()
    expect(store.workflow_templates).toHaveLength(1)
    expect(renderQuality(row.snapshot_nodes)).toBe("proxy")
    expect(renderQuality(workflowOf(row).nodes)).toBe("proxy")
    expect([row.estimated_credits, row.estimated_per_minute_credits]).toEqual([132, 15])
    expect(texts(row)).toEqual(ON_TEXTS)

    store.updatePayloads.length = 0
    await seed()
    expect(store.updatePayloads.filter((u) => u.table === "workflow_templates")).toEqual([])

    // And back: turning it off again writes Final once more.
    setStopRule(false)
    await seed()
    expect(renderQuality(templateRow().snapshot_nodes)).toBe("final")
    expect(templateRow().estimated_credits).toBe(82)
    expect(texts(templateRow())).toEqual(OFF_TEXTS)
  })
})
