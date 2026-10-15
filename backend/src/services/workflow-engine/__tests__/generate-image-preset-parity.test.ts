// @test-watches frontend/src/types/nodes.ts
/**
 * Applying a Generate Image preset anywhere sends the editor's request.
 *
 * The editor applies a preset by writing it onto a Generate Image node (the
 * node's defaults, then `presetApplyClearKeys`, then the preset's data — the
 * dropdown's `buildPresetApplyPatch`) and Run builds the request from that
 * node. `buildPayload` is that build, so it is the reference here.
 *
 * `POST /v1/generate-image { presetId }` — which the MCP `generate_image` tool
 * and every SDK app reach — must send the same job for EVERY factory preset:
 * the same final prompt (placeholder defaults filled, `style` folded in, the
 * negative prompt folded in as "Avoid:" or sent natively as the model takes
 * it), the same model and levers, and the same credit id. A new preset or a new
 * preset data field is swept in automatically.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const customRow = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }))

const mocks = vi.hoisted(() => ({
  jobInsert: vi.fn(),
  queueAdd: vi.fn(),
  reserveCreditsForJob: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  // The jobs insert, plus the custom-preset lookup (`node_presets`: no row).
  supabase: {
    from: vi.fn(() => {
      const chain: Record<string, unknown> = { eq: () => chain, maybeSingle: async () => ({ data: customRow.value, error: null }) }
      return { insert: mocks.jobInsert, select: () => chain }
    }),
  },
}))
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: mocks.queueAdd },
  redis: {},
  tryRemoveFromQueue: vi.fn(),
}))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: mocks.reserveCreditsForJob,
}))
vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/lib/credit-audit.js", () => ({
  logCreditAudit: vi.fn(),
  extractCreditFields: vi.fn(),
}))

import { getFactoryPresets } from "@nodaro/prompts/presets"
import { presetApplyClearKeys } from "@nodaro/shared/nodes"
import { generateImageRoutes } from "../../../routes/generate-image.js"
import { buildPayload } from "../payload-builder.js"
import { GENERATE_IMAGE_EDITOR_DEFAULTS } from "../../../lib/presets/apply-image-preset.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"

/** The Generate Image node's `defaultData` in `NODE_DEFINITIONS`, read from the
 *  frontend source: the state a preset is applied onto in the editor. */
function editorDefaultData(): Record<string, unknown> {
  const src = readFileSync(join(__dirname, "../../../../../frontend/src/types/nodes.ts"), "utf8")
  const at = src.indexOf('type: "generate-image",')
  const line = src.slice(at).match(/defaultData: (\{[^\r\n]*\}),\r?\n/)
  if (!line) throw new Error("generate-image defaultData not found in NODE_DEFINITIONS")
  return new Function(`return (${line[1]})`)() as Record<string, unknown>
}

/** The node the editor holds after applying `presetData` (the dropdown's patch). */
function editorNode(presetData: Record<string, unknown>): Record<string, unknown> {
  return {
    ...editorDefaultData(),
    ...Object.fromEntries(presetApplyClearKeys(presetData, "generate-image").map((k) => [k, undefined])),
    ...presetData,
  }
}

interface Job {
  prompt: unknown
  negativePrompt: unknown
  model: unknown
  aspectRatio: unknown
  resolution: unknown
  quality: unknown
  creditId: unknown
  /** Every other field the job carries that a preset can set. */
  rest: Record<string, unknown>
}

const REST_KEYS = ["referenceImageUrls", "seed", "renderingSpeed", "styleType", "expandPrompt", "baseImageUrl", "maskUrl", "strength", "guidanceScale"] as const
function restOf(p: Record<string, unknown>): Record<string, unknown> {
  // An empty reference list and an absent one are the same request.
  return Object.fromEntries(REST_KEYS.map((k) => [k, k === "referenceImageUrls" && Array.isArray(p[k]) && (p[k] as unknown[]).length === 0 ? undefined : p[k]]))
}

function editorJob(data: Record<string, unknown>): Job {
  const built = buildPayload({ id: "gen-1", type: "generate-image", data }, "job-1", {})
  const p = built.payload as Record<string, unknown>
  return {
    prompt: p.prompt,
    negativePrompt: p.negativePrompt,
    model: p.model ?? p.provider,
    aspectRatio: p.aspectRatio,
    resolution: p.resolution,
    quality: p.quality,
    creditId: built.modelIdentifier,
    rest: restOf(p),
  }
}

let app: FastifyInstance

async function post(body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/generate-image", payload: body })
}

async function routeJob(body: Record<string, unknown>): Promise<Job> {
  const res = await post(body)
  expect(res.statusCode, res.body).toBe(200)
  const [, p] = mocks.queueAdd.mock.calls.at(-1) as [string, Record<string, unknown>]
  return {
    prompt: p.prompt,
    negativePrompt: p.negativePrompt,
    model: p.model ?? p.provider,
    aspectRatio: p.aspectRatio,
    resolution: p.resolution,
    quality: p.quality,
    creditId: mocks.reserveCreditsForJob.mock.calls.at(-1)?.[3],
    rest: restOf(p),
  }
}

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER_ID
  })
  await app.register(async (instance) => {
    await generateImageRoutes(instance)
  })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.jobInsert.mockImplementation(() => ({
    select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }),
  }))
  mocks.queueAdd.mockResolvedValue({ id: "queue-job-1" })
  mocks.reserveCreditsForJob.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false })
})

const PRESETS = getFactoryPresets("generate-image") as unknown as Array<{ id: string; data: Record<string, unknown> }>

/** The editor's refusal for a preset whose text names a placeholder with no
 *  default: the token list it reports, or null when it builds. */
function editorRefusal(data: Record<string, unknown>): string[] | null {
  try {
    editorJob(data)
    return null
  } catch (err) {
    const e = err as Error & { code?: string }
    if (e.code !== "unresolved_reference") throw err
    // "... references {A}, {B}, which no connected node provides ..."
    const named = e.message.split(" references ")[1]!.split(", which ")[0]!
    return [...named.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!).sort()
  }
}

describe("the server's editor defaults are the editor's", () => {
  it("match NODE_DEFINITIONS generate-image defaultData on every lever a preset can leave unset", () => {
    const fe = editorDefaultData()
    for (const [k, v] of Object.entries(GENERATE_IMAGE_EDITOR_DEFAULTS)) expect(fe[k], k).toEqual(v)
  })
})

describe("POST /v1/generate-image { presetId } sends the editor's request for every factory preset", () => {
  it("sweeps the whole catalog, including the Stylized Subject and Edits catalogs", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(150)
    const groups = new Set(PRESETS.map((p) => (p as { group?: string }).group))
    expect(groups.has("Stylized Subject")).toBe(true)
    expect(groups.has("Edits")).toBe(true)
  })

  it.each(PRESETS.map((p) => [p.id, p] as const))("%s", async (_id, preset) => {
    const data = editorNode(preset.data)
    const refused = editorRefusal(data)
    if (refused) {
      // The editor refuses a placeholder with no default; so does the route,
      // naming the same placeholders, and it builds once they are passed.
      const res = await post({ presetId: preset.id })
      expect(res.statusCode, res.body).toBe(400)
      const body = res.json() as { error: { code: string; tokens: string[] } }
      expect(body.error.code).toBe("preset_variables_required")
      expect([...body.error.tokens].sort()).toEqual(refused)
      const filled = await routeJob({
        presetId: preset.id,
        presetVariables: Object.fromEntries(refused.map((t) => [t, `the ${t} value`])),
      })
      for (const t of refused) {
        expect(filled.prompt).not.toContain(`{${t}}`)
        expect(filled.prompt).toContain(`the ${t} value`)
      }
      return
    }
    expect(await routeJob({ presetId: preset.id })).toEqual(editorJob(data))
  })
})

describe("explicit fields override the preset, as an edit on the applied node would", () => {
  const preset = PRESETS.find((p) => typeof p.data.style === "string" && p.data.style && p.data.negativePrompt)!

  it("a caller prompt replaces the preset's prompt; the preset's style and negative still fold in once", async () => {
    const data = editorNode(preset.data)
    const job = await routeJob({ presetId: preset.id, prompt: "a lighthouse at dusk" })
    expect(job).toEqual(editorJob({ ...data, prompt: "a lighthouse at dusk" }))
  })

  it("a caller's levers win", async () => {
    const data = editorNode(preset.data)
    const job = await routeJob({ presetId: preset.id, aspectRatio: "1:1", provider: "gpt-image-2" })
    expect(job).toEqual(editorJob({ ...data, aspectRatio: "1:1", provider: "gpt-image-2" }))
  })

  it("a caller's own pre/post text wraps once, as on the node", async () => {
    const data = editorNode(preset.data)
    const job = await routeJob({ presetId: preset.id, prompt: "a fox", promptPrefix: "PRE", promptSuffix: "POST" })
    expect(job).toEqual(editorJob({ ...data, prompt: "a fox", promptPrefix: "PRE", promptSuffix: "POST" }))
  })

  it("the job records no preset control field", async () => {
    await routeJob({ presetId: preset.id })
    const [row] = mocks.jobInsert.mock.calls.at(-1) as [{ input_data: Record<string, unknown> }]
    expect(row.input_data).not.toHaveProperty("presetId")
    expect(row.input_data).not.toHaveProperty("presetVariables")
    expect(row.input_data).not.toHaveProperty("promptPrefix")
    expect(row.input_data).not.toHaveProperty("promptSuffix")
  })

  it("an unknown presetId is a 404 and creates nothing", async () => {
    const res = await post({ presetId: "generate-image/no-such-preset" })
    expect(res.statusCode).toBe(404)
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })
})

describe("a saved custom preset carrying every field a preset can hold", () => {
  const CUSTOM_ID = "00000000-0000-4000-8000-0000000000c1"
  const FULL = {
    prompt: "a red fox {mood || at dawn}",
    promptPrefix: "Wildlife photo:",
    promptSuffix: "Sharp focus.",
    provider: "gpt-image-2",
    aspectRatio: "1:1",
    resolution: "2K",
    quality: "high",
    negativePrompt: "blurry, watermark",
    style: "watercolor",
    referenceImageUrls: [{ id: "r1", url: "https://cdn.example.com/refs/fox.png" }],
    seed: 42,
    renderingSpeed: "TURBO",
    styleType: "REALISTIC",
    expandPrompt: false,
    strength: 0.6,
    guidanceScale: 7,
    structured: { mood: "serene" },
  }

  afterAll(() => {
    customRow.value = null
  })

  it("runs as the editor's build of the same node", async () => {
    customRow.value = { id: CUSTOM_ID, name: "Fox", description: null, data: FULL }
    const job = await routeJob({ presetId: CUSTOM_ID })
    expect(job).toEqual(editorJob(editorNode(FULL)))
    expect(job.rest.referenceImageUrls).toEqual(["https://cdn.example.com/refs/fox.png"])
  })

  it("a caller's structured fields replace the preset's, folded once with its style and negative", async () => {
    customRow.value = { id: CUSTOM_ID, name: "Fox", description: null, data: FULL }
    const job = await routeJob({ presetId: CUSTOM_ID, structured: { mood: "stormy" } })
    expect(job).toEqual(editorJob({ ...editorNode(FULL), structured: { mood: "stormy" } }))
    expect(String(job.prompt).match(/Avoid:/g)?.length ?? 0).toBeLessThanOrEqual(1)
  })

  it("a settings-only preset with no prompt given is refused before any credit is held", async () => {
    customRow.value = { id: CUSTOM_ID, name: "Bare", description: null, data: { provider: "gpt-image-2", aspectRatio: "1:1" } }
    const res = await post({ presetId: CUSTOM_ID })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { code: string } }).error.code).toBe("no_prompt")
    expect(mocks.reserveCreditsForJob).not.toHaveBeenCalled()
  })
})
