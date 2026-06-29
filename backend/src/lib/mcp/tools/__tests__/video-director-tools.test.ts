import { describe, it, expect, vi } from "vitest"
import { registerVideoDirectorTools } from "../video-director-tools.js"

type Handler = (args: Record<string, unknown>) => Promise<unknown>

function harness(
  scopes: string[],
  injectImpl: (opts: { url: string; payload: unknown; headers?: Record<string, string> }) => Promise<{ statusCode: number; body: string }>,
) {
  const tools: Record<string, Handler> = {}
  const server = { registerTool: (name: string, _meta: unknown, handler: Handler) => { tools[name] = handler } }
  const inject = vi.fn(injectImpl)
  const fastify = { inject } as unknown as Parameters<typeof registerVideoDirectorTools>[0]["fastify"]
  const session = { userId: "u-1", clientName: "test", scopes } as unknown as Parameters<typeof registerVideoDirectorTools>[0]["session"]
  registerVideoDirectorTools({ server: server as never, session, fastify })
  return { tools, inject }
}

describe("registerVideoDirectorTools gate", () => {
  it("registers no tools when the session lacks workflows:execute", () => {
    const { tools } = harness([], async () => ({ statusCode: 200, body: "{}" }))
    expect(Object.keys(tools)).toHaveLength(0)
  })

  it("registers create_explainer + create_launch_video when scoped", () => {
    const { tools } = harness(["workflows:execute"], async () => ({ statusCode: 200, body: "{}" }))
    expect(tools.create_explainer).toBeDefined()
    expect(tools.create_launch_video).toBeDefined()
  })
})

describe("create_explainer", () => {
  it("dispatches to /v1/video-director/run with genre=explainer, brief=topic + userId, returns jobId", async () => {
    const { tools, inject } = harness(["workflows:execute"], async () => ({
      statusCode: 200,
      body: JSON.stringify({ jobId: "job-1" }),
    }))
    const result = (await tools.create_explainer({ topic: "How vaccines work" })) as {
      structuredContent?: { jobId?: string }
    }
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/v1/video-director/run",
        payload: expect.objectContaining({
          genre: "explainer",
          brief: "How vaccines work",
          userId: "u-1",
          mcp_client: "test",
        }),
      }),
    )
    expect(result.structuredContent?.jobId).toBe("job-1")
  })
})

describe("create_launch_video", () => {
  it("returns the deferred-capture message and dispatches NOTHING when url is given without brief", async () => {
    const { tools, inject } = harness(["workflows:execute"], async () => ({
      statusCode: 200,
      body: JSON.stringify({ jobId: "job-1" }),
    }))
    const result = (await tools.create_launch_video({ url: "https://example.com/product" })) as {
      content: Array<{ text: string }>
    }
    expect(inject).not.toHaveBeenCalled()
    expect(JSON.stringify(result.content)).toContain("Real-UI capture isn't supported yet")
  })

  it("dispatches to /v1/video-director/run with genre=product-launch when brief is given", async () => {
    const { tools, inject } = harness(["workflows:execute"], async () => ({
      statusCode: 200,
      body: JSON.stringify({ jobId: "job-2" }),
    }))
    const result = (await tools.create_launch_video({ brief: "A smart water bottle" })) as {
      structuredContent?: { jobId?: string }
    }
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/v1/video-director/run",
        payload: expect.objectContaining({
          genre: "product-launch",
          brief: "A smart water bottle",
          userId: "u-1",
          mcp_client: "test",
        }),
      }),
    )
    expect(result.structuredContent?.jobId).toBe("job-2")
  })

  it("dispatches with brief even when a url is also supplied (brief wins)", async () => {
    const { tools, inject } = harness(["workflows:execute"], async () => ({
      statusCode: 200,
      body: JSON.stringify({ jobId: "job-3" }),
    }))
    await tools.create_launch_video({ brief: "A drone", url: "https://example.com/x" })
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/v1/video-director/run",
        payload: expect.objectContaining({ genre: "product-launch", brief: "A drone" }),
      }),
    )
  })

  it("asks for a brief and dispatches NOTHING when neither brief nor url is given", async () => {
    const { tools, inject } = harness(["workflows:execute"], async () => ({
      statusCode: 200,
      body: JSON.stringify({ jobId: "job-1" }),
    }))
    const result = (await tools.create_launch_video({})) as { content: Array<{ text: string }>; isError?: boolean }
    expect(inject).not.toHaveBeenCalled()
    expect(JSON.stringify(result.content)).toContain("brief")
  })
})
