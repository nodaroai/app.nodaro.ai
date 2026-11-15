import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, stubRoute } from "./_helpers.js"

/**
 * The MCP image tools' ceiling on one image list (`MCP_IMAGE_LIST_CEILING`,
 * decided 2026-11-15). A list passed on whole to a model with a request image
 * limit of its own is otherwise unbounded, and each entry costs an asset
 * lookup or a pass of prompt assembly before the route sees it. Past the
 * ceiling the call is refused before either; at it, and at a realistic
 * overshoot, it still reaches the route, which says how many to remove. A
 * list cut to a model's own limit before its lookups is cut as before.
 */

vi.mock("../../asset-resolver.js", () => ({
  resolveAssetId: vi.fn(async ({ assetId }: { assetId: string }) => `https://cdn.nodaro.ai/uploads/${assetId}.png`),
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

vi.mock("../../../presets/apply-image-preset.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../presets/apply-image-preset.js")>()
  return { ...actual, buildGenerateImagePresetBody: vi.fn(actual.buildGenerateImagePresetBody) }
})

const { registerVerbs } = await import("../verbs.js")
const { MCP_IMAGE_LIST_CEILING } = await import("../_verb-helpers.js")
const { resolveAssetId } = await import("../../asset-resolver.js")
const { buildGenerateImagePresetBody } = await import("../../../presets/apply-image-preset.js")
const { parseGenerateImageRequest } = await import("../../../../routes/generate-image-body.js")
const { oversizedImageArraysProblem } = await import("../../../../routes/generate-image-plan.js")

const PRESET = "generate-image/location-board"
const pills = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, defaultName: `ref${i}`, source: "manual", url: `https://cdn.nodaro.ai/uploads/cref-${i}.png` }))
const order = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`)
/** Asset ids, each of which would cost a lookup. */
const assetIds = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)

/** The input-validation error a bound of `max` on `field` gives. */
const PAST = (tool: string, field: string, max: number) =>
  `MCP error -32602: Input validation error: Invalid arguments for tool ${tool}: ` +
  JSON.stringify([{ origin: "array", code: "too_big", maximum: max, inclusive: true, path: [field], message: `Too big: expected array to have <=${max} items` }], null, 2)

const call = async (tool: string, args: Record<string, unknown>, route = "/v1/generate-image") => {
  const { fastify, received } = stubRoute("POST", route, { jobId: "j-ceiling" })
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  const result = await callTool(server, tool, args)
  return { result, body: received.body as Record<string, unknown> | undefined }
}
const text = (result: Awaited<ReturnType<typeof callTool>>) => (result.content[0] as { text: string }).text

beforeEach(() => {
  _resetRegistry()
  vi.clearAllMocks()
})

describe("MCP image lists past the ceiling", () => {
  it("the ceiling sits well above every model's limit", () => {
    expect(MCP_IMAGE_LIST_CEILING).toBe(64)
  })

  it.each([
    ["connected_references", { connected_references: pills(MCP_IMAGE_LIST_CEILING + 1) }],
    ["reference_order", { connected_references: pills(2), reference_order: order(MCP_IMAGE_LIST_CEILING + 1) }],
    ["reference_image_urls", { reference_image_urls: assetIds(MCP_IMAGE_LIST_CEILING + 1) }],
  ] as const)("generate_image on GPT Image 2.6 Flare refuses %s past it, before any lookup", async (field, lists) => {
    const { result, body } = await call("generate_image", { prompt: "a still life", model: "gpt-image-2-6-flare", ...lists })
    expect(result.isError).toBe(true)
    expect(text(result)).toBe(PAST("generate_image", field, MCP_IMAGE_LIST_CEILING))
    expect(resolveAssetId).not.toHaveBeenCalled()
    expect(body).toBeUndefined()
  })

  it("counts a reference list sent as a JSON string as its entries", async () => {
    const { result, body } = await call("generate_image", {
      prompt: "a still life",
      model: "seedream-5-5",
      reference_image_urls: JSON.stringify(assetIds(MCP_IMAGE_LIST_CEILING + 1)),
    })
    expect(text(result)).toBe(PAST("generate_image", "reference_image_urls", MCP_IMAGE_LIST_CEILING))
    expect(resolveAssetId).not.toHaveBeenCalled()
    expect(body).toBeUndefined()
  })

  it("a fan-out passing its references on whole for one of its models is held to it too", async () => {
    const { result, body } = await call("generate_image", {
      prompt: "a still life",
      models: ["nano-banana-pro", "gpt-image-2-6-flare"],
      reference_image_urls: assetIds(MCP_IMAGE_LIST_CEILING + 1),
    })
    expect(text(result)).toBe(PAST("generate_image", "reference_image_urls", MCP_IMAGE_LIST_CEILING))
    expect(resolveAssetId).not.toHaveBeenCalled()
    expect(body).toBeUndefined()
  })

  it.each([
    ["connected_references", { connected_references: pills(MCP_IMAGE_LIST_CEILING + 1) }],
    ["reference_image_urls", { reference_image_urls: assetIds(MCP_IMAGE_LIST_CEILING + 1) }],
  ] as const)("a preset call on GPT Image 2.6 Flare refuses %s past it, before any lookup or assembly", async (field, lists) => {
    const { result, body } = await call("generate_image", { presetId: PRESET, model: "gpt-image-2-6-flare", ...lists })
    expect(text(result)).toBe(PAST("generate_image", field, MCP_IMAGE_LIST_CEILING))
    expect(resolveAssetId).not.toHaveBeenCalled()
    expect(buildGenerateImagePresetBody).not.toHaveBeenCalled()
    expect(body).toBeUndefined()
  })

  it("a preset fan-out of models with limits of their own refuses past it, before any assembly", async () => {
    const { result, body } = await call("generate_image", {
      presetId: PRESET,
      models: ["gpt-image-2-6-flare", "seedream-5-5"],
      connected_references: pills(MCP_IMAGE_LIST_CEILING + 1),
    })
    expect(text(result)).toBe(PAST("generate_image", "connected_references", MCP_IMAGE_LIST_CEILING))
    expect(buildGenerateImagePresetBody).not.toHaveBeenCalled()
    expect(body).toBeUndefined()
  })

  it("image_to_image on a model with a limit of its own refuses past it, before any lookup", async () => {
    const { result, body } = await call(
      "image_to_image",
      {
        image_url: "https://cdn.nodaro.ai/uploads/source.png",
        prompt: "make it winter",
        model: "gpt-image-2-6-flare-i2i",
        reference_image_urls: assetIds(MCP_IMAGE_LIST_CEILING + 1),
      },
      "/v1/image-to-image",
    )
    expect(text(result)).toBe(PAST("image_to_image", "reference_image_urls", MCP_IMAGE_LIST_CEILING))
    expect(resolveAssetId).not.toHaveBeenCalled()
    expect(body).toBeUndefined()
  })
})

describe("MCP image lists at the ceiling, and lists cut before their lookups", () => {
  it("64 GPT Image 2.6 Flare pills reach the route, which says how many to remove", async () => {
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
      return { jobId: "j" }
    })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "generate_image", {
      prompt: "a still life",
      model: "gpt-image-2-6-flare",
      connected_references: pills(MCP_IMAGE_LIST_CEILING),
    })
    expect(received.body?.connectedReferences).toEqual(pills(MCP_IMAGE_LIST_CEILING))
    expect(text(result)).toContain("GPT Image 2.6 Flare takes at most 16 input images, the source or base image included, and this run would send 64: remove 48.")
  })

  it("64 GPT Image 2.6 Flare reference ids are all looked up and passed on", async () => {
    const { body } = await call("generate_image", { prompt: "a still life", model: "gpt-image-2-6-flare", reference_image_urls: assetIds(MCP_IMAGE_LIST_CEILING) })
    expect(resolveAssetId).toHaveBeenCalledTimes(MCP_IMAGE_LIST_CEILING)
    expect(body?.referenceImageUrls).toHaveLength(MCP_IMAGE_LIST_CEILING)
  })

  it("a model held to the default limit still has its references cut to 14 before their lookups, as before", async () => {
    const { result, body } = await call("generate_image", { prompt: "a still life", model: "nano-banana-pro", reference_image_urls: assetIds(MCP_IMAGE_LIST_CEILING + 6) })
    expect(result.isError).toBeUndefined()
    expect(resolveAssetId).toHaveBeenCalledTimes(14)
    expect(body?.referenceImageUrls).toHaveLength(14)
  })
})
