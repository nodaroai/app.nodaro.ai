import { describe, it, expect, vi, beforeEach } from "vitest"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, listTools, stubRoute } from "./_helpers.js"

/**
 * `image_to_image`, `lip_sync` and `modify_video` hand a model the call names
 * to their route as it is, and the route's provider list refuses one it does
 * not know (a 400). Their descriptions used to say an unknown value "falls
 * back" to a default; they now say it is refused. Both halves are pinned here:
 * what the tool sends, the route schema's verdict on it, and the sentence.
 */

vi.mock("../../user-preferences.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../user-preferences.js")>()),
  getUserMcpPreferences: vi.fn(async () => ({})),
}))
vi.mock("../../asset-resolver.js", () => ({ resolveAssetId: vi.fn(async () => null) }))
vi.mock("../../../supabase.js", () => ({
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
const { imageToImageBody } = await import("../../../../routes/image-to-image.js")

const UNKNOWN = "not-a-model"

beforeEach(() => _resetRegistry())

async function sent(tool: string, url: string, args: Record<string, unknown>) {
  const { fastify, received } = stubRoute("POST", url, { jobId: "j-1" })
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  await callTool(server, tool, args)
  return received.body ?? {}
}

describe("a named unknown model is sent as it is, and refused", () => {
  it("image_to_image: the route's schema refuses it", async () => {
    const body = await sent("image_to_image", "/v1/image-to-image", { image_url: "https://cdn.nodaro.ai/uploads/a.png", prompt: "restyle", model: UNKNOWN })
    expect(body.provider).toBe(UNKNOWN)
    const { userId: _userId, ...wire } = body
    expect(imageToImageBody.safeParse(wire).success).toBe(false)
    expect(imageToImageBody.safeParse({ ...wire, provider: "gpt-image-2-i2i" }).success).toBe(true)
  })

  it.each([
    ["lip_sync", "/v1/lip-sync", { image_url: "https://cdn.nodaro.ai/uploads/a.png", audio_url: "https://cdn.nodaro.ai/uploads/a.mp3", audio_duration_sec: 5 }],
    ["modify_video", "/v1/video-to-video", { video_url: "https://cdn.nodaro.ai/uploads/a.mp4", prompt: "restyle" }],
  ] as const)("%s sends it as it is", async (tool, url, args) => {
    expect((await sent(tool, url, { ...args, model: UNKNOWN })).provider).toBe(UNKNOWN)
  })

  it.each(["image_to_image", "lip_sync", "modify_video"])("%s's model description says so, and no longer that it falls back", async (tool) => {
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify: stubRoute("POST", "/x", {}).fastify })
    const def = (await listTools(server)).find((t) => t.name === tool)
    const model = (def?.inputSchema as { properties?: Record<string, { description?: string }> }).properties?.model?.description ?? ""
    expect(model).toContain("An unknown model is refused.")
    expect(model).not.toMatch(/unknown values? (silently )?falls? back/i)
  })
})
