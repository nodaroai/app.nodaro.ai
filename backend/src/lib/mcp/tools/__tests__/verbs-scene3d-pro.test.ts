/**
 * The `pro_3d_render` MCP tool.
 *
 * Two claims, both about agents specifically:
 *
 *  - the tool is not offered where the deployment cannot serve it. An agent
 *    reads its tool list as a statement of what exists; a tool whose only
 *    possible answer is 503 is worse than a missing one, because the agent
 *    will retry it.
 *  - it posts to the SAME route the SDK and the canvas post to, carrying the
 *    caller's references unchanged. One transport means one set of refusals
 *    and one result shape, rather than three that drift.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud", SCENE3D_ADVANCED_ENABLED: true, SCENE3D_LOCAL_ENABLED: false,
    // Read at module load by the widget registrar / asset resolver graph; the
    // tool under test never touches either.
    PUBLIC_URL: "https://app.example.com",
    SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))

import { config } from "../../../config.js"
import { setPluginEngines } from "../../../private-plugins/engine-registry.js"
import { registerScene3DVerbs } from "../verbs-scene3d.js"

type Handler = (args: Record<string, unknown>) => Promise<unknown>

function harness() {
  const handlers: Record<string, Handler> = {}
  const server = { registerTool: (name: string, _meta: unknown, handler: Handler) => { handlers[name] = handler } }
  // Quote first, then submit — the tool makes both calls with the same body.
  const inject = vi.fn(async (opts: { url: string }) => ({
    statusCode: 200,
    body: JSON.stringify(
      opts.url.endsWith("/quote")
        ? { quoteId: "quote-1", expiresAt: "2026-09-08T01:00:00.000Z", maxCredits: 900, breakdown: [], pricingVersion: "p", capabilitiesVersion: "c", normalizedInputHash: "h" }
        : { jobId: "pro-job" },
    ),
  }))
  registerScene3DVerbs({
    server: server as never,
    fastify: { inject } as never,
    session: { userId: "owner", clientName: "test", scopes: ["workflows:execute"] } as never,
  })
  return { handlers, inject }
}

const capableEngine = {
  capabilities: vi.fn(), generate: vi.fn(), edit: vi.fn(),
  proRender: vi.fn(), quoteProRender: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  setPluginEngines({})
  config.SCENE3D_ADVANCED_ENABLED = true
})

describe("pro_3d_render registration follows engine readiness", () => {
  it("is absent with no engine installed", () => {
    expect(Object.keys(harness().handlers)).not.toContain("pro_3d_render")
  })

  it("is absent for an engine that predates the operation", () => {
    setPluginEngines({ scene3d: { capabilities: vi.fn(), generate: vi.fn(), edit: vi.fn() } })
    expect(Object.keys(harness().handlers)).not.toContain("pro_3d_render")
  })

  it("is absent for an engine that can run but cannot quote", () => {
    // The run route requires a quoteId nothing could mint — an agent offered
    // this tool would retry a call that can never succeed.
    setPluginEngines({ scene3d: { capabilities: vi.fn(), generate: vi.fn(), edit: vi.fn(), proRender: vi.fn() } })
    expect(Object.keys(harness().handlers)).not.toContain("pro_3d_render")
  })

  it("is absent while the advanced flag is off", () => {
    config.SCENE3D_ADVANCED_ENABLED = false
    setPluginEngines({ scene3d: capableEngine })
    expect(Object.keys(harness().handlers)).not.toContain("pro_3d_render")
  })

  it("appears once an installed engine implements it", () => {
    setPluginEngines({ scene3d: capableEngine })
    expect(Object.keys(harness().handlers)).toContain("pro_3d_render")
  })
})

describe("pro_3d_render uses the public route", () => {
  it("preserves selected GLBs in both quote and submission", async () => {
    setPluginEngines({ scene3d: capableEngine })
    const { handlers, inject } = harness()
    const inputAssets = [{ id: "vehicle", revisionId: "00000000-0000-4000-8000-000000000010",
      assetId: "00000000-0000-4000-8000-000000000011" }]
    await handlers.pro_3d_render({ source: { kind: "prompt", prompt: "Drive", input_assets: inputAssets } })
    const calls = inject.mock.calls.map(c => c[0] as unknown as { payload: Record<string, unknown> })
    expect(calls).toHaveLength(2)
    expect(calls[0].payload.source).toEqual({ kind: "prompt", prompt: "Drive", inputAssets })
    expect(calls[1].payload.source).toEqual(calls[0].payload.source)
  })
  it("quotes and submits the SAME body, with the source unchanged", async () => {
    setPluginEngines({ scene3d: capableEngine })
    const { handlers, inject } = harness()
    const references = [
      { id: "look", kind: "image", role: "appearance", url: "https://example.com/look.png" },
      { id: "motion", kind: "video", role: "motion", url: "https://example.com/motion.mp4" },
    ]
    await handlers.pro_3d_render({
      source: { kind: "prompt", prompt: "A red suitcase rolls behind a pillar", references },
      duration_seconds: 30, fps: 24, aspect_ratio: "21:9", max_repair_passes: 1,
    })

    expect(inject).toHaveBeenCalledTimes(2)
    const [quoteCall, runCall] = inject.mock.calls.map((c) => c[0] as unknown as { url: string; payload: Record<string, unknown> })
    expect(quoteCall.url).toBe("/v1/pro-3d-render/quote")
    expect(runCall.url).toBe("/v1/pro-3d-render")

    const expectedSource = { kind: "prompt", prompt: "A red suitcase rolls behind a pillar", references }
    expect(quoteCall.payload.source).toEqual(expectedSource)
    expect(runCall.payload.source).toEqual(expectedSource)
    // Identical apart from the quote it was priced under: that is what lets
    // admission re-check the hash of what was actually quoted.
    expect({ ...runCall.payload, quoteId: undefined }).toEqual({ ...quoteCall.payload, quoteId: undefined })
    expect(runCall.payload.quoteId).toBe("quote-1")
    expect(runCall.payload).toMatchObject({ durationSeconds: 30, fps: 24, aspectRatio: "21:9", maxRepairPasses: 1, userId: "owner" })

    // No planner knobs reach the wire: the tool does not expose them and the
    // payload does not invent them.
    for (const key of ["llmModel", "reasoningEffort", "prompt"]) {
      expect(runCall.payload).not.toHaveProperty(key)
    }
  })

  it("keeps a render-only scene source render-only", async () => {
    setPluginEngines({ scene3d: capableEngine })
    const { handlers, inject } = harness()
    await handlers.pro_3d_render({
      source: { kind: "scene", revision_id: "rev-1", source_job_id: "job-1" },
    })
    const runCall = inject.mock.calls[1][0] as unknown as { payload: { source: Record<string, unknown> } }
    expect(runCall.payload.source).toEqual({ kind: "scene", revisionId: "rev-1", sourceJobId: "job-1" })
    // Absent stays absent — an invented empty instruction would buy the agent
    // a paid authoring pass it did not request.
    expect("editPrompt" in runCall.payload.source).toBe(false)
  })

  it("carries an edit instruction when the agent supplies one", async () => {
    setPluginEngines({ scene3d: capableEngine })
    const { handlers, inject } = harness()
    await handlers.pro_3d_render({
      source: { kind: "scene", revision_id: "rev-1", source_job_id: "job-1", edit_prompt: "Move the camera left" },
    })
    expect((inject.mock.calls[1][0] as unknown as { payload: { source: unknown } }).payload.source).toEqual({
      kind: "scene", revisionId: "rev-1", sourceJobId: "job-1", editPrompt: "Move the camera left",
    })
  })

  it("exports a retained manual revision without inventing a source job", async () => {
    setPluginEngines({ scene3d: capableEngine })
    const { handlers, inject } = harness()
    await handlers.pro_3d_render({ source: { kind: "scene", revision_id: "manual-revision" } })
    for (const call of inject.mock.calls) {
      expect((call[0] as unknown as { payload: { source: unknown } }).payload.source)
        .toEqual({ kind: "scene", revisionId: "manual-revision" })
    }
  })

  it("sends a fresh retry token per call, and the agent's own when given", async () => {
    setPluginEngines({ scene3d: capableEngine })
    const { handlers, inject } = harness()
    await handlers.pro_3d_render({ source: { kind: "prompt", prompt: "one" } })
    await handlers.pro_3d_render({ source: { kind: "prompt", prompt: "two" } })
    const keyOf = (i: number) => (inject.mock.calls[i][0] as unknown as { headers?: Record<string, string> }).headers?.["idempotency-key"]
    // Two deliberate calls are two runs — a derived key would collapse them.
    expect(keyOf(1)).toBeTruthy()
    expect(keyOf(3)).toBeTruthy()
    expect(keyOf(1)).not.toBe(keyOf(3))

    await handlers.pro_3d_render({ source: { kind: "prompt", prompt: "three" }, client_request_id: "agent-retry-1" })
    expect(keyOf(5)).toBe("mcp:agent-retry-1")
  })
})
