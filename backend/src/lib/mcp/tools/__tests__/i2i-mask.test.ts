import { describe, it, expect, vi, beforeEach } from "vitest"
import { I2I_MASK_SUPPORT } from "@nodaro/shared/models"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, listTools, stubRoute } from "./_helpers.js"

/**
 * image_to_image's `mask_url`: forwarded to /v1/image-to-image as `maskUrl` on
 * the models that take a mask of their own (GPT Image 2.6 Flare and Sunburst
 * among them), and the parameter names those models.
 */

vi.mock("../../asset-resolver.js", () => ({ resolveAssetId: vi.fn(async () => null) }))
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

describe("image_to_image mask_url", () => {
  for (const model of ["gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst-i2i"]) {
    it(`${model}: the mask reaches the route`, async () => {
      const { fastify, received } = stubRoute("POST", "/v1/image-to-image", { jobId: "j-mask" })
      const server = buildServer()
      registerVerbs({ server, session: executeSession(), fastify })

      const result = await callTool(server, "image_to_image", {
        image_url: "https://cdn.nodaro.ai/uploads/source.png",
        prompt: "paint the sky green",
        model,
        mask_url: "https://cdn.nodaro.ai/uploads/mask.png",
      })

      expect(result.isError).toBeUndefined()
      expect(received.body).toMatchObject({ provider: model, maskUrl: "https://cdn.nodaro.ai/uploads/mask.png" })
    })
  }

  for (const model of ["gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst-i2i", "ideogram-edit"]) {
    it(`modify_image on ${model}: the mask reaches the route`, async () => {
      const { fastify, received } = stubRoute("POST", "/v1/image-to-image", { jobId: "j-mod-mask" })
      const server = buildServer()
      registerVerbs({ server, session: executeSession(), fastify })

      const result = await callTool(server, "modify_image", {
        image_url: "https://cdn.nodaro.ai/uploads/source.png",
        prompt: "paint the sky green",
        model,
        mask_url: "https://cdn.nodaro.ai/uploads/mask.png",
      })

      expect(result.isError).toBeUndefined()
      expect(received.body).toMatchObject({ provider: model, maskUrl: "https://cdn.nodaro.ai/uploads/mask.png" })
    })
  }

  it("modify_image with no mask sends none", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/image-to-image", { jobId: "j-mod" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "modify_image", { image_url: "https://cdn.nodaro.ai/uploads/source.png", prompt: "x", model: "gpt-image-2-6-flare-i2i" })
    expect(received.body).not.toHaveProperty("maskUrl")
  })

  it("names every model that takes a mask", async () => {
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify: stubRoute("POST", "/v1/image-to-image", { jobId: "x" }).fastify })
    for (const name of ["image_to_image", "modify_image"]) {
      const tool = (await listTools(server)).find((t) => t.name === name)
      const props = (tool?.inputSchema as { properties?: Record<string, { description?: string }> } | undefined)?.properties
      const description = props?.mask_url?.description ?? ""
      for (const id of I2I_MASK_SUPPORT) expect(description, name).toContain(id)
      expect(description, name).toContain("white=edit")
    }
  })
})
