import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession } from "./_helpers.js"

/**
 * The person's saved video defaults (`profiles.mcp_preferences.video`, written
 * through PATCH /v1/user/settings `mcpPreferences.video`) as `generate_video`
 * and `animate_image` read them. Each lever: the value the call names, else
 * the saved one, else the catalog's (the ratio: 16:9, or the model's first).
 *
 * The saved ratio used to be dead: the ratio helper fills an unset value with
 * 16:9, so its `?? saved` alternative was never reached.
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

const START = "https://cdn.nodaro.ai/uploads/start.png"

/** Both video lanes stubbed; answers the body the verb sent. */
async function call(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const fastify = Fastify()
  let body: Record<string, unknown> | undefined
  for (const url of ["/v1/text-to-video", "/v1/generate-video"]) {
    fastify.post(url, async (req) => {
      body = req.body as Record<string, unknown>
      return { jobId: "j-video" }
    })
  }
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  const result = await callTool(server, tool, args)
  expect(result.isError).toBeUndefined()
  return body ?? {}
}

const VERBS = [
  ["generate_video", (args: Record<string, unknown>) => call("generate_video", { prompt: "a lighthouse at dusk", ...args })],
  ["animate_image", (args: Record<string, unknown>) => call("animate_image", { image_url: START, prompt: "the waves roll in", ...args })],
] as const

beforeEach(() => {
  _resetRegistry()
  savedVideo = {}
})

describe.each(VERBS)("%s — the ratio: named, else saved, else the fallback", (_verb, run) => {
  it("uses the saved ratio when the call names none", async () => {
    savedVideo = { aspectRatio: "9:16" }
    expect((await run({})).aspectRatio).toBe("9:16")
  })

  it("a named ratio beats the saved one", async () => {
    savedVideo = { aspectRatio: "9:16" }
    expect((await run({ aspect_ratio: "1:1" })).aspectRatio).toBe("1:1")
  })

  it("a blank named ratio names nothing: the saved one applies", async () => {
    savedVideo = { aspectRatio: "4:3" }
    expect((await run({ aspect_ratio: "" })).aspectRatio).toBe("4:3")
  })

  it("with neither, keeps the fallback (16:9)", async () => {
    expect((await run({})).aspectRatio).toBe("16:9")
  })

  it("a saved ratio the model lacks moves to its nearest listed one", async () => {
    // seedance-2-fast (the default) lists 3:4 and 9:16, not 2:3.
    savedVideo = { aspectRatio: "2:3" }
    expect((await run({})).aspectRatio).toBe("3:4")
    // VEO 3.1 lists only 16:9 and 9:16.
    expect((await run({ model: "veo3.1" })).aspectRatio).toBe("9:16")
  })

  it("the saved ratio is fitted to the saved model", async () => {
    savedVideo = { model: "veo3.1", aspectRatio: "1:1" }
    const body = await run({})
    expect(body.provider).toBe("veo3.1")
    expect(["16:9", "9:16"]).toContain(body.aspectRatio)
  })
})

describe.each(VERBS)("%s — the saved model, duration and size", (_verb, run) => {
  it("uses each saved value when the call names none", async () => {
    savedVideo = { model: "veo3.1", duration: 6, resolution: "1080p" }
    const body = await run({})
    expect(body.provider).toBe("veo3.1")
    expect(body.duration).toBe(6)
    expect(body.resolution).toBe("1080p")
  })

  it("named values beat the saved ones", async () => {
    savedVideo = { model: "veo3.1", duration: 6, resolution: "1080p" }
    const body = await run({ model: "seedance-2-fast", duration: 10, resolution: "720p" })
    expect(body.provider).toBe("seedance-2-fast")
    expect(body.duration).toBe(10)
    expect(body.resolution).toBe("720p")
  })

  it("a saved duration the model lacks snaps to its nearest", async () => {
    savedVideo = { model: "veo3.1", duration: 7 }
    expect([6, 8]).toContain((await run({})).duration)
  })

  it("with neither, the model's own defaults apply", async () => {
    const body = await run({})
    expect(body.provider).toBe("seedance-2-fast")
    expect(body.duration).toBeUndefined()
    // The cheapest listed size (catalog order is low to high).
    expect(body.resolution).toBe("480p")
  })
})
