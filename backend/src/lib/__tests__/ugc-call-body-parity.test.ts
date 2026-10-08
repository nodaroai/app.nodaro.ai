/**
 * `ugcCallToRouteBody` (the canvas/app) and the MCP verbs (`generate_image`,
 * `image_to_image`, `image_to_text`) are two doors onto the same public routes.
 * The UGC builder prices and describes a call once, in MCP argument names; this
 * pins that the app's mapping dispatches the same body the verb would, so a
 * price quoted from a call is the price the route charges.
 *
 * The verb adds only its two session stamps (`mcp_client`, `userId`).
 */
import { describe, expect, it, vi } from "vitest"
import { MODEL_CATALOG, ugcCallToRouteBody, type UgcToolCall } from "@nodaro/shared"
import { registerVerbs } from "../mcp/tools/verbs.js"
import { buildServer, callTool, executeSession, stubRoute } from "../mcp/tools/__tests__/_helpers.js"

vi.mock("../mcp/supabase.js", () => ({
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

const IMAGE = "https://cdn.example/previous-step.png"
const STAMPS = { mcp_client: "Claude", userId: "u1" }

const imageModels = Object.values(MODEL_CATALOG).filter((m) => m.kind === "image")
// Catalog-consistent lever sets: the verb snaps a value the model does not carry, the mapper never does.
const withResolutions = imageModels.find((m) => (m.modes as readonly string[]).includes("t2i") && m.resolutions?.includes("1K"))!
const withQualities = imageModels.find((m) => (m.modes as readonly string[]).includes("t2i") && m.qualities?.length)!
const leverless = MODEL_CATALOG["qwen"]!
const i2iWithResolutions = imageModels.find((m) => (m.modes as readonly string[]).includes("i2i") && m.resolutions?.includes("2K"))!

const ratioFor = (m: { aspectRatios?: readonly string[] }): string =>
  m.aspectRatios?.includes("3:4") ? "3:4" : m.aspectRatios![0]!

async function viaVerb(url: string, call: UgcToolCall, image?: string): Promise<Record<string, unknown>> {
  const { fastify, received } = stubRoute("POST", url, { jobId: "j-parity" })
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  const args = { ...call.args, ...(call.imageArg && image ? { [call.imageArg]: image } : {}) }
  const result = await callTool(server, call.tool, args)
  expect(result.isError).toBeUndefined()
  return received.body ?? {}
}

async function expectParity(call: UgcToolCall, image?: string): Promise<void> {
  const mapped = ugcCallToRouteBody(call, image ? { image } : {})
  expect(mapped && "path" in mapped).toBe(true)
  const { path, body } = mapped as { path: string; body: Record<string, unknown> }
  expect(await viaVerb(path, call, image)).toEqual({ ...body, ...STAMPS })
}

describe("ugcCallToRouteBody equals the MCP verbs", () => {
  it("the models the cases use carry the levers the cases set", () => {
    expect(withResolutions.resolutions).toContain("1K")
    expect(withQualities.qualities?.length).toBeGreaterThan(0)
    expect(leverless.resolutions).toBeUndefined()
    expect(leverless.qualities).toBeUndefined()
    expect(i2iWithResolutions.resolutions).toContain("2K")
  })

  it("generate_image with a resolution lever", async () => {
    await expectParity({
      tool: "generate_image",
      args: { prompt: "a person", model: withResolutions.id, aspect_ratio: ratioFor(withResolutions), resolution: "1K", negative_prompt: "blur" },
    })
  })

  it("generate_image with a quality lever", async () => {
    await expectParity({
      tool: "generate_image",
      args: { prompt: "a person", model: withQualities.id, aspect_ratio: ratioFor(withQualities), quality: withQualities.qualities![0]! },
    })
  })

  // A sampled creator is drawn by more than one image model, and a round whose
  // every candidate is blocked by moderation falls back once to a third. Every
  // one of these calls sets its model's own 1K lever, a resolution on one model
  // and a quality on another; each must reach the route with that lever as
  // sent, through either door.
  it.each([
    ["gpt-image-2", { resolution: "1K" }],
    ["seedream-5-pro", { quality: "basic" }],
    ["nano-banana-pro", { resolution: "1K" }],
  ] as const)("generate_image on %s keeps its lever %j", async (model, levers) => {
    const call: UgcToolCall = { tool: "generate_image", args: { prompt: "a person", model, aspect_ratio: "3:4", ...levers } }
    const mapped = ugcCallToRouteBody(call) as { body: Record<string, unknown> }
    expect(mapped.body).toEqual({ prompt: "a person", provider: model, aspectRatio: "3:4", ...levers })
    await expectParity(call)
  })

  it("generate_image on a lever-less model sends neither resolution nor quality", async () => {
    const call: UgcToolCall = {
      tool: "generate_image",
      args: { prompt: "a person", model: leverless.id, aspect_ratio: ratioFor(leverless) },
    }
    const mapped = ugcCallToRouteBody(call) as { body: Record<string, unknown> }
    expect(mapped.body).not.toHaveProperty("resolution")
    expect(mapped.body).not.toHaveProperty("quality")
    await expectParity(call)
  })

  it("image_to_image of the previous step's image (the realism-pass shape)", async () => {
    await expectParity(
      { tool: "image_to_image", imageArg: "image_url", args: { prompt: "edit", model: i2iWithResolutions.id, resolution: "2K" } },
      IMAGE,
    )
  })

  it("image_to_image of the previous step's image on a lever-less model", async () => {
    await expectParity(
      { tool: "image_to_image", imageArg: "image_url", args: { prompt: "edit", model: "qwen-i2i" } },
      IMAGE,
    )
  })

  it("image_to_image with every lever the verb forwards", async () => {
    await expectParity(
      {
        tool: "image_to_image",
        imageArg: "image_url",
        args: { prompt: "edit", model: i2iWithResolutions.id, resolution: "2K", strength: 0.4, aspect_ratio: "3:4", negative_prompt: "blur", seed: 7 },
      },
      IMAGE,
    )
  })

  it("image_to_text with the photo as its image, every lever set", async () => {
    await expectParity(
      {
        tool: "image_to_text",
        imageArg: "image_url",
        args: {
          detail_level: "brief",
          custom_prompt: "q",
          llmModel: "gemini-3.1-pro",
          reasoning_effort: "high",
          advanced_mode: true,
          temperature: 1.2,
          max_tokens: 4096,
        },
      },
      IMAGE,
    )
  })

  it("image_to_text with only a question", async () => {
    await expectParity({ tool: "image_to_text", imageArg: "image_url", args: { custom_prompt: "q" } }, IMAGE)
  })
})
