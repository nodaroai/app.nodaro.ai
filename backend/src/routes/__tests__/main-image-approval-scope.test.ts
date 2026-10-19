import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import { supabase } from "../../lib/supabase.js"
import { characterPortraitApprovalRoutes } from "../character-portrait-approval.js"
import { locationMainImageApprovalRoutes } from "../location-main-image-approval.js"
import { objectMainImageApprovalRoutes } from "../object-main-image-approval.js"
import { creatureMainImageApprovalRoutes } from "../creature-main-image-approval.js"
import { locationLlmCaptionRoutes } from "../location-llm-caption.js"
import { objectLlmCaptionRoutes } from "../object-llm-caption.js"
import { creatureLlmCaptionRoutes } from "../creature-llm-caption.js"

// Every route that sets an entity's main image or rewrites its description
// through the AI caption is an asset write: an OAuth app needs assets:write,
// the same gate as creating or deleting the entity (#2390). User sessions and
// personal API keys carry no appAuthorization and are unaffected.

vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../lib/llm-client.js", () => ({ llmComplete: vi.fn() }))
vi.mock("../../lib/config.js", () => ({
  config: { ANTHROPIC_API_KEY: "test-key", KIE_API_KEY: "test-key" },
}))
// The credit gate is not under test: a pass-through keeps the scope gate the
// only thing that can refuse the request before the handler.
vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
}))

const ID = "00000000-0000-4000-8000-000000000020"

const ROUTES = [
  { url: `/v1/characters/${ID}/approve-portrait`, plugin: characterPortraitApprovalRoutes },
  { url: `/v1/characters/${ID}/llm-caption`, plugin: characterPortraitApprovalRoutes },
  { url: `/v1/locations/${ID}/approve-main-image`, plugin: locationMainImageApprovalRoutes },
  { url: `/v1/objects/${ID}/approve-main-image`, plugin: objectMainImageApprovalRoutes },
  { url: `/v1/creatures/${ID}/approve-main-image`, plugin: creatureMainImageApprovalRoutes },
  { url: `/v1/locations/${ID}/llm-caption`, plugin: locationLlmCaptionRoutes },
  { url: `/v1/objects/${ID}/llm-caption`, plugin: objectLlmCaptionRoutes },
  { url: `/v1/creatures/${ID}/llm-caption`, plugin: creatureLlmCaptionRoutes },
] as const

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  vi.clearAllMocks()
})

async function appWithScopes(
  plugin: (i: FastifyInstance) => Promise<void>,
  scopes: string[],
): Promise<FastifyInstance> {
  const a = Fastify({ logger: false })
  a.addHook("onRequest", async (req: FastifyRequest) => {
    req.userId = "00000000-0000-4000-8000-000000000001"
    req.appAuthorization = { appId: "x", authorizationId: "z", scopes }
  })
  await a.register(async (i) => { await plugin(i) })
  await a.ready()
  return a
}

describe("main-image approve and caption routes require assets:write for OAuth apps", () => {
  it.each(ROUTES)("$url → 403 insufficient_scope without assets:write, before any read", async ({ url, plugin }) => {
    app = await appWithScopes(plugin, ["assets:read"])
    const res = await app.inject({ method: "POST", url, payload: { candidateJobId: ID } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("insufficient_scope")
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it.each(ROUTES)("$url → passes the scope gate with assets:write", async ({ url, plugin }) => {
    app = await appWithScopes(plugin, ["assets:write"])
    vi.mocked(supabase.from).mockImplementation(() => {
      throw new Error("handler reached")
    })
    const res = await app.inject({ method: "POST", url, payload: {} })
    // Reaches the handler (which refuses the empty body or hits the stubbed
    // DB) — anything but the scope refusal.
    expect(res.statusCode).not.toBe(403)
  })
})
