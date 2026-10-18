import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import {
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  VIDEO_GEN_PROVIDERS,
  videoProviderRequiresImage,
  videoProviderRunsFromReferences,
} from "@nodaro/shared/models"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession } from "./_helpers.js"

/**
 * MCP `generate_video` and references-only runs.
 *
 * A run with reference images and no start frame must reach a route that runs
 * it for EVERY model whose provider runs from references alone (the catalog's
 * `reference-to-video` capability) — the same rule the editor, the browser DAG
 * and the orchestrator follow. `/v1/text-to-video` refuses an image-required
 * model before it looks at references, so the verb picks its lane with the
 * shared `resolveVideoModeForInputs`, never with a provider list.
 */

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: { mcp_preferences: {} }, error: null }),
        }),
      }),
    }),
  },
}))

const { registerVerbs } = await import("../verbs.js")

beforeEach(() => {
  _resetRegistry()
})

const REF = "https://cdn.nodaro.ai/uploads/ref-1.png"

/** Both lanes stubbed; records which one the verb dispatched to. */
function stubBothLanes() {
  const fastify = Fastify()
  const hits: Array<{ url: string; body: Record<string, unknown> }> = []
  for (const url of ["/v1/text-to-video", "/v1/generate-video"]) {
    fastify.post(url, async (req) => {
      hits.push({ url, body: req.body as Record<string, unknown> })
      return { jobId: "j-1" }
    })
  }
  return { fastify, hits }
}

const referenceToVideoModels = (VIDEO_GEN_PROVIDERS as readonly string[]).filter((p) => videoProviderRunsFromReferences(p))

describe("MCP generate_video — references-only runs reach a dispatchable route", () => {
  it("covers the catalog's reference-to-video models", () => {
    expect(referenceToVideoModels).toEqual(expect.arrayContaining(["vidu-q4", "happyhorse-ref2v", "seedance-2"]))
  })

  for (const model of referenceToVideoModels) {
    it(`${model}: refs alone land on a lane that accepts the model and is not image-gated`, async () => {
      const { fastify, hits } = stubBothLanes()
      const server = buildServer()
      registerVerbs({ server, session: executeSession(), fastify })

      await callTool(server, "generate_video", { prompt: "the woman from @image_1 turns to camera", model, reference_image_urls: [REF] })

      expect(hits, `${model} dispatched nowhere`).toHaveLength(1)
      const { url, body } = hits[0]!
      const provider = body.provider as string
      if (url === "/v1/generate-video") {
        expect(IMAGE_TO_VIDEO_PROVIDERS as readonly string[]).toContain(provider)
      } else {
        expect(TEXT_TO_VIDEO_PROVIDERS as readonly string[]).toContain(provider)
        expect(videoProviderRequiresImage(provider), `${provider} would be refused as image-required`).toBe(false)
      }
      expect(body.referenceImageUrls).toEqual([REF])
    })
  }

  it("vidu-q4 and happyhorse-ref2v take /v1/generate-video; Seedance stays on /v1/text-to-video", async () => {
    for (const [model, want] of [["vidu-q4", "/v1/generate-video"], ["happyhorse-ref2v", "/v1/generate-video"], ["seedance-2", "/v1/text-to-video"]] as const) {
      const { fastify, hits } = stubBothLanes()
      const server = buildServer()
      registerVerbs({ server, session: executeSession(), fastify })
      await callTool(server, "generate_video", { prompt: "p", model, reference_image_urls: [REF] })
      expect(hits[0]?.url, model).toBe(want)
      expect(hits[0]?.body.provider, model).toBe(model)
    }
  })

  it("a prompt-only call stays on /v1/text-to-video, where an image-required model gets the friendly refusal", async () => {
    const { fastify, hits } = stubBothLanes()
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "generate_video", { prompt: "p", model: "vidu-q4" })
    expect(hits[0]?.url).toBe("/v1/text-to-video")
    expect(videoProviderRequiresImage(hits[0]?.body.provider as string)).toBe(true)
  })
})
