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
const { resolveNodeInputs } = await import("@/services/workflow-engine/input-resolver.js")
const { quoteUgcTickets, UGC_JOIN_NODE } = await import("../ugc-estimate.js")
const { videoUtilityChargeBaseCredits } = await import("@/lib/video-utility-credits.js")
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
    // The template's join node and its Bundle edge from UGC Finish, read from the template itself. A run hands the
    // join each finished clip at its own real length (`listResultMeta`, through the real input resolver), and the
    // quote prices each clip at its ticket's length — what a finished clip is cut to at most.
    const template = JSON.parse(readFileSync(TEMPLATE, "utf8")) as {
      nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
      edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; data?: Record<string, unknown> }>
    }
    const join = template.nodes.find((n) => n.id === "join")!
    expect({ type: join.type, data: { ...join.data, label: undefined, fieldMappings: undefined } }).toEqual({ type: UGC_JOIN_NODE.type, data: { ...UGC_JOIN_NODE.data, label: undefined, fieldMappings: undefined } })
    const bundle = template.edges.filter((e) => e.target === "join")
    expect(bundle.map((e) => [e.source, e.data?.outputMode])).toEqual([["finish", "all"]])
    const finish = template.nodes.find((n) => n.id === "finish")!

    /** What the run commits for the join when UGC Finish handed it clips of `secs` seconds. */
    const committedFor = async (secs: readonly number[]) => {
      const urls = secs.map((_, i) => `https://cdn.example/f${i + 1}.mp4`)
      const states = { finish: { status: "completed", output: { videoUrl: urls[0], listResults: urls, listResultMeta: secs.map((durationSec) => ({ warnings: [], durationSec })) } } }
      const inputs = resolveNodeInputs(join as never, bundle as never, states as never, [finish, join] as never)
      const r = buildPayload(join as never, "job-1", inputs, "u-1")
      expect(r.jobName).toBe("combine-videos")
      expect((r.payload as { upstreamDurations?: unknown }).upstreamDurations).toEqual(secs)
      // node-executor's computeVideoUtilityCreditOverride: the base over the payload, marked up under the node's id (identity here).
      return videoUtilityChargeBaseCredits(r.jobName, r.payload as Record<string, unknown>)
    }
    const joinLine = async (tickets: readonly number[]) =>
      (await quoteUgcTickets({ userId: "u1" }, tickets.map((durationSec, i) => ({ ...ticket(i), durationSec })), true)).lines.find((l) => l.key === "join")!.credits

    for (const n of [2, 3, 6]) {
      const tickets = Array.from({ length: n }, () => 7)
      // A finished clip exactly as long as its ticket: the quote is the charge.
      expect(await joinLine(tickets), `${n} clips`).toBe(await committedFor(tickets))
      // Cut shorter (the finish lane cuts to the speech): charged less, never more.
      expect(await committedFor(tickets.map((t, i) => t - 0.3 - i * 0.1))).toBeLessThanOrEqual(await joinLine(tickets))
      // A raw roll a frame over its nominal length (the pass lane): still within the quote.
      expect(await committedFor(tickets.map((t) => t + 0.042))).toBeLessThanOrEqual(await joinLine(tickets))
    }
    // Two 7 s clips: 33 (13.75 s → 3 units), where pricing each clip at the 8 s fallback quoted and charged 44.
    expect(await joinLine([7, 7])).toBe(await committedFor([7, 7]))
    expect(await committedFor([7, 7])).toBeLessThan(await videoUtilityChargeBaseCredits("combine-videos", { transition: "cut", trimStartFrames: 1, trimEndFrames: 2, videoUrls: ["", ""] }) as number)
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
