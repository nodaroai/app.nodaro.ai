import { describe, it, expect, vi, beforeEach } from "vitest"
import { defaultImageModel } from "@nodaro/shared/model-catalog"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, stubRoute } from "./_helpers.js"

/**
 * The person's saved image defaults (`save_image_defaults`, stored on
 * `profiles.mcp_preferences.image`) as `generate_image` and `modify_image`
 * read them. Each lever: the value the call names, else the saved one, else —
 * for the ratio — the model's own rule for an unset ratio (a GPT Image 2.5 /
 * 2.6 edit runs at "auto"), else today's fallback.
 *
 * The saved ratio used to be dead: the ratio helper fills an unset value with
 * 16:9, so its `?? saved` alternative was never reached.
 */

let savedImage: Record<string, string | undefined> = {}

vi.mock("../../user-preferences.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../user-preferences.js")>()),
  getUserMcpPreferences: vi.fn(async () => ({ image: savedImage })),
}))

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

async function call(tool: string, url: string, args: Record<string, unknown>, response: object = { jobId: "j-1" }) {
  const { fastify, received } = stubRoute("POST", url, response)
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  const result = await callTool(server, tool, args)
  expect(result.isError).toBeUndefined()
  return received.body ?? {}
}

const modify = (args: Record<string, unknown>) =>
  call("modify_image", "/v1/image-to-image", { image_url: SOURCE, prompt: "restyle", ...args })
const generate = (args: Record<string, unknown>, response?: object) =>
  call("generate_image", "/v1/generate-image", { prompt: "a lighthouse", ...args }, response)

const UNSET_IS_AUTO = [
  "gpt-image-2-5-flare-i2i",
  "gpt-image-2-5-sunburst-i2i",
  "gpt-image-2-6-flare-i2i",
  "gpt-image-2-6-sunburst-i2i",
  "gpt-image-2-6-economy-i2i",
]

beforeEach(() => {
  _resetRegistry()
  savedImage = {}
})

describe("modify_image — the ratio: named, else saved, else the model's rule, else the fallback", () => {
  it("uses the saved ratio when the call names none", async () => {
    savedImage = { aspectRatio: "1:1" }
    const body = await modify({})
    expect(body.provider).toBe(defaultImageModel("edit", "1:1"))
    expect(body.aspectRatio).toBe("1:1")
  })

  it("a named ratio beats the saved one", async () => {
    savedImage = { aspectRatio: "1:1" }
    expect((await modify({ aspect_ratio: "16:9" })).aspectRatio).toBe("16:9")
  })

  it("a blank named ratio names nothing: the saved one applies", async () => {
    savedImage = { aspectRatio: "3:4" }
    expect((await modify({ aspect_ratio: "" })).aspectRatio).toBe("3:4")
  })

  it("a saved ratio the default model lacks picks the edit model that draws it", async () => {
    savedImage = { aspectRatio: "27:16" }
    const body = await modify({})
    expect(body.provider).toBe(defaultImageModel("edit", "27:16"))
    expect(body.aspectRatio).toBe("27:16")
  })

  it("a saved 'auto' is handed on as 'auto', as a named one is", async () => {
    savedImage = { aspectRatio: "auto" }
    expect((await modify({ model: "gpt-image-2-i2i" })).aspectRatio).toBe("auto")
    expect((await modify({ model: "flux-kontext" })).aspectRatio).toBe("auto")
  })

  it.each(UNSET_IS_AUTO)("with neither, %s runs at 'auto'", async (model) => {
    const body = await modify({ model })
    expect(body.provider).toBe(model)
    expect(body.aspectRatio).toBe("auto")
  })

  it("with neither, another model keeps today's fallback (GPT Image 2's edit: 16:9)", async () => {
    const body = await modify({ model: "gpt-image-2-i2i" })
    expect(body.aspectRatio).toBe("16:9")
  })

  it("a saved ratio beats the model's rule on the five edit ids", async () => {
    savedImage = { aspectRatio: "4:3" }
    for (const model of UNSET_IS_AUTO.slice(0, 2)) {
      expect((await modify({ model })).aspectRatio).toBe("4:3")
    }
  })
})

describe("modify_image — saved size and quality", () => {
  it("uses the saved size and quality when the call names none", async () => {
    savedImage = { resolution: "2K", quality: "high" }
    const body = await modify({ model: "gpt-image-2-6-flare-i2i" })
    expect(body.resolution).toBe("2K")
    expect(body.quality).toBe("high")
  })

  it("named values beat the saved ones", async () => {
    savedImage = { resolution: "2K", quality: "high" }
    const body = await modify({ model: "gpt-image-2-6-flare-i2i", resolution: "4K", quality: "low" })
    expect(body.resolution).toBe("4K")
    expect(body.quality).toBe("low")
  })
})

describe("generate_image — the ratio: named, else saved, else the fallback", () => {
  it("uses the saved ratio when the call names none", async () => {
    savedImage = { aspectRatio: "9:16" }
    expect((await generate({})).aspectRatio).toBe("9:16")
  })

  it("a named ratio beats the saved one", async () => {
    savedImage = { aspectRatio: "9:16" }
    expect((await generate({ aspect_ratio: "1:1" })).aspectRatio).toBe("1:1")
  })

  it("with neither, keeps today's fallback", async () => {
    const body = await generate({})
    expect(body.provider).toBe(defaultImageModel("general"))
    expect(body.aspectRatio).toBe("16:9")
  })

  it("a saved 'auto' with a reference photo is handed on as 'auto'", async () => {
    savedImage = { aspectRatio: "auto" }
    expect((await generate({ model: "flux-2-pro", reference_image_urls: [SOURCE] })).aspectRatio).toBe("auto")
  })

  it("uses the saved size when the call names none", async () => {
    savedImage = { resolution: "2K" }
    expect((await generate({ model: "gpt-image-2-5-flare" })).resolution).toBe("2K")
  })

  it("several models: the saved ratio is used, a named one beats it", async () => {
    const batch = { jobIds: ["a", "b"], batchId: "b1", groups: [{ model: "gpt-image-2", jobIds: ["a"] }, { model: "nano-banana-pro", jobIds: ["b"] }] }
    savedImage = { aspectRatio: "9:16" }
    expect((await generate({ models: ["gpt-image-2", "nano-banana-pro"] }, batch)).aspectRatio).toBe("9:16")
    expect((await generate({ models: ["gpt-image-2", "nano-banana-pro"], aspect_ratio: "1:1" }, batch)).aspectRatio).toBe("1:1")
  })
})
