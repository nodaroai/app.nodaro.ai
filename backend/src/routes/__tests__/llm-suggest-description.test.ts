import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { llmSuggestDescriptionRoutes } from "../llm-suggest-description.js"
import { llmComplete } from "../../lib/llm-client.js"

vi.mock("../../lib/llm-client.js", () => ({
  llmComplete: vi.fn(),
}))

const TEST_USER_ID = "00000000-0000-0000-0000-000000000001"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await llmSuggestDescriptionRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => { await app.close() })

describe("POST /v1/llm-suggest-description", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-suggest-description",
      payload: { kind: "asset-description", context: { variant: "smile" } },
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 on unknown kind", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-suggest-description",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { kind: "not-a-real-kind", context: {} },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 200 with { text } on success", async () => {
    vi.mocked(llmComplete).mockResolvedValue({
      text: "warm closed-mouth smile, slight eye crinkle",
      model: "claude-sonnet-4.6",
    } as Awaited<ReturnType<typeof llmComplete>>)

    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-suggest-description",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        kind: "asset-description",
        context: { variant: "smile", canonicalDescription: "Kira: late 20s …", assetType: "expressions" },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ text: "warm closed-mouth smile, slight eye crinkle" })
    expect(llmComplete).toHaveBeenCalledTimes(1)
  })

  it("returns 502 when llmComplete throws", async () => {
    vi.mocked(llmComplete).mockRejectedValue(new Error("LLM provider down"))

    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-suggest-description",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        kind: "asset-description",
        context: { variant: "smile", assetType: "expressions" },
      },
    })
    expect(res.statusCode).toBe(502)
  })

  it("uses seed-prompt system message for kind=seed-prompt", async () => {
    vi.mocked(llmComplete).mockResolvedValue({
      text: "a vivid character description",
      model: "claude-sonnet-4.6",
    } as Awaited<ReturnType<typeof llmComplete>>)

    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-suggest-description",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { kind: "seed-prompt", context: { dimensions: { age: "30s" } } },
    })
    expect(res.statusCode).toBe(200)
    const call = vi.mocked(llmComplete).mock.calls[0]![0]
    expect(call.system).toContain("~80–150 words")
    expect(call.messages[0]!.content).toContain("Picker dimensions:")
  })

  it("uses motion-description system message for kind=motion-description", async () => {
    vi.mocked(llmComplete).mockResolvedValue({
      text: "smooth stride, head held high",
      model: "claude-sonnet-4.6",
    } as Awaited<ReturnType<typeof llmComplete>>)

    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-suggest-description",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { kind: "motion-description", context: { variant: "walking" } },
    })
    expect(res.statusCode).toBe(200)
    const call = vi.mocked(llmComplete).mock.calls[0]![0]
    expect(call.system).toContain("behavioral descriptions")
    expect(call.messages[0]!.content).toContain('Motion: "walking"')
  })

  it("returns 503 provider_unavailable when no LLM keys are configured", async () => {
    // Stub config module to simulate missing keys
    vi.doMock("../../lib/config.js", () => ({
      config: { KIE_API_KEY: undefined, ANTHROPIC_API_KEY: undefined },
    }))
    // Re-import route after stubbing
    vi.resetModules()
    const { llmSuggestDescriptionRoutes: routesModule } = await import("../llm-suggest-description.js")
    const localApp = Fastify({ logger: false })
    localApp.addHook("preHandler", async (req) => {
      const header = req.headers["x-user-id"]
      if (typeof header === "string") req.userId = header
    })
    await localApp.register(async (i) => { await routesModule(i) })
    await localApp.ready()

    const res = await localApp.inject({
      method: "POST",
      url: "/v1/llm-suggest-description",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { kind: "asset-description", context: { variant: "smile", assetType: "expressions" } },
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("provider_unavailable")

    await localApp.close()
    vi.doUnmock("../../lib/config.js")
    vi.resetModules()
  })

  it("returns 502 llm_empty_response when llmComplete returns empty text", async () => {
    vi.mocked(llmComplete).mockResolvedValue({
      text: "   ",
      model: "claude-sonnet-4.6",
    } as Awaited<ReturnType<typeof llmComplete>>)

    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-suggest-description",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { kind: "asset-description", context: { variant: "smile", assetType: "expressions" } },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("llm_empty_response")
  })
})
