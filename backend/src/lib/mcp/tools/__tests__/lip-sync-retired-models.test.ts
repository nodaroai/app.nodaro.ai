import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { RETIRED_LIP_SYNC_PROVIDERS, retiredLipSyncProviderMessage } from "@nodaro/shared/models"
import { _resetRegistry } from "../../tasks.js"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

/**
 * The MCP `lip_sync` tool on a model retired from Lip Sync (Wav2Lip,
 * VideoReTalking, SadTalker — decided 2026-11-12): the tool hands the model to
 * `/v1/lip-sync` as it is, and the route refuses it with the retirement's
 * sentence before its credit guard, so the call answers that sentence as an
 * error and nothing is checked, reserved or queued. The tool's model list no
 * longer names them.
 */

const h = vi.hoisted(() => ({
  guarded: vi.fn(),
  queueAdd: vi.fn(),
}))

vi.mock("../../user-preferences.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../user-preferences.js")>()),
  getUserMcpPreferences: vi.fn(async () => ({})),
}))
vi.mock("../../asset-resolver.js", () => ({ resolveAssetId: vi.fn(async () => null) }))
vi.mock("../../../supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: { mcp_preferences: {} }, error: null }),
        }),
      }),
    }),
  },
}))
vi.mock("../../../queue.js", () => ({ videoQueue: { add: h.queueAdd }, redis: {} }))
vi.mock("../../../../middleware/credit-guard.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../middleware/credit-guard.js")>()),
  creditGuard: () => async () => {
    h.guarded()
  },
  reserveCreditsForJob: vi.fn(async () => {
    h.guarded()
    return { usageLogId: "usage-1", creditsReserved: 1, watermark: false }
  }),
}))

const { registerVerbs } = await import("../verbs.js")
const { lipSyncRoutes } = await import("../../../../routes/lip-sync.js")

const USER = "00000000-0000-4000-8000-000000000001"
let fastify: FastifyInstance

beforeAll(async () => {
  fastify = Fastify({ logger: false })
  fastify.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await fastify.register(async (instance) => lipSyncRoutes(instance))
  await fastify.ready()
})

afterAll(async () => {
  await fastify?.close()
})

beforeEach(() => {
  _resetRegistry()
  vi.clearAllMocks()
  h.queueAdd.mockResolvedValue({ id: "queue-job-1" })
})

function session() {
  return newSession({ userId: USER, scopes: ["workflows:execute"] as Scope[], clientName: "Claude" })
}

async function lipSync(model: string) {
  const server = buildServer()
  registerVerbs({ server, session: session(), fastify })
  return callTool(server, "lip_sync", {
    image_url: "https://cdn.nodaro.ai/uploads/face.png",
    audio_url: "https://cdn.nodaro.ai/uploads/line.mp3",
    audio_duration_sec: 6,
    model,
  })
}

const textOf = (result: unknown) =>
  ((result as { content?: Array<{ type: string; text?: string }> }).content ?? []).map((c) => c.text ?? "").join("\n")

describe("MCP lip_sync on a retired Lip Sync model", () => {
  for (const model of Object.keys(RETIRED_LIP_SYNC_PROVIDERS)) {
    it(`${model}: answers the retirement's sentence as an error; nothing is checked, reserved or queued`, async () => {
      const result = await lipSync(model)
      expect((result as { isError?: boolean }).isError).toBe(true)
      expect(textOf(result)).toContain(retiredLipSyncProviderMessage(model)!)
      expect(h.guarded).not.toHaveBeenCalled()
      expect(h.queueAdd).not.toHaveBeenCalled()
    })
  }

  it("a model still offered goes through to the job", async () => {
    const result = await lipSync("kling-avatar")
    expect((result as { isError?: boolean }).isError).not.toBe(true)
    expect(h.queueAdd).toHaveBeenCalledTimes(1)
    expect(h.queueAdd.mock.calls[0]![1]).toMatchObject({ provider: "kling-avatar" })
  })

  it("the tool's model list names none of them", async () => {
    const server = buildServer()
    registerVerbs({ server, session: session(), fastify })
    const def = (await listTools(server)).find((t) => t.name === "lip_sync")
    const text = JSON.stringify(def)
    for (const model of Object.keys(RETIRED_LIP_SYNC_PROVIDERS)) expect(text).not.toContain(model)
    expect(text).toContain("latentsync")
  })
})
