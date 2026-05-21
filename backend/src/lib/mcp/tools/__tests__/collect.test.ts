import { describe, it, expect } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"
import { registerCollect } from "../collect.js"

/**
 * Spin up a minimal Fastify with a stub `POST /v1/collect` route so we
 * can exercise the MCP→route bridge end-to-end without touching the real
 * credit guard / Supabase. Same pattern as `apps.test.ts`.
 */
function fastifyWithCollect(
  handler: (
    body: Record<string, unknown>,
  ) => { status: number; body: Record<string, unknown> },
) {
  const app = Fastify()
  app.post("/v1/collect", async (req, reply) => {
    const r = handler(req.body as Record<string, unknown>)
    return reply.status(r.status).send(r.body)
  })
  return app
}

describe("collect MCP tool", () => {
  it("delegates to POST /v1/collect with userId forwarded from session", async () => {
    let received: Record<string, unknown> | undefined
    const fastify = fastifyWithCollect((body) => {
      received = body
      return {
        status: 200,
        body: {
          jobId: "job-1",
          output: "https://r2/picked.jpg",
          meta: { selectedIndex: 2, reasoning: "sharpest", summary: "1 of 5 selected" },
        },
      }
    })
    const server = buildServer()
    registerCollect({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:execute"] as Scope[],
        clientName: "Claude",
      }),
      fastify,
    })
    const result = await callTool(server, "collect", {
      strategyId: "pick-best-llm",
      strategyConfig: { criteria: "sharpest", inputKind: "image-url" },
      inputs: ["https://r2/a.jpg", "https://r2/b.jpg"],
    })
    expect(result.isError).toBeUndefined()
    expect(received?.userId).toBe("u1")
    expect(received?.strategyId).toBe("pick-best-llm")
    expect((received?.strategyConfig as Record<string, unknown>)?.criteria).toBe("sharpest")
    expect(result.structuredContent?.jobId).toBe("job-1")
    expect(result.structuredContent?.output).toBe("https://r2/picked.jpg")
    expect((result.structuredContent?.meta as Record<string, unknown>)?.selectedIndex).toBe(2)
  })

  it("defaults strategyConfig to {} when omitted", async () => {
    let received: Record<string, unknown> | undefined
    const fastify = fastifyWithCollect((body) => {
      received = body
      return {
        status: 200,
        body: {
          jobId: "job-2",
          output: "a\n\nb",
          meta: { summary: "2 of 2 concatenated" },
        },
      }
    })
    const server = buildServer()
    registerCollect({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:execute"] as Scope[],
        clientName: "Claude",
      }),
      fastify,
    })
    const result = await callTool(server, "collect", {
      strategyId: "concat",
      inputs: ["a", "b"],
    })
    expect(result.isError).toBeUndefined()
    expect(received?.strategyConfig).toEqual({})
  })

  it("rejects an unknown strategyId at the Zod boundary", async () => {
    const fastify = fastifyWithCollect(() => ({ status: 200, body: {} }))
    const server = buildServer()
    registerCollect({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:execute"] as Scope[],
        clientName: "Claude",
      }),
      fastify,
    })
    // Invalid `strategyId` — z.enum should reject at the MCP SDK input
    // validation boundary. The SDK returns `{ isError: true }` with the
    // Zod issues in `content[0].text` (not a throw).
    const result = await callTool(server, "collect", {
      strategyId: "not-a-real-strategy",
      inputs: ["x"],
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("invalid_enum_value")
    expect(result.content[0]?.text).toContain("strategyId")
  })

  it("surfaces EmptyInputError as a typed isError result", async () => {
    const fastify = fastifyWithCollect(() => ({
      status: 400,
      body: { error: { code: "no_valid_inputs", message: "All upstream iterations failed; nothing to collect." } },
    }))
    const server = buildServer()
    registerCollect({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:execute"] as Scope[],
        clientName: "Claude",
      }),
      fastify,
    })
    const result = await callTool(server, "collect", {
      strategyId: "first-non-empty",
      inputs: ["", " "],
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("no_valid_inputs")
  })

  it("does NOT register without workflows:execute scope", async () => {
    const server = buildServer()
    registerCollect({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("collect")
  })
})
