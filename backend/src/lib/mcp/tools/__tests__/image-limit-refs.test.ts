import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, stubRoute } from "./_helpers.js"

/**
 * MCP and a model's image limit. `reference_image_urls` used to be cut to the
 * route's limit here, so 11 FLUX 3 Klein references ran as 10 with no word
 * said. A model that refuses images over its limit (`refusesImagesOverLimit`:
 * FLUX 3 Klein, decided 2026-11-12) gets every reference, and the route
 * refuses the call saying how many to remove. Every other model is still cut
 * to its limit, as before.
 */

vi.mock("../../asset-resolver.js", () => ({
  resolveAssetId: vi.fn(async () => null),
}))

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
const { generateImageRequest } = await import("../../../../routes/generate-image-body.js")

const refs = (n: number) => Array.from({ length: n }, (_, i) => `https://cdn.nodaro.ai/uploads/ref-${i}.png`)
const FLUX_REFUSAL = "FLUX 3 Klein takes at most 10 input images, the source or base image included, and this run would send 11: remove 1."

/**
 * /v1/generate-image as far as its body check: the route's own request schema,
 * whose per-model limit is the refusal a call over FLUX 3 Klein's 10 gets. The
 * test session's user id is not a UUID, so the body is checked as a real
 * session's (a UUID) would be.
 */
function generateImageBodyCheck() {
  const fastify = Fastify()
  const received: { body?: Record<string, unknown> } = {}
  fastify.post("/v1/generate-image", async (req, reply) => {
    received.body = req.body as Record<string, unknown>
    const parsed = generateImageRequest.safeParse({ ...received.body, userId: "00000000-0000-4000-8000-000000000001" })
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]!.message } })
    }
    return { jobId: "j-image" }
  })
  return { fastify, received }
}

beforeEach(() => {
  _resetRegistry()
})

describe("generate_image's references and a model's image limit", () => {
  it("passes all 11 FLUX 3 Klein references on, and the route's refusal says to remove 1", async () => {
    const { fastify, received } = generateImageBodyCheck()
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", { prompt: "a still life", model: "flux-3-klein", reference_image_urls: refs(11) })

    expect(received.body?.referenceImageUrls).toEqual(refs(11))
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(FLUX_REFUSAL)
  })

  it("runs 10 FLUX 3 Klein references with all 10 sent", async () => {
    const { fastify, received } = generateImageBodyCheck()
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", { prompt: "a still life", model: "flux-3-klein", reference_image_urls: refs(10) })

    expect(result.isError).toBeUndefined()
    expect(received.body?.referenceImageUrls).toEqual(refs(10))
  })

  it("still cuts every other model's references to its limit (Nano Banana Pro: 14)", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", { jobId: "j-nbp" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", { prompt: "a still life", model: "nano-banana-pro", reference_image_urls: refs(20) })

    expect(result.isError).toBeUndefined()
    expect(received.body?.referenceImageUrls).toEqual(refs(14))
  })
})

describe("image_to_image's references and a model's image limit", () => {
  it("passes every FLUX 3 Klein reference on beside the source, for the route to count", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/image-to-image", { jobId: "j-i2i" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "image_to_image", {
      image_url: "https://cdn.nodaro.ai/uploads/source.png",
      prompt: "make it winter",
      model: "flux-3-klein-i2i",
      reference_image_urls: refs(10),
    })

    // The source and 10 references: 11, which the route refuses.
    expect(received.body?.referenceImageUrls).toEqual(refs(10))
  })

  it("still cuts every other model's references beside the source (Seedream 5 Flash: 13)", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/image-to-image", { jobId: "j-i2i-nbp" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "image_to_image", {
      image_url: "https://cdn.nodaro.ai/uploads/source.png",
      prompt: "make it winter",
      model: "seedream-5-flash-i2i",
      reference_image_urls: refs(20),
    })

    expect(received.body?.referenceImageUrls).toEqual(refs(13))
  })
})
