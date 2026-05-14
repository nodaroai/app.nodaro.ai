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
})
