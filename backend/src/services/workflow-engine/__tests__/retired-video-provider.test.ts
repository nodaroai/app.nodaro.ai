// @test-units-by-name names only the video node types it builds (generate-video, image-to-video, text-to-video, extend-video)
/**
 * Seedance 1.5 (`seedance`) was retired upstream on 2026-10-25 (KIE answers
 * 410). A node saved with it, a FieldMapping or app input that writes it, and
 * an API call that names it all run, and are priced, as `seedance-2-mini`
 * (RETIRED_VIDEO_PROVIDERS, owner's decision 2026-10-25): the payload, its
 * credit id and the run estimate name one model, so the quote is the charge.
 * The one Seedance Extend Video provider (`seedance-2-extend`) was split into
 * one provider per model and runs as `seedance-2-5-extend` the same way.
 */
import { describe, it, expect, afterEach } from "vitest"
import Fastify from "fastify"
import { RETIRED_VIDEO_PROVIDERS } from "@nodaro/shared/models"
import { buildPayload } from "../payload-builder.js"
import { migrateLegacyNodeType, withRunningVideoProvider } from "../normalize-node-types.js"
import { getNodeModelIdentifier } from "../../../ee/billing/credits.js"
import { FREE_VIDEO_LIMITS_DEFAULTS, freeVideoRefusal, freeVideoRequestForJob } from "../../../ee/billing/free-video-limits.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import { registerRetiredVideoProviderHook } from "../../../middleware/retired-video-provider.js"
import type { SimpleNode, ResolvedInputs } from "../types.js"

const SAVED = { prompt: "a slow turn", duration: 12, resolution: "1080p", aspectRatio: "1:1", generateAudio: false }

function videoNode(type: string, provider: string): SimpleNode {
  return { id: "v-1", type, data: { ...SAVED, provider } }
}

function built(n: SimpleNode, inputs: ResolvedInputs = {}) {
  return buildPayload(n, "job-1", inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
}

describe("a retired video model runs as the model it became", () => {
  it("every retired id names a different, live model", () => {
    for (const [retired, runsAs] of Object.entries(RETIRED_VIDEO_PROVIDERS)) {
      expect(runsAs).not.toBe(retired)
      expect(RETIRED_VIDEO_PROVIDERS[runsAs]).toBeUndefined()
    }
  })

  it.each([
    ["generate-video", {}],
    ["generate-video", { startFrameUrl: "https://cdn.example/start.png" }],
    ["image-to-video", { imageUrl: "https://cdn.example/start.png" }],
    ["text-to-video", {}],
  ] as const)("%s %j: built, priced and dispatched as seedance-2-mini", (type, inputs) => {
    const asSaved = built(videoNode(type, "seedance"), inputs as ResolvedInputs)
    const asMini = built(videoNode(type, "seedance-2-mini"), inputs as ResolvedInputs)
    expect(asSaved).toEqual(asMini)
    expect(asSaved.modelIdentifier?.startsWith("seedance-2-mini")).toBe(true)
    expect(JSON.stringify(asSaved.payload)).not.toMatch(/"seedance"/)
  })

  it.each(["generate-video", "image-to-video", "text-to-video"])("%s: the estimate quotes what the run reserves", (type) => {
    expect(getNodeModelIdentifier(videoNode(type, "seedance"))).toBe(getNodeModelIdentifier(videoNode(type, "seedance-2-mini")))
  })

  it("rewrites at load, by copy, and leaves every other node by reference", () => {
    const saved = videoNode("generate-video", "seedance")
    const loaded = migrateLegacyNodeType(saved)
    expect((loaded.data as Record<string, unknown>).provider).toBe("seedance-2-mini")
    expect((saved.data as Record<string, unknown>).provider).toBe("seedance")
    const live = videoNode("generate-video", "kling")
    expect(withRunningVideoProvider(live)).toBe(live)
  })
})

describe("a stored node on the retired Seedance Extend Video provider", () => {
  // The free-credit rule (render-rules free-video-limits) and the model
  // availability checks read the provider as given — they know no retired
  // ids — so the node must carry the provider it runs as before they read it.
  afterEach(() => {
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
  })

  const STORED = { prompt: "she keeps walking", duration: 12, resolution: "1080p" }
  const extendNode = (provider: string): SimpleNode => ({ id: "x-1", type: "extend-video", data: { ...STORED, provider } })
  const SOURCE: ResolvedInputs = { videoUrl: "https://cdn.example/source.mp4" }

  it("a stored node on seedance-2-extend runs, is priced and is free-judged as seedance-2-5-extend", () => {
    const stored = extendNode("seedance-2-extend")
    // Loaded: the node carries the provider it runs as.
    expect((migrateLegacyNodeType(stored).data as Record<string, unknown>).provider).toBe("seedance-2-5-extend")

    // Run: the same job as a node saved on seedance-2-5-extend, on its own row.
    const run = built(stored, SOURCE)
    expect(run).toEqual(built(extendNode("seedance-2-5-extend"), SOURCE))
    expect(run.payload.provider).toBe("seedance-2-5-extend")
    // Seedance 2.5 is charged per second sent and added: its resolution's two-second row.
    expect(run.modelIdentifier).toBe("seedance-2-5-extend:1080p:per-2s")

    // Estimate: the quote is the reservation.
    expect(getNodeModelIdentifier(stored)).toBe(run.modelIdentifier)

    // Free credits: judged as Seedance 2.5 Extend (node-executor's preflight reads the job this way).
    const video = freeVideoRequestForJob(run.jobName, run.modelIdentifier!, run.payload)
    expect(video).toMatchObject({ provider: "seedance-2-5-extend", extend: true })
    expect(freeVideoRefusal(video!, FREE_VIDEO_LIMITS_DEFAULTS)?.error).toMatch(/^Extending video is not available on free credits/)
  })

  it("a deployment that withholds seedance-2-5-extend refuses the stored node", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["seedance-2-5-extend"] } })
    __resetSurfaceProfileCacheForTests()
    let thrown: unknown
    try {
      built(extendNode("seedance-2-extend"), SOURCE)
    } catch (e) {
      thrown = e
    }
    expect((thrown as { code?: string } | undefined)?.code).toBe("model_not_available")
    expect((thrown as Error).message).toMatch(/seedance-2-5-extend/)
  })
})

describe("a request naming a retired video model", () => {
  async function seen(body: unknown, path = "/v1/generate-video") {
    const app = Fastify()
    registerRetiredVideoProviderHook(app)
    let atPreHandler: unknown
    let named: unknown
    const opts = {
      preHandler: async (req: { body: unknown; retiredVideoProvider?: string }) => {
        atPreHandler = (req.body as { provider?: unknown }).provider
        named = req.retiredVideoProvider
      },
    }
    app.post("/v1/generate-video", opts, async (req) => req.body)
    app.post("/v1/webhooks/:token", opts, async (req) => req.body)
    const res = await app.inject({ method: "POST", url: path, payload: body as Record<string, unknown> })
    await app.close()
    return { atPreHandler, named, body: res.json() as Record<string, unknown> }
  }

  it("reaches the credit guard and the handler as the model it runs as", async () => {
    const { atPreHandler, body } = await seen({ provider: "seedance", prompt: "x", duration: 8 })
    expect(atPreHandler).toBe("seedance-2-mini")
    expect(body).toEqual({ provider: "seedance-2-mini", prompt: "x", duration: 8 })
  })

  // A route that must still honour what the old id accepted (Extend Video's
  // retired Seedance id took lengths its successor's window does not) can tell.
  it("tells the route which retired id the request named; a live model leaves it unset", async () => {
    expect((await seen({ provider: "seedance-2-extend", prompt: "x" })).named).toBe("seedance-2-extend")
    expect((await seen({ provider: "seedance-2-5-extend", prompt: "x" })).named).toBeUndefined()
    expect((await seen({ prompt: "x" })).named).toBeUndefined()
  })

  it("leaves a webhook trigger payload as sent: it is someone else's data", async () => {
    expect((await seen({ provider: "seedance" }, "/v1/webhooks/tok-1")).body).toEqual({ provider: "seedance" })
  })

  it("leaves a live model and a body without one as sent", async () => {
    expect((await seen({ provider: "kling", prompt: "x" })).body).toEqual({ provider: "kling", prompt: "x" })
    expect((await seen({ prompt: "x" })).body).toEqual({ prompt: "x" })
  })
})
