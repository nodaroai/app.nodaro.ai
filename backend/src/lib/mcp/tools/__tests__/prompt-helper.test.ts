import { describe, it, expect } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"
import { registerPromptHelper } from "../prompt-helper.js"

function fastifyWithWizard(
  handler: (body: Record<string, unknown>) => { status: number; body: Record<string, unknown> },
) {
  const app = Fastify()
  app.post("/v1/prompt-helper/wizard", async (req, reply) => {
    const r = handler(req.body as Record<string, unknown>)
    return reply.status(r.status).send(r.body)
  })
  return app
}

const session = () => newSession({ userId: "u1", scopes: ["workflows:execute"] as Scope[], clientName: "Claude" })

describe("prompt-helper MCP tools", () => {
  it("analyze_prompt delegates to the route with userId from session", async () => {
    let received: Record<string, unknown> | undefined
    const fastify = fastifyWithWizard((body) => {
      received = body
      return { status: 200, body: { jobId: "j", questions: [{ category: "subject", label: "?", options: [{ value: "cat", label: "Cat" }], selected: "cat", allowCustom: true }] } }
    })
    const server = buildServer()
    registerPromptHelper({ server, session: session(), fastify })
    const result = await callTool(server, "analyze_prompt", { nodeType: "generate-image", prompt: "a cat" })
    expect(result.isError).toBeUndefined()
    expect(received?.userId).toBe("u1")
    expect(received?.action).toBe("analyze")
    expect((result.structuredContent?.questions as unknown[]).length).toBe(1)
  })

  it("enhance_prompt returns a one-shot prompt", async () => {
    const fastify = fastifyWithWizard(() => ({ status: 200, body: { jobId: "j", prompt: "cinematic snow leopard" } }))
    const server = buildServer()
    registerPromptHelper({ server, session: session(), fastify })
    const result = await callTool(server, "enhance_prompt", { nodeType: "generate-image", prompt: "snow leopard" })
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.prompt).toBe("cinematic snow leopard")
  })

  it("generate_prompt delegates with action=generate and forwards selections", async () => {
    let received: Record<string, unknown> | undefined
    const fastify = fastifyWithWizard((body) => {
      received = body
      return { status: 200, body: { jobId: "j", prompt: "a photorealistic cat" } }
    })
    const server = buildServer()
    registerPromptHelper({ server, session: session(), fastify })
    const result = await callTool(server, "generate_prompt", {
      nodeType: "generate-image",
      selections: [{ category: "subject", value: "cat", isCustom: false }],
    })
    expect(result.isError).toBeUndefined()
    expect(received?.userId).toBe("u1")
    expect(received?.action).toBe("generate")
    expect((received?.selections as Array<{ value: string }>)[0].value).toBe("cat")
    expect(result.structuredContent?.prompt).toBe("a photorealistic cat")
  })

  it("surfaces a 4xx as a typed isError result", async () => {
    const fastify = fastifyWithWizard(() => ({ status: 400, body: { error: { code: "validation_error", message: "bad" } } }))
    const server = buildServer()
    registerPromptHelper({ server, session: session(), fastify })
    const result = await callTool(server, "generate_prompt", { nodeType: "generate-image", selections: [{ category: "s", value: "v", isCustom: false }] })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("validation_error")
  })

  it("does NOT register without workflows:execute scope", async () => {
    const server = buildServer()
    registerPromptHelper({
      server,
      session: newSession({ userId: "u1", scopes: ["workflows:read"] as Scope[], clientName: "Claude" }),
      fastify: Fastify(),
    })
    const names = (await listTools(server)).map((t) => t.name)
    expect(names).not.toContain("analyze_prompt")
    expect(names).not.toContain("generate_prompt")
    expect(names).not.toContain("enhance_prompt")
  })
})
