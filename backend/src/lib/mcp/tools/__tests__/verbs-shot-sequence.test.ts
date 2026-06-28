import { describe, it, expect, vi } from "vitest"
import { registerShotSequenceVerbs } from "../verbs-shot-sequence.js"

type Handler = (args: Record<string, unknown>) => Promise<unknown>

function harness(injectImpl: (opts: { url: string; payload: unknown; headers?: Record<string, string> }) => Promise<{ statusCode: number; body: string }>) {
  const tools: Record<string, Handler> = {}
  const server = { registerTool: (name: string, _meta: unknown, handler: Handler) => { tools[name] = handler } }
  const inject = vi.fn(injectImpl)
  const fastify = { inject } as unknown as Parameters<typeof registerShotSequenceVerbs>[0]["fastify"]
  const session = { userId: "u-1", clientName: "test", scopes: ["workflows:execute"] } as unknown as Parameters<typeof registerShotSequenceVerbs>[0]["session"]
  registerShotSequenceVerbs({ server: server as never, session, fastify })
  return { tools, inject }
}

describe("render_shot_sequence", () => {
  it("dispatches to /v1/render-video/plan with planType + userId + video widget", async () => {
    const { tools, inject } = harness(async () => ({ statusCode: 200, body: JSON.stringify({ jobId: "job-1" }) }))
    await tools.render_shot_sequence({ plan: { planType: "shot-sequence", scenes: [] } })
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/v1/render-video/plan",
        payload: expect.objectContaining({ planType: "shot-sequence", userId: "u-1" }),
      }),
    )
  })
})

describe("resolve_shot_sequence", () => {
  it("injects to the resolve route with the internal secret + userId and surfaces warnings", async () => {
    const { tools, inject } = harness(async () => ({
      statusCode: 200,
      body: JSON.stringify({ plan: { planType: "shot-sequence" }, warnings: ["Cue \"c1\" was not found"] }),
    }))
    const result = (await tools.resolve_shot_sequence({ brief: {}, audio_url: "https://x/a.mp3", alignment: [] })) as { content: Array<{ text: string }> }
    const call = inject.mock.calls[0][0] as { url: string; headers: Record<string, string>; payload: Record<string, unknown> }
    expect(call.url).toBe("/v1/shot-sequence/resolve")
    expect(call.headers["x-internal-orchestrator-secret"]).toBeTruthy()
    expect(call.payload.userId).toBe("u-1")
    expect(JSON.stringify(result.content)).toContain("Cue")
  })
})

describe("forced_alignment", () => {
  it("dispatches to /v1/forced-alignment with the transcript + userId", async () => {
    const { tools, inject } = harness(async () => ({ statusCode: 200, body: JSON.stringify({ jobId: "fa-1" }) }))
    await tools.forced_alignment({ audio_url: "https://x/a.mp3", transcript: "ship faster" })
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/v1/forced-alignment",
        payload: expect.objectContaining({ audioUrl: "https://x/a.mp3", transcript: "ship faster", userId: "u-1" }),
      }),
    )
  })
})
