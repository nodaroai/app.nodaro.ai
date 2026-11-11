/**
 * Gating generations (lib/availability-override.ts): `cast-swap` (Nodaro
 * Motion, every trend run) became gateable long after deployments started
 * storing Admin → Availability overrides. An override is an ENABLED-SET, so
 * one stored before that never lists cast-swap — read as it always was, it
 * would switch Motion off for every user of every deployment that ever saved
 * the page, Nodaro's own production included.
 *
 * So a stored override records the generation of the code that saved it, and
 * a gate newer than the override is answered by the FACTORY layer (the
 * profile's allow/deny) until the next save decides it. These pin both sides —
 * an old stored override and one saved by this code — through the real store
 * round trip and the admin page's read.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"

const db = vi.hoisted(() => ({
  rows: [] as Array<{ kind: string; enabled: unknown[] }>,
  upserts: [] as Array<{ kind: string; enabled: string[] }>,
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: async () => ({ data: db.rows, error: null }),
      upsert: async (row: { kind: string; enabled: string[] }) => {
        db.upserts.push(row)
        return { error: null }
      },
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}))
// A few rows keep the universe fill instant (the real registry drags the credits graph in).
vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "generate-image", label: "Generate Image", category: "ai-image" },
    { type: "suno-generate", label: "Suno Create Music", category: "ai-audio" },
    { type: "pitch-tempo", label: "Pitch & Tempo", category: "processing" },
    { type: "sticky-note", label: "Sticky Note", category: "utility" },
  ],
}))
vi.mock("@/ee/middleware/require-admin.js", () => ({ requireAdmin: async () => {} }))

import {
  availabilityOverride,
  loadAvailabilityOverridesForScript,
  nodesOverrideGeneration,
  saveAvailabilityOverride,
  storedNodesEnabled,
  __availabilityUniverseReadyForTests,
  __resetAvailabilityOverridesForTests,
  GATEABLE_NODE_TYPES,
  GATING_GENERATION,
} from "../availability-override.js"
import { isNodeDenied, effectiveDeniedNodeTypes, USER_VIEWER, ADMIN_VIEWER } from "../surface-deny.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"
import { adminAvailabilityRoutes } from "../../ee/routes/admin-availability.js"

function setProfile(profile: object | null): void {
  if (profile === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

/** What the store holds, then read back as a booting process reads it. */
async function storedRow(enabled: unknown[]): Promise<void> {
  db.rows = [{ kind: "nodes", enabled }]
  __resetAvailabilityOverridesForTests()
  expect(await loadAvailabilityOverridesForScript()).toBe(true)
}

beforeAll(() => __availabilityUniverseReadyForTests())
beforeEach(() => {
  db.rows = []
  db.upserts = []
})
afterEach(() => {
  setProfile(null)
  __resetAvailabilityOverridesForTests()
})

describe("cast-swap is gateable — with no canvas node", () => {
  it("is in the gateable universe", () => {
    expect(GATEABLE_NODE_TYPES.has("cast-swap")).toBe(true)
  })

  it("follows the profile with no override stored: on without lists, off when a whitelist leaves it out", () => {
    expect(isNodeDenied("cast-swap", USER_VIEWER)).toBe(false)
    setProfile({ nodes: { allow: ["generate-image"] } })
    expect(isNodeDenied("cast-swap", USER_VIEWER)).toBe(true)
    expect(effectiveDeniedNodeTypes(USER_VIEWER)).toContain("cast-swap")
    setProfile({ nodes: { allow: ["generate-image", "cast-swap"] } })
    expect(isNodeDenied("cast-swap", USER_VIEWER)).toBe(false)
  })
})

describe("an override stored BEFORE cast-swap was gateable (no generation)", () => {
  // What Nodaro production holds: every node it had then, cast-swap never listed.
  const OLD_ROW = ["generate-image", "suno-generate"]

  it("reads back at generation 0", async () => {
    await storedRow(OLD_ROW)
    expect(nodesOverrideGeneration()).toBe(0)
    expect([...(availabilityOverride("nodes") ?? [])].sort()).toEqual(["generate-image", "suno-generate"])
  })

  it("does NOT switch Nodaro Motion off: cast-swap falls back to the factory set (available)", async () => {
    await storedRow(OLD_ROW)
    expect(isNodeDenied("cast-swap", USER_VIEWER)).toBe(false)
    expect(isNodeDenied("cast-swap", ADMIN_VIEWER)).toBe(false)
    expect(effectiveDeniedNodeTypes(USER_VIEWER)).not.toContain("cast-swap")
  })

  it("on a whitelist deployment the factory set still withholds it", async () => {
    setProfile({ nodes: { allow: ["generate-image"] } })
    await storedRow(OLD_ROW)
    expect(isNodeDenied("cast-swap", USER_VIEWER)).toBe(true)
  })

  it("keeps the release switch for everything else: a node it does not list is withheld from users", async () => {
    await storedRow(OLD_ROW)
    expect(isNodeDenied("pitch-tempo", USER_VIEWER)).toBe(true)
    expect(isNodeDenied("pitch-tempo", ADMIN_VIEWER)).toBe(false)
    expect(isNodeDenied("generate-image", USER_VIEWER)).toBe(false)
  })

  it("decides no newer door either: a route gate of a later generation answers from the factory set", async () => {
    await storedRow(["generate-image"])
    expect(isNodeDenied("suno-generate", USER_VIEWER)).toBe(true)
    expect(isNodeDenied("suno-generate", USER_VIEWER, 1)).toBe(false)
  })
})

describe("an override saved by this code (generation stored)", () => {
  it("stores its generation inside the enabled set — the client cannot forge one — and reads back clean", async () => {
    await saveAvailabilityOverride("nodes", ["generate-image", "@gating-generation:99", "not-a-node"])
    expect(db.upserts).toHaveLength(1)
    expect(db.upserts[0]!.enabled).toEqual(["generate-image", `@gating-generation:${GATING_GENERATION}`])
    expect([...(availabilityOverride("nodes") ?? [])]).toEqual(["generate-image"])
    expect(nodesOverrideGeneration()).toBe(GATING_GENERATION)

    await storedRow(db.upserts[0]!.enabled)
    expect(nodesOverrideGeneration()).toBe(GATING_GENERATION)
    expect([...(availabilityOverride("nodes") ?? [])]).toEqual(["generate-image"])
  })

  it("withholds cast-swap from users when it was left off — admins keep it", async () => {
    await storedRow(storedNodesEnabled(["generate-image", "suno-generate"]))
    expect(isNodeDenied("cast-swap", USER_VIEWER)).toBe(true)
    expect(isNodeDenied("cast-swap", ADMIN_VIEWER)).toBe(false)
    expect(isNodeDenied("suno-generate", USER_VIEWER, 1)).toBe(false)
  })

  it("releases cast-swap when it was ticked, past a whitelist that leaves it out (the override replaces it)", async () => {
    setProfile({ nodes: { allow: ["generate-image"] } })
    await storedRow(storedNodesEnabled(["generate-image", "cast-swap"]))
    expect(isNodeDenied("cast-swap", USER_VIEWER)).toBe(false)
  })

  it("decides the newer doors it was saved knowing", async () => {
    await storedRow(storedNodesEnabled(["generate-image"]))
    expect(isNodeDenied("suno-generate", USER_VIEWER, 1)).toBe(true)
  })

  it("re-saved by an older build (which drops the entry) reads as generation 0 again — the safe direction", async () => {
    // An older build rewrites `enabled` from the ids it knows: the generation entry is gone.
    await storedRow(["generate-image", "suno-generate"])
    expect(isNodeDenied("cast-swap", USER_VIEWER)).toBe(false)
  })

  it("a models override carries no generation", async () => {
    await saveAvailabilityOverride("models", ["flux"])
    expect(db.upserts[0]).toMatchObject({ kind: "models", enabled: ["flux"] })
  })
})

/**
 * The film pipeline (`film-pipeline`) and the Video Director (`video-director`)
 * became gateable at generation 2, after cast-swap. Both served users long
 * before. Nodaro production holds a stored override saved before them — at
 * generation 0 or at generation 1 (by the code that made cast-swap gateable),
 * and either way it never lists them. Read as an enabled-set, that would switch
 * both off for every user; the factory set must answer instead.
 */
describe("the film pipeline and the Video Director: gateable features that were live before (generation 2)", () => {
  const FEATURES = ["film-pipeline", "video-director"] as const

  it("are in the gateable universe, at a generation newer than cast-swap", () => {
    for (const id of FEATURES) expect(GATEABLE_NODE_TYPES.has(id), id).toBe(true)
    expect(GATING_GENERATION).toBe(2)
  })

  it("follow the profile with no override stored: on without lists, off when a whitelist leaves them out", () => {
    for (const id of FEATURES) expect(isNodeDenied(id, USER_VIEWER), id).toBe(false)
    setProfile({ nodes: { allow: ["generate-image"] } })
    for (const id of FEATURES) expect(isNodeDenied(id, USER_VIEWER), id).toBe(true)
    setProfile({ nodes: { allow: ["generate-image", ...FEATURES] } })
    for (const id of FEATURES) expect(isNodeDenied(id, USER_VIEWER), id).toBe(false)
    setProfile({ nodes: { deny: ["video-director"] } })
    expect(isNodeDenied("film-pipeline", USER_VIEWER)).toBe(false)
    expect(isNodeDenied("video-director", USER_VIEWER)).toBe(true)
  })

  it("an override stored at generation 1 (it knew cast-swap, not these) does NOT switch them off", async () => {
    // What production may hold: saved by the code that made cast-swap gateable.
    await storedRow(storedNodesEnabled(["generate-image", "suno-generate", "cast-swap"], 1))
    expect(nodesOverrideGeneration()).toBe(1)
    for (const id of FEATURES) {
      expect(isNodeDenied(id, USER_VIEWER), id).toBe(false)
      expect(isNodeDenied(id, ADMIN_VIEWER), id).toBe(false)
    }
    for (const id of FEATURES) expect(effectiveDeniedNodeTypes(USER_VIEWER), id).not.toContain(id)
    // Everything it did decide stays decided: the release switch is unchanged.
    expect(isNodeDenied("pitch-tempo", USER_VIEWER)).toBe(true)
    expect(isNodeDenied("cast-swap", USER_VIEWER)).toBe(false)
  })

  it("an override stored at generation 1 that left cast-swap OFF keeps it off, and still decides neither feature", async () => {
    await storedRow(storedNodesEnabled(["generate-image"], 1))
    expect(isNodeDenied("cast-swap", USER_VIEWER)).toBe(true)
    for (const id of FEATURES) expect(isNodeDenied(id, USER_VIEWER), id).toBe(false)
  })

  it("an override stored before any generation does not switch them off either", async () => {
    await storedRow(["generate-image", "suno-generate"])
    for (const id of FEATURES) expect(isNodeDenied(id, USER_VIEWER), id).toBe(false)
  })

  it("under a whitelist that leaves them out, an older override changes nothing: the factory set withholds them", async () => {
    setProfile({ nodes: { allow: ["generate-image"] } })
    await storedRow(storedNodesEnabled(["generate-image", "cast-swap"], 1))
    for (const id of FEATURES) expect(isNodeDenied(id, USER_VIEWER), id).toBe(true)
  })

  it("an override saved by this code decides them: left off withholds them from users (admins keep them), ticked releases them", async () => {
    await storedRow(storedNodesEnabled(["generate-image"]))
    for (const id of FEATURES) {
      expect(isNodeDenied(id, USER_VIEWER), id).toBe(true)
      expect(isNodeDenied(id, ADMIN_VIEWER), id).toBe(false)
    }
    setProfile({ nodes: { allow: ["generate-image"] } })
    await storedRow(storedNodesEnabled(["generate-image", ...FEATURES]))
    for (const id of FEATURES) expect(isNodeDenied(id, USER_VIEWER), id).toBe(false)
  })

  it("re-saved by the previous build (generation 1, which does not know them) reads as undecided again", async () => {
    await storedRow(storedNodesEnabled(["generate-image"], 1))
    for (const id of FEATURES) expect(isNodeDenied(id, USER_VIEWER), id).toBe(false)
  })
})

describe("the admin page shows what users get", () => {
  async function getAvailability() {
    const app = Fastify({ logger: false })
    await app.register(adminAvailabilityRoutes)
    const res = await app.inject({ method: "GET", url: "/v1/admin/availability" })
    await app.close()
    return res.json() as {
      nodes: { items: Array<{ id: string; category: string; enabled: boolean; factoryEnabled: boolean }>; overridden: boolean; gating?: { stored: number; current: number } }
    }
  }

  it("lists Nodaro Motion among the nodes", async () => {
    const body = await getAvailability()
    expect(body.nodes.items.find((i) => i.id === "cast-swap")).toMatchObject({ category: "ai-video", enabled: true, factoryEnabled: true })
    expect(body.nodes.items.find((i) => i.id === "sticky-note")).toBeUndefined()
  })

  it("under an old stored override: cast-swap shows its factory state, and the page is told the override is older", async () => {
    await storedRow(["generate-image"])
    const body = await getAvailability()
    expect(body.nodes.items.find((i) => i.id === "cast-swap")?.enabled).toBe(true)
    expect(body.nodes.items.find((i) => i.id === "pitch-tempo")?.enabled).toBe(false)
    expect(body.nodes.gating).toEqual({ stored: 0, current: GATING_GENERATION })
  })

  it("lists the film pipeline and the Video Director, with their factory state under an override saved before them", async () => {
    let body = await getAvailability()
    expect(body.nodes.items.find((i) => i.id === "film-pipeline")).toMatchObject({ category: "composition", enabled: true, factoryEnabled: true })
    expect(body.nodes.items.find((i) => i.id === "video-director")).toMatchObject({ category: "composition", enabled: true, factoryEnabled: true })
    await storedRow(storedNodesEnabled(["generate-image", "cast-swap"], 1))
    body = await getAvailability()
    expect(body.nodes.items.find((i) => i.id === "film-pipeline")?.enabled).toBe(true)
    expect(body.nodes.items.find((i) => i.id === "video-director")?.enabled).toBe(true)
    expect(body.nodes.items.find((i) => i.id === "cast-swap")?.enabled).toBe(true)
    expect(body.nodes.gating).toEqual({ stored: 1, current: GATING_GENERATION })
  })

  it("under an override saved by this code: cast-swap shows the stored choice", async () => {
    await storedRow(storedNodesEnabled(["generate-image"]))
    const body = await getAvailability()
    expect(body.nodes.items.find((i) => i.id === "cast-swap")?.enabled).toBe(false)
    expect(body.nodes.gating).toEqual({ stored: GATING_GENERATION, current: GATING_GENERATION })
  })
})
