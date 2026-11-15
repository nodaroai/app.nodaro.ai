import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, stubRoute } from "./_helpers.js"

/**
 * MCP and a model's image limit. `reference_image_urls` used to be cut to the
 * route's limit here, so 11 FLUX 3 Klein references ran as 10 with no word
 * said. A model that refuses a request over its limit
 * (`refusesImagesOverLimitOn`: FLUX 3 Klein, decided 2026-11-12, and every
 * other model with a request image limit of its own — Seedream 5.5, GPT Image
 * 2.6 Flare and Sunburst, MiniMax H3 Image, decided 2026-11-14) gets every
 * reference, and the route refuses the call saying how many to remove. Every
 * other model is still cut to its limit, as before.
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
const { parseGenerateImageRequest } = await import("../../../../routes/generate-image-body.js")
const { oversizedImageArraysProblem } = await import("../../../../routes/generate-image-plan.js")

const refs = (n: number) => Array.from({ length: n }, (_, i) => `https://cdn.nodaro.ai/uploads/ref-${i}.png`)
const FLUX_REFUSAL = "FLUX 3 Klein takes at most 10 input images, the source or base image included, and this run would send 11: remove 1."

/**
 * /v1/generate-image as far as its body check: the route's own request schema,
 * whose per-model limit is the refusal a call over FLUX 3 Klein's 10 gets, and,
 * past the body's array bounds, the route's own answer for a model that
 * refuses a request over its limit (`oversizedImageArraysProblem`). The test
 * session's user id is not a UUID, so the body is checked as a real session's
 * (a UUID) would be.
 */
function generateImageBodyCheck() {
  const fastify = Fastify()
  const received: { body?: Record<string, unknown> } = {}
  fastify.post("/v1/generate-image", async (req, reply) => {
    received.body = req.body as Record<string, unknown>
    const body = { ...received.body, userId: "00000000-0000-4000-8000-000000000001" }
    const parsed = parseGenerateImageRequest(body)
    if (!parsed.success) {
      const tooMany = oversizedImageArraysProblem(body, parsed.error, undefined)
      return reply.status(400).send({ error: tooMany ?? { code: "validation_error", message: parsed.error.issues[0]!.message } })
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

  it.each([
    ["seedream-5-5", "Seedream 5.5", 12, "would send 12: remove 2"],
    ["gpt-image-2-6-flare", "GPT Image 2.6 Flare", 18, "would send 18: remove 2"],
    ["minimax-h3-image", "MiniMax H3 Image", 18, "would send 18: remove 2"],
  ] as const)("passes every %s reference on, and the route's refusal says how many to remove", async (model, label, count, tail) => {
    const { fastify, received } = generateImageBodyCheck()
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", { prompt: "a still life", model, reference_image_urls: refs(count) })

    expect(received.body?.referenceImageUrls).toEqual(refs(count))
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(`${label} takes at most`)
    expect((result.content[0] as { text: string }).text).toContain(tail)
  })

  it("a fan-out with one request-limited model passes every reference on for the route to count", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", { batchId: "b", jobs: [] })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "generate_image", { prompt: "a still life", models: ["nano-banana-pro", "seedream-5-5"], reference_image_urls: refs(20) })

    expect(received.body?.referenceImageUrls).toEqual(refs(20))
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

describe("a preset call's references and a model's image limit", () => {
  const run = async (args: Record<string, unknown>) => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", { jobId: "j-preset" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "generate_image", { presetId: "generate-image/location-board", ...args })
    return { result, body: received.body }
  }

  it("passes every reference on when the model it runs has a request limit of its own (Seedream 5.5: 16, not 14)", async () => {
    const { body } = await run({ model: "seedream-5-5", reference_image_urls: refs(16) })
    expect(body?.provider).toBe("seedream-5-5")
    expect(body?.referenceImageUrls).toEqual(refs(16))
  })

  it("still cuts every other model's references at 14 (Nano Banana Pro)", async () => {
    const { body } = await run({ model: "nano-banana-pro", reference_image_urls: refs(20) })
    expect(body?.referenceImageUrls).toEqual(refs(14))
  })

  it("a preset fan-out with one request-limited model passes every reference on", async () => {
    const { body } = await run({ models: ["nano-banana-pro", "gpt-image-2-6-flare"], reference_image_urls: refs(20) })
    expect(body?.referenceImageUrls).toEqual(refs(20))
  })
})

/**
 * `connected_references` and `reference_order` (decided 2026-11-15). The tool
 * used to bound both at 14 for every model; it now leaves them to the route, as
 * it leaves `reference_image_urls`, when every model the call runs has a
 * request image limit of its own, so 15 or 16 mentioned images run on GPT
 * Image 2.6 Flare and 17 are told how many to remove. A call on any other model
 * is refused past 14 before anything is sent, with exactly the answer the
 * tool's schema gave — on a preset call too, where the preset would otherwise
 * fold the references in and the assembler leave the extra ones out.
 */
describe("generate_image's structured lists and the models it runs on", () => {
  const pills = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `m${i}`, defaultName: `ref${i}`, source: "manual", url: `https://cdn.nodaro.ai/uploads/cref-${i}.png` }))
  const order = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`)
  /** The input-validation error the tool's schema gave past 14 entries. */
  const PAST_14 = (field: string) =>
    "MCP error -32602: Input validation error: Invalid arguments for tool generate_image: " +
    JSON.stringify([{ origin: "array", code: "too_big", maximum: 14, inclusive: true, path: [field], message: "Too big: expected array to have <=14 items" }], null, 2)

  const call = async (args: Record<string, unknown>) => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", { jobId: "j-lists" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "generate_image", { prompt: "a still life", ...args })
    return { result, body: received.body as Record<string, unknown> | undefined }
  }
  const text = (result: Awaited<ReturnType<typeof callTool>>) => (result.content[0] as { text: string }).text

  it.each([
    ["Nano Banana Pro, 15 pills", { model: "nano-banana-pro", connected_references: pills(15) }, "connected_references"],
    ["Nano Banana Pro, 16 pills", { model: "nano-banana-pro", connected_references: pills(16) }, "connected_references"],
    ["the default model, 15 pills", { connected_references: pills(15) }, "connected_references"],
    ["Nano Banana Pro, 15 reference_order ids", { model: "nano-banana-pro", connected_references: pills(2), reference_order: order(15) }, "reference_order"],
    ["a fan-out with GPT Image 2.6 Flare, 15 pills", { models: ["nano-banana-pro", "gpt-image-2-6-flare"], connected_references: pills(15) }, "connected_references"],
    ["a preset on Nano Banana Pro, 15 pills", { presetId: "generate-image/location-board", model: "nano-banana-pro", connected_references: pills(15) }, "connected_references"],
    ["a preset on Nano Banana Pro, 15 reference_order ids", { presetId: "generate-image/location-board", model: "nano-banana-pro", connected_references: pills(2), reference_order: order(15) }, "reference_order"],
    ["a preset fan-out with GPT Image 2.6 Flare, 15 pills", { presetId: "generate-image/location-board", models: ["nano-banana-pro", "gpt-image-2-6-flare"], connected_references: pills(15) }, "connected_references"],
  ] as const)("a model held to the default limit is refused past 14, as before: %s", async (_label, args, field) => {
    const { result, body } = await call(args)
    expect(result.isError).toBe(true)
    expect(text(result)).toBe(PAST_14(field))
    expect(body).toBeUndefined()
  })

  it("passes 15 and 16 GPT Image 2.6 Flare pills on, and the route takes them", async () => {
    for (const n of [15, 16]) {
      _resetRegistry()
      const { fastify, received } = generateImageBodyCheck()
      const server = buildServer()
      registerVerbs({ server, session: executeSession(), fastify })
      const result = await callTool(server, "generate_image", { prompt: "a still life", model: "gpt-image-2-6-flare", connected_references: pills(n), reference_order: order(n) })
      expect(result.isError, `${n} pills`).toBeUndefined()
      expect(received.body?.connectedReferences).toEqual(pills(n))
      expect(received.body?.referenceOrder).toEqual(order(n))
    }
  })

  it("passes 17 GPT Image 2.6 Flare pills on, and the route's refusal says to remove 1", async () => {
    const { fastify, received } = generateImageBodyCheck()
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "generate_image", { prompt: "a still life", model: "gpt-image-2-6-flare", connected_references: pills(17) })
    expect(received.body?.connectedReferences).toEqual(pills(17))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain("GPT Image 2.6 Flare takes at most 16 input images, the source or base image included, and this run would send 17: remove 1.")
  })

  it("a preset on GPT Image 2.6 Flare folds all 15 pills into its references", async () => {
    const { result, body } = await call({ presetId: "generate-image/location-board", model: "gpt-image-2-6-flare", connected_references: pills(15) })
    expect(result.isError).toBeUndefined()
    expect(body?.provider).toBe("gpt-image-2-6-flare")
    expect(body?.referenceImageUrls).toEqual(pills(15).map((ref) => ref.url))
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

  it.each(["seedream-5-5-i2i", "gpt-image-2-6-flare-i2i", "minimax-h3-image-i2i"])(
    "passes every %s reference on beside the source, for the route to count",
    async (model) => {
      const { fastify, received } = stubRoute("POST", "/v1/image-to-image", { jobId: "j-i2i-limited" })
      const server = buildServer()
      registerVerbs({ server, session: executeSession(), fastify })

      await callTool(server, "image_to_image", {
        image_url: "https://cdn.nodaro.ai/uploads/source.png",
        prompt: "make it winter",
        model,
        reference_image_urls: refs(20),
      })

      expect(received.body?.referenceImageUrls).toEqual(refs(20))
    },
  )

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
