/**
 * An install whose plugin does not serve Nodaro Image Upscale (every community
 * and business install): the model is refused before anything is held or
 * copied — on `/v1/edit-image` and through MCP `edit_image`, which dispatches
 * to it — by the REAL credit guard's deny, with no model restriction turned on
 * (the house rule withholds only itself).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), auth: { getUser: vi.fn() } } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn(async () => false) }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>()
  return {
    ...actual,
    config: { ...actual.config, EDITION: "community", PUBLIC_URL: actual.config.PUBLIC_URL ?? "https://app.example" },
    isCloud: () => false,
    hasCredits: () => false,
    isCommunity: () => true,
    isBusiness: () => false,
    hasAdmin: () => false,
  }
})
vi.mock("@/lib/outside-input-copy.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/outside-input-copy.js")>()),
  copyOutsideInput: vi.fn(async () => {
    throw new Error("copyOutsideInput must not run for an unserved house model")
  }),
  inspectOutsideInput: vi.fn(async () => {
    throw new Error("inspectOutsideInput must not run for an unserved house model")
  }),
}))
vi.mock("../../lib/asset-resolver.js", () => ({ resolveAssetId: vi.fn(async () => null) }))

import { editImageRoutes } from "../edit-image.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { copyOutsideInput, inspectOutsideInput } from "../../lib/outside-input-copy.js"
import { _resetPluginServicesForTests } from "../../lib/private-plugins/services-registry.js"
import { isHouseModelUnserved, modelRestrictionConfigured } from "../../lib/surface-deny.js"
import { _resetRegistry } from "../../lib/mcp/tasks.js"
import { buildServer, callTool, executeSession } from "../../lib/mcp/tools/__tests__/_helpers.js"

const USER = "00000000-0000-4000-8000-000000000001"
const IMAGE = "https://cdn.example/photo.png"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  _resetPluginServicesForTests()
  _resetRegistry()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    req.userId = typeof body?.userId === "string" ? body.userId : USER
  })
  await app.register(async (instance) => {
    await editImageRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function expectNothingHeldOrCopied(): void {
  expect(copyOutsideInput).not.toHaveBeenCalled()
  expect(inspectOutsideInput).not.toHaveBeenCalled()
  expect(supabase.from).not.toHaveBeenCalledWith("jobs")
  expect(videoQueue.add).not.toHaveBeenCalled()
}

describe("Nodaro Image Upscale where no plugin serves it", () => {
  it("withholds only itself: it is unserved, and no model restriction is on", () => {
    expect(isHouseModelUnserved("nodaro-image-upscale")).toBe(true)
    expect(modelRestrictionConfigured()).toBe(false)
  })

  it("/v1/edit-image refuses it with 403 model_not_available before anything is held or copied", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: { userId: USER, provider: "nodaro-image-upscale", imageUrl: IMAGE, upscaleFactor: "8" },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: { code: "model_not_available" } })
    expectNothingHeldOrCopied()
  })

  it("MCP edit_image, which dispatches to the route, gets the same refusal", async () => {
    const { registerVerbs } = await import("../../lib/mcp/tools/verbs.js")
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify: app })
    const result = await callTool(server, "edit_image", { model: "nodaro-image-upscale", image_url: IMAGE, upscale_factor: "4" })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toMatch(/not available/i)
    expectNothingHeldOrCopied()
  })
})
