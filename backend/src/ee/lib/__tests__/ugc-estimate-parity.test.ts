import { BODY_CAPTIONS_PRESET_ID, getFactoryPresets } from "@nodaro/prompts"
import { DEFAULT_TRANSCRIBE_NODE_PROVIDER } from "@nodaro/shared"
import Fastify, { type FastifyInstance } from "fastify"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Parity (spec §6.7): the fixed lines of the canvas quote each name the price
 * row the canvas node's own request reserves. The payload builder is run for
 * the two ffmpeg nodes, and the two UGC Cards REST bodies are replayed into the
 * real routes behind a credit-guard recorder; the id each reserves must be the
 * id the quote reads. A node or route that changes its reservation id, or a
 * quote line that stops following it, fails here.
 */
const guard = vi.hoisted(() => ({ id: undefined as string | undefined }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard:
    (resolve: (req: unknown) => string) =>
    async (req: unknown, reply: { status(code: number): { send(body: unknown): unknown } }) => {
      guard.id = resolve(req)
      return reply.status(299).send({ recorded: true })
    },
  reserveCreditsForJob: vi.fn(),
}))
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn() },
  redis: { incr: vi.fn().mockResolvedValue(1), expire: vi.fn(), ttl: vi.fn().mockResolvedValue(60) },
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: "none" } }) }) }) }) },
}))

// What the quote reads for each fixed line (recorded through the real function).
const rows = vi.hoisted(() => ({ read: [] as string[] }))
vi.mock("../../billing/credits.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../billing/credits.js")>()),
  getModelCreditCostFromDB: vi.fn(async (id: string) => {
    rows.read.push(id)
    return { creditCost: 1, isEnabled: true, tierRestriction: null }
  }),
}))
vi.mock("../ugc-quote.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ugc-quote.js")>()),
  priceUgcCalls: vi.fn(async (_c: unknown, calls: unknown[]) => calls.map(() => 1)),
}))
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: vi.fn(async () => ({})) }))
vi.mock("../../billing/service-margin.js", () => ({ applyServiceMarkup: (base: number) => base }))

const { buildPayload } = await import("@/services/workflow-engine/payload-builder.js")
const { quoteUgcTickets, UGC_JOIN_NODE } = await import("../ugc-estimate.js")
const { videoUtilityBaseCredits } = await import("@/lib/video-utility-credits.js")
const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "lib", "tutorial-seed", "templates", "ugc-website-video.json")
const { forcedAlignmentRoutes } = await import("@/routes/forced-alignment.js")
const { transcribeRoutes } = await import("@/routes/transcribe.js")

const VIDEO = "https://cdn.example/clip.mp4"
const ticket = (index: number) => ({
  v: 1, index, clipCount: 1, durationSec: 8,
  video: { tool: "generate_video", args: { duration: 8 } }, speech: null,
})

/** The ids the quote reads for its flat-priced fixed lines, with cards. */
async function quotedRowIds(): Promise<string[]> {
  rows.read = []
  await quoteUgcTickets({ userId: "u1" }, [ticket(0)], true)
  return [...rows.read]
}

let routes: FastifyInstance
beforeAll(async () => {
  routes = Fastify({ logger: false })
  await routes.register(forcedAlignmentRoutes)
  await routes.register(transcribeRoutes)
  await routes.ready()
})
beforeEach(() => {
  guard.id = undefined
})

const captionsData = getFactoryPresets("add-captions").find((p) => p.id === BODY_CAPTIONS_PRESET_ID)!.data as Record<string, unknown>

describe("the canvas quote's fixed lines reserve what the canvas nodes reserve", () => {
  it("Video Overlay with a plan layer reserves the id the cards line reads", async () => {
    const plan = JSON.stringify([{ imageUrl: "https://cdn.example/s.png", start: 1, end: 2, preset: "card" }])
    const r = buildPayload({ id: "vo", type: "video-overlay", data: { label: "Overlay", layers: [] } } as never, "job-1", { videoUrl: VIDEO, layerPlan: plan } as never, "u-1")
    expect(r.modelIdentifier).toBe("video-overlay")
    expect(await quotedRowIds()).toContain(r.modelIdentifier)
  })
  it("Add Captions with a wired plan reserves the id the captions line reads", async () => {
    const plan = JSON.stringify({ v: 1, hookText: "Sample hook", hookEndMs: 1400, bodyEndMs: 2400, captions: [{ text: "one", startMs: 1500, endMs: 1800 }] })
    const r = buildPayload({ id: "cap", type: "add-captions", data: { label: "Captions", ...captionsData } } as never, "job-1", { videoUrl: VIDEO, captionPlan: plan } as never, "u-1")
    expect(r.modelIdentifier).toBe("add-captions:kinetic")
    expect(await quotedRowIds()).toContain(r.modelIdentifier)
  })
  it("the join line is what the template's join node commits: its payload, as a run builds it, through the run's own reservation", async () => {
    // The template's join node, read from the template itself; the clips arrive as UGC Finish's list over one Bundle edge,
    // which carries no per-clip length (a run measured none for it: two 7 s clips' join committed 44, its fallback price).
    const template = JSON.parse(readFileSync(TEMPLATE, "utf8")) as { nodes: Array<{ id: string; type: string; data: Record<string, unknown> }> }
    const join = template.nodes.find((n) => n.id === "join")!
    expect({ type: join.type, data: { ...join.data, label: undefined, fieldMappings: undefined } }).toEqual({ type: UGC_JOIN_NODE.type, data: { ...UGC_JOIN_NODE.data, label: undefined, fieldMappings: undefined } })
    for (const n of [2, 3, 6]) {
      const urls = Array.from({ length: n }, (_, i) => `https://cdn.example/f${i + 1}.mp4`)
      const r = buildPayload(join as never, "job-1", { videoUrls: urls, videoUrlsWithSourceIds: urls.map((url) => ({ nodeId: "finish", url })) } as never, "u-1")
      expect(r.jobName).toBe("combine-videos")
      // node-executor's computeVideoUtilityCreditOverride: the base over the payload, marked up under the node's id (identity here).
      const committed = videoUtilityBaseCredits(r.jobName, r.payload as Record<string, unknown>)
      const q = await quoteUgcTickets({ userId: "u1" }, Array.from({ length: n }, (_, i) => ({ ...ticket(i), durationSec: 7 })), true)
      expect(q.lines.find((l) => l.key === "join")!.credits, `${n} clips`).toBe(committed)
    }
  })
  it("UGC Cards' alignment body reserves the id the word-timings line reads", async () => {
    const res = await routes.inject({ method: "POST", url: "/v1/forced-alignment", payload: { audioUrl: VIDEO, transcript: "hello there" } })
    expect(res.statusCode, res.body).toBe(299)
    expect(await quotedRowIds()).toContain(guard.id)
  })
  it("UGC Cards' transcription body reserves the id the speech-check line reads", async () => {
    const res = await routes.inject({ method: "POST", url: "/v1/transcribe", payload: { audioUrl: VIDEO, provider: DEFAULT_TRANSCRIBE_NODE_PROVIDER, wordTimestamps: true } })
    expect(res.statusCode, res.body).toBe(299)
    expect(guard.id).toBe(DEFAULT_TRANSCRIBE_NODE_PROVIDER)
    expect(await quotedRowIds()).toContain(guard.id)
  })
})
