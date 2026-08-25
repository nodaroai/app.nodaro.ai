import { describe, it, expect, vi } from "vitest"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadTutorialPacks, parsePackDirList } from "../packs.js"
import type { TutorialPackManifest } from "../types.js"
import { envSchema } from "../../config.js"

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nodaro-packs-"))
}

async function writePack(
  dir: string,
  manifest: TutorialPackManifest,
  docs: Array<Record<string, unknown>>,
): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest))
  for (const d of docs) await writeFile(join(dir, `${d.slug}.json`), JSON.stringify(d))
}

const manifest = (over: Partial<TutorialPackManifest> = {}): TutorialPackManifest => ({
  name: "SAI",
  categories: [{ slug: "sai-basics", name: "SAI Basics", sortOrder: 0 }],
  ...over,
})

const doc = (slug: string, over: Record<string, unknown> = {}) => ({
  slug, name: slug, tutorialCategorySlug: "sai-basics", tutorialSortOrder: 0,
  nodes: [{ id: "n1", type: "generate-image", data: {
    generatedResults: [{ url: "https://cdn.example.com/a.png" }],
  } }],
  edges: [], ...over,
})

describe("parsePackDirList", () => {
  it("splits on commas, trims, drops empties", () => {
    expect(parsePackDirList(" /a , /b ,, /c ")).toEqual(["/a", "/b", "/c"])
  })
  it("returns [] for undefined or blank", () => {
    expect(parsePackDirList(undefined)).toEqual([])
    expect(parsePackDirList("   ")).toEqual([])
  })
})

describe("loadTutorialPacks", () => {
  it("loads a valid pack's docs + categories, ignoring manifest.json as a template", async () => {
    const root = await scratch()
    try {
      await writePack(join(root, "p1"), manifest(), [doc("sai-welcome")])
      const packs = await loadTutorialPacks({ baseSlugs: new Set(), env: join(root, "p1") })
      expect(packs).toHaveLength(1)
      expect(packs[0].docs.map((d) => d.slug)).toEqual(["sai-welcome"])
      expect(packs[0].categories).toEqual([{ slug: "sai-basics", name: "SAI Basics", sortOrder: 0 }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("skips a whole pack (loudly) when any template has an ERROR", async () => {
    const root = await scratch()
    const warn = vi.fn()
    try {
      await writePack(join(root, "p1"), manifest(), [
        doc("good"),
        doc("bad", { nodes: [] }), // empty_flow error
      ])
      const packs = await loadTutorialPacks({ baseSlugs: new Set(), env: join(root, "p1"), warn })
      expect(packs).toEqual([]) // the good doc does NOT partially seed
      expect(warn).toHaveBeenCalled()
      expect(warn.mock.calls.some((c) => String(c[0]).includes("empty_flow"))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("skips a pack whose slug collides with a base template", async () => {
    const root = await scratch()
    const warn = vi.fn()
    try {
      await writePack(join(root, "p1"), manifest(), [doc("welcome-demo")])
      const packs = await loadTutorialPacks({
        baseSlugs: new Set(["welcome-demo"]), env: join(root, "p1"), warn,
      })
      expect(packs).toEqual([])
      expect(warn.mock.calls.some((c) => String(c[0]).includes("slug_conflict"))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("skips the second pack when two packs share a slug, keeps the first", async () => {
    const root = await scratch()
    const warn = vi.fn()
    try {
      await writePack(join(root, "p1"), manifest(), [doc("dup")])
      await writePack(join(root, "p2"), manifest({ name: "SAI2" }), [doc("dup")])
      const packs = await loadTutorialPacks({
        baseSlugs: new Set(), env: `${join(root, "p1")},${join(root, "p2")}`, warn,
      })
      expect(packs.map((p) => p.name)).toEqual(["SAI"])
      expect(warn.mock.calls.some((c) => String(c[0]).includes("slug_conflict"))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("skips a pack with a missing directory (loudly), not throwing", async () => {
    const warn = vi.fn()
    const packs = await loadTutorialPacks({ baseSlugs: new Set(), env: "/no/such/pack/dir", warn })
    expect(packs).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  it("returns [] when the env is unset (inert default)", async () => {
    const packs = await loadTutorialPacks({ baseSlugs: new Set(), env: undefined })
    expect(packs).toEqual([])
  })
})

describe("NODARO_TUTORIAL_PACKS env surface", () => {
  it("is declared in the config env schema with a blank default (inert)", () => {
    // Only the fields envSchema marks required need supplying — the two Supabase
    // keys plus INTERNAL_ORCHESTRATOR_SECRET (>=32 chars); everything else,
    // NODARO_TUTORIAL_PACKS included, resolves from its default.
    const parsed = envSchema.parse({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "k",
      INTERNAL_ORCHESTRATOR_SECRET: "x".repeat(32),
    })
    expect(parsed.NODARO_TUTORIAL_PACKS).toBe("")
  })
})
