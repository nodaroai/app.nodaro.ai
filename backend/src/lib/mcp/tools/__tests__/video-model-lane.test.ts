import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import {
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  VIDEO_GEN_PROVIDERS,
  VIDEO_MODE_ALIASES,
} from "@nodaro/shared/models"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession } from "./_helpers.js"

/**
 * `generate_video` and `animate_image` send a named model as the id of the
 * lane they take. A model with one id per mode (`VIDEO_MODE_ALIASES`) can be
 * named by either: `grok-i2v` on a prompt-only `generate_video` used to reach
 * /v1/text-to-video as it was, which does not list it (a 400), and `grok` on
 * `animate_image` reached /v1/generate-video, whose schema lists it, but no
 * image-to-video provider runs it, so the queued job failed. Each is now sent
 * as its sibling for the lane, its ratio, size and length fitted to that id.
 * A model no video lane runs (an image or a lip-sync model) is refused with an
 * error naming the models that work. Every body is checked against the
 * route's own schema.
 */

let savedVideo: Record<string, string | number | undefined> = {}

vi.mock("../../user-preferences.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../user-preferences.js")>()),
  getUserMcpPreferences: vi.fn(async () => ({ video: savedVideo })),
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
const { textToVideoBody } = await import("../../../../routes/text-to-video.js")
const { generateVideoBody } = await import("../../../../routes/generate-video.js")

const START = "https://cdn.nodaro.ai/uploads/start.png"
const REF = "https://cdn.nodaro.ai/uploads/ref-1.png"

beforeEach(() => {
  _resetRegistry()
  savedVideo = {}
})

type Tool = "generate_video" | "animate_image"

/** Both lanes stubbed; answers what the verb sent, where, and the tool's own result. */
async function run(tool: Tool, args: Record<string, unknown>) {
  const fastify = Fastify()
  const hits: Array<{ url: string; body: Record<string, unknown> }> = []
  for (const url of ["/v1/text-to-video", "/v1/generate-video"]) {
    fastify.post(url, async (req) => {
      hits.push({ url, body: req.body as Record<string, unknown> })
      return { jobId: "j-video" }
    })
  }
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  const base = tool === "generate_video" ? { prompt: "a lighthouse at dusk" } : { image_url: START, prompt: "the waves roll in" }
  const result = await callTool(server, tool, { ...base, ...args })
  return { result, hits, hit: hits[0] }
}

/** The body passes the route's own schema, and the id is one that lane runs. */
function routeRuns(url: string, body: Record<string, unknown>): boolean {
  const { userId: _userId, mcp_client: _client, ...sent } = body
  const provider = body.provider as string
  return url === "/v1/text-to-video"
    ? textToVideoBody.safeParse(sent).success && (TEXT_TO_VIDEO_PROVIDERS as readonly string[]).includes(provider)
    : generateVideoBody.safeParse(sent).success && (IMAGE_TO_VIDEO_PROVIDERS as readonly string[]).includes(provider)
}

const errorText = (result: Awaited<ReturnType<typeof run>>["result"]) =>
  (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n")

describe("a named model is sent as its sibling for the lane taken", () => {
  it("covers the mode twins", () => {
    expect(VIDEO_MODE_ALIASES.map((g) => g.i2v)).toEqual(expect.arrayContaining(["grok-i2v", "wan-i2v", "wan-2.7-i2v", "happyhorse-i2v"]))
  })

  it.each(VIDEO_MODE_ALIASES.map((g) => [g.i2v, g.t2v] as const))(
    "generate_video: %s with no reference runs as %s on /v1/text-to-video",
    async (i2v, t2v) => {
      const { result, hits, hit } = await run("generate_video", { model: i2v })
      expect(result.isError).toBeUndefined()
      expect(hits).toHaveLength(1)
      expect(hit!.url).toBe("/v1/text-to-video")
      expect(hit!.body.provider).toBe(t2v)
      expect(routeRuns(hit!.url, hit!.body)).toBe(true)
    },
  )

  it.each(VIDEO_MODE_ALIASES.map((g) => [g.t2v, g.i2v] as const))(
    "animate_image: %s with a frame runs as %s on /v1/generate-video",
    async (t2v, i2v) => {
      const { result, hits, hit } = await run("animate_image", { model: t2v })
      expect(result.isError).toBeUndefined()
      expect(hits).toHaveLength(1)
      expect(hit!.url).toBe("/v1/generate-video")
      expect(hit!.body.provider).toBe(i2v)
      expect(hit!.body.imageUrl).toBe(START)
      expect(routeRuns(hit!.url, hit!.body)).toBe(true)
    },
  )

  it("the ratio, size and length are fitted to the id that is sent", async () => {
    // grok-i2v lists no ratio; grok does, and takes 9:16 (and has no size setting).
    const t2v = (await run("generate_video", { model: "grok-i2v", aspect_ratio: "9:16" })).hit!.body
    expect(t2v.provider).toBe("grok")
    expect(t2v.aspectRatio).toBe("9:16")
    expect(t2v.resolution).toBeUndefined()
    // wan-i2v runs 5, 10 or 15 seconds; its text-to-video sibling 5 only.
    expect((await run("generate_video", { model: "wan-i2v", duration: 10 })).hit!.body.duration).toBe(5)
    // grok lists no length; grok-i2v runs 6 or 10 seconds.
    const i2v = (await run("animate_image", { model: "grok", duration: 10 })).hit!.body
    expect(i2v.provider).toBe("grok-i2v")
    expect(i2v.duration).toBe(10)
  })

  it("a named twin still wins over a saved model", async () => {
    savedVideo = { model: "veo3.1" }
    expect((await run("generate_video", { model: "happyhorse-i2v" })).hit!.body.provider).toBe("happyhorse")
    expect((await run("animate_image", { model: "happyhorse" })).hit!.body.provider).toBe("happyhorse-i2v")
  })

  it("a saved text-to-video twin runs on animate_image as its image-to-video sibling", async () => {
    savedVideo = { model: "grok" }
    const { hit } = await run("animate_image", {})
    expect(hit!.body.provider).toBe("grok-i2v")
    expect(routeRuns(hit!.url, hit!.body)).toBe(true)
  })
})

describe("a model no video lane runs is refused, naming the ones that work", () => {
  it.each(["gpt-image-2", "kling-avatar", "veo-extend", "topaz-video"])("generate_video refuses %s and sends nothing", async (model) => {
    const { result, hits } = await run("generate_video", { model })
    expect(result.isError).toBe(true)
    expect(hits).toHaveLength(0)
    const text = errorText(result)
    expect(text).toContain(`"${model}"`)
    expect(text).toContain("seedance-2-fast")
    expect(text).toContain('list_models { kind: "video", mode: "t2v" }')
    // Only models that run from a prompt alone are named.
    expect(text).not.toContain("vidu-q4")
  })

  it.each(["gpt-image-2", "kling-avatar", "veo-extend"])("animate_image refuses %s and sends nothing", async (model) => {
    const { result, hits } = await run("animate_image", { model })
    expect(result.isError).toBe(true)
    expect(hits).toHaveLength(0)
    const text = errorText(result)
    expect(text).toContain(`"${model}"`)
    expect(text).toContain("grok-i2v")
    expect(text).toContain('list_models { kind: "video", mode: "i2v" }')
  })

  it("an id the catalog does not know still falls back to the default, as the tools say", async () => {
    expect((await run("generate_video", { model: "not-a-model" })).hit!.body.provider).toBe("seedance-2-fast")
    expect((await run("animate_image", { model: "not-a-model" })).hit!.body.provider).toBe("seedance-2-fast")
  })
})

describe("every video generation model still reaches a lane that runs it", () => {
  it.each([...VIDEO_GEN_PROVIDERS])("%s", async (model) => {
    // A prompt-only generate_video: an image-required model still reaches
    // /v1/text-to-video, whose own refusal says it needs an image.
    const t2v = await run("generate_video", { model })
    expect(t2v.result.isError, model).toBeUndefined()
    expect(t2v.hit!.url).toBe("/v1/text-to-video")
    expect(routeRuns(t2v.hit!.url, t2v.hit!.body), model).toBe(true)

    const i2v = await run("animate_image", { model })
    expect(i2v.result.isError, model).toBeUndefined()
    expect(routeRuns(i2v.hit!.url, i2v.hit!.body), model).toBe(true)
  })
})

describe("what worked before is unchanged", () => {
  it("a single-id model is sent as named on both verbs", async () => {
    for (const model of ["seedance-2", "veo3.1", "kling-4", "wan-3"]) {
      const t2v = (await run("generate_video", { model })).hit!
      expect(t2v.url).toBe("/v1/text-to-video")
      expect(t2v.body.provider).toBe(model)
      const i2v = (await run("animate_image", { model })).hit!
      expect(i2v.url).toBe("/v1/generate-video")
      expect(i2v.body.provider).toBe(model)
    }
  })

  it("grok-i2v with a reference image keeps the image-to-video lane, as grok-i2v", async () => {
    const { hit } = await run("generate_video", { model: "grok-i2v", reference_image_urls: [REF] })
    expect(hit!.url).toBe("/v1/generate-video")
    expect(hit!.body.provider).toBe("grok-i2v")
    expect(hit!.body.referenceImageUrls).toEqual([REF])
  })

  it("a prompt-only image-required model keeps the route's own refusal", async () => {
    const { hit } = await run("generate_video", { model: "vidu-q4" })
    expect(hit!.url).toBe("/v1/text-to-video")
    expect(hit!.body.provider).toBe("vidu-q4")
  })
})
