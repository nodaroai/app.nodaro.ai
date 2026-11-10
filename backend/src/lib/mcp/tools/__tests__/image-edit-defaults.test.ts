import { describe, it, expect, vi, beforeEach } from "vitest"
import { defaultImageModel } from "@nodaro/shared/model-catalog"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, stubRoute } from "./_helpers.js"

/**
 * What the two image-to-image verbs send and answer when the caller leaves
 * the model or the ratio out:
 *  - `image_to_image` names, in its answer, the model the job really runs
 *    (the platform's edit default), never a fixed label;
 *  - `modify_image` asks for "auto" when no ratio is named on a GPT Image
 *    2.5 / 2.6 edit model, as /v1/image-to-image itself does.
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

const SOURCE = "https://cdn.nodaro.ai/uploads/source.png"

async function call(tool: string, args: Record<string, unknown>) {
  const { fastify, received } = stubRoute("POST", "/v1/image-to-image", { jobId: "j-edit" })
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  const result = await callTool(server, tool, { image_url: SOURCE, prompt: "restyle", ...args })
  expect(result.isError).toBeUndefined()
  return { body: received.body ?? {}, answer: (result.structuredContent ?? {}) as Record<string, unknown> }
}

beforeEach(() => {
  _resetRegistry()
})

describe("image_to_image — the answer names the model that runs", () => {
  it("with no model named, names the edit default the job is sent to", async () => {
    const { body, answer } = await call("image_to_image", {})
    expect(body.provider).toBe(defaultImageModel("edit"))
    expect(answer.model).toBe(body.provider)
    expect(answer.model).not.toBe("nano-banana")
  })

  it("follows the default to the model that draws the ratio asked for", async () => {
    // 27:16 is a GPT Image 2.5 ratio the 2.6 edit default does not draw.
    const { body, answer } = await call("image_to_image", { aspect_ratio: "27:16" })
    expect(body.provider).toBe(defaultImageModel("edit", "27:16"))
    expect(body.provider).not.toBe(defaultImageModel("edit"))
    expect(answer.model).toBe(body.provider)
  })

  it("names the model the caller chose", async () => {
    const { body, answer } = await call("image_to_image", { model: "flux-kontext" })
    expect(body.provider).toBe("flux-kontext")
    expect(answer.model).toBe("flux-kontext")
  })
})

describe("modify_image — no ratio named on a GPT Image 2.5 / 2.6 edit is 'auto'", () => {
  it("on the default edit model", async () => {
    const { body } = await call("modify_image", {})
    expect(body.provider).toBe(defaultImageModel("edit"))
    expect(body.aspectRatio).toBe("auto")
  })

  it.each(["gpt-image-2-5-flare-i2i", "gpt-image-2-5-sunburst-i2i", "gpt-image-2-6-sunburst-i2i"])("on %s", async (model) => {
    const { body } = await call("modify_image", { model })
    expect(body.provider).toBe(model)
    expect(body.aspectRatio).toBe("auto")
  })

  it("keeps a named ratio", async () => {
    const { body } = await call("modify_image", { aspect_ratio: "16:9" })
    expect(body.aspectRatio).toBe("16:9")
  })

  it("leaves another model's unset ratio as it was (GPT Image 2's edit)", async () => {
    const { body } = await call("modify_image", { model: "gpt-image-2-i2i" })
    expect(body.provider).toBe("gpt-image-2-i2i")
    expect(body.aspectRatio).toBe("16:9")
  })
})
