// @test-watches backend/src/lib/mcp/__tests__/fixtures/model-run-nodes.json backend/src/lib/mcp/**/*.ts
/**
 * `list_models` lists a model only where something offered to the session can
 * run it (lib/mcp/model-run-nodes.ts, decided 2026-11-16). Which nodes run each
 * catalog model is DERIVED; the table is pinned in
 * fixtures/model-run-nodes.json so a change to it shows up in review. Rewrite
 * it with the change it belongs to:
 *   cd backend && UPDATE_MODEL_RUN_NODES=1 npx vitest run src/lib/mcp/__tests__/model-run-nodes.test.ts
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import Fastify from "fastify"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ALL_SCOPES } from "../../scopes.js"

vi.hoisted(() => {
  for (const key of ["NODARO_SURFACE_PROFILE", "NODARO_PRICE_ANNOTATIONS", "DEPLOYMENT_WALLET_URL", "DEPLOYMENT_WALLET_TOKEN", "DEPLOYMENT_WALLET_SSO_PROVIDER"]) {
    process.env[key] = ""
  }
})

const h = vi.hoisted(() => ({ admins: new Set<string>() }))
vi.mock("../../supabase.js", async () => {
  const { fakeSupabaseFrom: from } = await import("./_amounts-harness.js")
  return { supabase: { from: from(() => ({})), rpc: async () => ({ data: null, error: null }) } }
})
vi.mock("../../admin-check.js", () => ({ checkIsAdmin: async (userId: string) => h.admins.has(userId), warmAdminCache: () => {} }))
vi.mock("../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => true }
})

const { buildMcpServer } = await import("../server.js")
const { createMcpInvoker } = await import("../invoke.js")
const { NO_DERIVABLE_NODE, modelRunNodes } = await import("../model-run-nodes.js")
const { MODEL_CATALOG } = await import("@nodaro/shared/model-catalog")
const { __resetSurfaceProfileCacheForTests } = await import("../../surface-profile.js")
const { __resetAvailabilityOverridesForTests, __availabilityUniverseReadyForTests, storedNodesEnabled, GATEABLE_NODE_TYPES } = await import("../../availability-override.js")

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(here, "fixtures/model-run-nodes.json")

/** The small offer the decision was made for (tool-offer.test.ts): four nodes, no feature, no link imports. */
const SMALL_OFFER = { nodes: { allow: ["generate-image", "generate-video", "text-to-speech", "upload-image"] }, imports: { links: false } }

function setProfile(profile: object | null): void {
  if (profile === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

function overrideLeavingOff(...left: string[]): Set<string> {
  return new Set(storedNodesEnabled([...GATEABLE_NODE_TYPES].filter((t) => !left.includes(t))))
}

interface Listing {
  sections: Array<{ kind: string; families: Array<{ family: string; models: Array<{ id: string }> }> }>
  recommendations: Array<{ modelIds: string[] }>
  totalModels: number
}

async function listModels(args: Record<string, unknown> = {}, userId = "u1"): Promise<Listing> {
  const server = await buildMcpServer({ userId, scopes: [...ALL_SCOPES], clientName: "Claude", fastify: Fastify() })
  const res = await createMcpInvoker(server).callTool("list_models", args)
  return JSON.parse(res.content.map((c) => c.text ?? "").join("")) as Listing
}

const idsOf = (l: Listing) => l.sections.flatMap((s) => s.families.flatMap((f) => f.models.map((m) => m.id))).sort()
const byKind = (l: Listing) => Object.fromEntries(l.sections.map((s) => [s.kind, s.families.reduce((n, f) => n + f.models.length, 0)]))

let unrestricted: Listing

beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
  setProfile(null)
  unrestricted = await listModels()
}, 120_000)

afterEach(() => {
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  h.admins = new Set()
})

describe("which nodes run each catalog model (derived)", () => {
  it("is recorded in fixtures/model-run-nodes.json", async () => {
    const table = await modelRunNodes()
    const actual = Object.fromEntries(Object.keys(MODEL_CATALOG).sort().map((id) => [id, [...(table.get(id) ?? [])].sort().join(" ") || "-"]))
    if (process.env.UPDATE_MODEL_RUN_NODES === "1") {
      writeFileSync(FIXTURE_PATH, `${JSON.stringify(actual, null, 1)}\n`)
      return
    }
    expect(actual, "the derived table changed — rewrite fixtures/model-run-nodes.json (UPDATE_MODEL_RUN_NODES=1) in the same change").toEqual(
      JSON.parse(readFileSync(FIXTURE_PATH, "utf8")),
    )
  })

  it("a model no rule gives a node is kept, and named with why (held both ways)", async () => {
    const table = await modelRunNodes()
    const none = Object.keys(MODEL_CATALOG).filter((id) => !table.has(id)).sort()
    expect(Object.keys(NO_DERIVABLE_NODE).sort()).toEqual(none)
    for (const why of Object.values(NO_DERIVABLE_NODE)) expect(why.length).toBeGreaterThan(20)
  })

  it("every node it names is one a deployment can withhold (else its models would always be listed)", async () => {
    const table = await modelRunNodes()
    const named = new Set([...table.values()].flatMap((s) => [...s]))
    expect([...named].filter((t) => !GATEABLE_NODE_TYPES.has(t)).sort()).toEqual([])
  })
})

describe("list_models", () => {
  it("restricts nothing: lists what it always did", async () => {
    expect(await listModels()).toEqual(unrestricted)
  })

  it("the small offer lists the image, video and speech models those nodes run, and the models no rule gives a node", async () => {
    setProfile(SMALL_OFFER)
    const listed = await listModels()
    expect(byKind(unrestricted)).toEqual(UNRESTRICTED_BY_KIND)
    expect(byKind(listed)).toEqual(SMALL_OFFER_BY_KIND)
    const table = await modelRunNodes()
    for (const id of idsOf(listed)) {
      const nodes = table.get(id)
      expect(nodes === undefined || SMALL_OFFER.nodes.allow.some((t) => nodes.has(t)), id).toBe(true)
    }
    // A music model, an image editor, an upscaler, a lip-sync model, a dialogue model, a transcriber: no offered node runs them.
    for (const id of ["suno-v5", "nano-banana-edit", "recraft-upscale", "kling-avatar", "elevenlabs-dialogue", "elevenlabs-stt"]) {
      expect(idsOf(unrestricted), id).toContain(id)
      expect(idsOf(listed), id).not.toContain(id)
    }
    expect(listed.totalModels).toBe(idsOf(listed).length)
  })

  it("the small offer with its worlds narrowed lists the same; image and video generation alone lists no speech model", async () => {
    setProfile({ ...SMALL_OFFER, worlds: { allow: ["image", "video"] } })
    expect(byKind(await listModels())).toEqual(SMALL_OFFER_BY_KIND)
    setProfile({ nodes: { allow: ["generate-image", "generate-video"] } })
    const listed = await listModels()
    expect(byKind(listed)).toEqual(IMAGE_AND_VIDEO_BY_KIND)
    for (const id of ["elevenlabs-v4", "elevenlabs-stt"]) expect(idsOf(listed), id).not.toContain(id)
  })

  it("its recommendations name only listed models", async () => {
    setProfile(SMALL_OFFER)
    const listed = await listModels()
    const ids = new Set(idsOf(listed))
    for (const rec of listed.recommendations) for (const id of rec.modelIds) expect(ids.has(id) || !idsOf(unrestricted).includes(id), id).toBe(true)
    expect(listed.recommendations.length).toBeLessThan(unrestricted.recommendations.length)
  })

  it.each([
    ["an entity's sheet (Character) without Generate Image", ["character"], "image", "gpt-image-2"],
    ["an entity's motion (Character) without Generate Video", ["character"], "video", "kling"],
    ["Suno Cover alone", ["suno-cover"], "audio", "suno-v5"],
    ["Generate Video Pro alone", ["generate-video-pro"], "video", "seedance-2"],
  ])("a node that runs a model through its own route keeps it listed: %s", async (_case, allow, kind, id) => {
    setProfile({ nodes: { allow } })
    const listed = await listModels({ kind })
    expect(idsOf(listed)).toContain(id)
  })

  it("a family filter keeps working", async () => {
    setProfile(SMALL_OFFER)
    const google = await listModels({ family: "Google" })
    expect(idsOf(google).length).toBeGreaterThan(0)
    expect(google.sections.every((s) => s.families.every((f) => f.family === "Google"))).toBe(true)
  })

  it("a model the deployment withholds stays out, whatever node runs it", async () => {
    setProfile({ ...SMALL_OFFER, models: { deny: ["gpt-image-2"] } })
    expect(idsOf(await listModels())).not.toContain("gpt-image-2")
  })

  it("an admin who is offered a node users are not sees its models", async () => {
    h.admins = new Set(["admin-1"])
    __resetAvailabilityOverridesForTests({ nodes: overrideLeavingOff("suno-generate", "suno-cover", "suno-extend", "suno-mashup", "suno-add-instrumental", "suno-add-vocals", "suno-upload-extend") })
    expect(idsOf(await listModels({ kind: "audio" }, "u1"))).not.toContain("suno-v5")
    expect(idsOf(await listModels({ kind: "audio" }, "admin-1"))).toContain("suno-v5")
  })
})

/** Calls and tables a surface lists catalog models (or picks of them) from. */
const LISTS_MODELS = /\blistModels\(|\bgroupByKindAndFamily\(|\bfilterDeniedModels\(|\bMODEL_RECOMMENDATIONS\b|\brecommendationsServedHere\(/

/** Every file of the MCP lane that lists catalog models: each one applies the node rule. */
const MODEL_LISTING_FILES = ["tools/models.ts"]

describe("totality: every surface of the lane that lists models applies the node rule", () => {
  it("each file that lists catalog models is named here and asks model-run-nodes.ts (held both ways)", () => {
    const mcpDir = resolve(here, "..")
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.name === "__tests__" ? [] : e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
      )
    const found = walk(mcpDir)
      .filter((p) => LISTS_MODELS.test(readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l)).join("\n")))
      .map((p) => relative(mcpDir, p))
      .sort()
    expect(found).toEqual(MODEL_LISTING_FILES)
    for (const file of found) expect(readFileSync(join(mcpDir, file), "utf8"), file).toMatch(/\bmodelListedTo\(/)
  })
})

/** How many models each kind lists, before (nothing restricted) and on the small offer. */
const UNRESTRICTED_BY_KIND = { image: 61, video: 89, audio: 31 }
const SMALL_OFFER_BY_KIND = { image: 50, video: 48, audio: 9 }
const IMAGE_AND_VIDEO_BY_KIND = { image: 50, video: 48 }
