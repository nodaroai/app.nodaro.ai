import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { defaultImageModel } from "@nodaro/shared/model-catalog"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession } from "./_helpers.js"

/**
 * `save_image_defaults` with `null` clears that saved default, end to end: the
 * tool's PATCH /v1/user/settings (the real route, on a stand-in `profiles`
 * row) stores the defaults without the field, and the next `generate_image`
 * reads them afresh (the route drops the tool's cached copy) and falls back to
 * its own default for it. The route used to refuse the `null` with a 400.
 */

const USER = "u1"
let row: { mcp_preferences: Record<string, unknown> } = { mcp_preferences: {} }

vi.mock("../../../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: { tier: "pro", public_outputs: true, ...structuredClone(row) }, error: null }),
        }),
      }),
      update: (updates: Record<string, unknown>) => ({
        eq: async () => {
          if (updates.mcp_preferences) row = { mcp_preferences: structuredClone(updates.mcp_preferences as Record<string, unknown>) }
          return { error: null }
        },
      }),
    }),
  },
}))

vi.mock("../../../asset-resolver.js", () => ({ resolveAssetId: vi.fn(async () => null) }))

const { registerVerbs } = await import("../verbs.js")
const { userSettingsRoutes } = await import("../../../../routes/user-settings.js")
const { invalidateUserPreferences } = await import("../../user-preferences.js")

let fastify: FastifyInstance
let generated: Record<string, unknown> | undefined

async function app(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false })
  // The internal hop names the user in the body; the auth middleware is not under test.
  f.addHook("preHandler", async (req) => {
    const userId = (req.body as Record<string, unknown> | undefined)?.userId
    if (typeof userId === "string") req.userId = userId
  })
  await f.register(userSettingsRoutes)
  f.post("/v1/generate-image", async (req) => {
    generated = req.body as Record<string, unknown>
    return { jobId: "j-1" }
  })
  await f.ready()
  return f
}

async function call(name: string, args: Record<string, unknown>) {
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  return callTool(server, name, args)
}

beforeEach(async () => {
  _resetRegistry()
  invalidateUserPreferences(USER)
  generated = undefined
  row = { mcp_preferences: { image: { model: "nano-banana-pro", aspectRatio: "9:16", resolution: "2K" }, video: { model: "veo3.1" } } }
  fastify = await app()
})

describe("save_image_defaults — null clears a field", () => {
  it("clears that field and keeps the others, and says so", async () => {
    const result = await call("save_image_defaults", { model: null })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toBe("Saved image defaults: model cleared.")
    expect(row.mcp_preferences).toEqual({ image: { aspectRatio: "9:16", resolution: "2K" }, video: { model: "veo3.1" } })
  })

  it("the next generate_image falls back to its own default model, and keeps the saved ratio and size", async () => {
    await call("generate_image", { prompt: "a lighthouse" })
    expect(generated?.provider).toBe("nano-banana-pro")

    expect((await call("save_image_defaults", { model: null })).isError).toBeUndefined()
    await call("generate_image", { prompt: "a lighthouse" })
    expect(generated?.provider).toBe(defaultImageModel("general", "9:16"))
    expect(generated?.aspectRatio).toBe("9:16")
    expect(generated?.resolution).toBe("2K")
  })

  it("a cleared ratio falls back to the tool's own (16:9)", async () => {
    expect((await call("save_image_defaults", { aspect_ratio: null })).isError).toBeUndefined()
    await call("generate_image", { prompt: "a lighthouse" })
    expect(generated?.provider).toBe("nano-banana-pro")
    expect(generated?.aspectRatio).toBe("16:9")
  })

  it("a field left out is unchanged, beside one set and one cleared", async () => {
    expect((await call("save_image_defaults", { quality: "high", resolution: null })).isError).toBeUndefined()
    expect(row.mcp_preferences.image).toEqual({ model: "nano-banana-pro", aspectRatio: "9:16", quality: "high" })
  })
})
