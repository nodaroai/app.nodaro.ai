import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { type Scope } from "../../scopes.js"

// Stub supabase so any DB-touching tools (list_apps, list_components, etc.)
// return empty rows. tools/list itself never executes a tool body; this is
// only here in case a registration codepath touches the client.
vi.mock("../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { buildMcpServer } = await import("../server.js")

/**
 * Inspects the SDK's internal `_requestHandlers` Map to invoke `tools/list`
 * in-process. Same shim as `server.test.ts`. If the SDK ever hides this we'll
 * switch to a paired InMemory transport.
 */
type ToolsListHandler = (
  req: { method: string; params: Record<string, unknown> },
  extra: Record<string, unknown>,
) => Promise<{ tools: { name: string }[] }>

async function listTools(
  server: Awaited<ReturnType<typeof buildMcpServer>>,
): Promise<{ name: string }[]> {
  const inner = (server as unknown as {
    server: { _requestHandlers: Map<string, ToolsListHandler> }
  }).server
  const handler = inner._requestHandlers.get("tools/list")
  if (!handler) throw new Error("tools/list handler not registered")
  const result = await handler({ method: "tools/list", params: {} }, {})
  return result.tools
}

const ALL_GRANTED: Scope[] = [
  "workflows:read",
  "workflows:write",
  "workflows:execute",
  "jobs:read",
  "assets:read",
  "assets:write",
  "credits:read",
  "apps:read",
]

describe("buildMcpServer full catalog (v1.1)", () => {
  it("with all scopes granted, registers the full v1.1 tool catalog", async () => {
    const fastify = Fastify()
    const server = await buildMcpServer({
      userId: "u1",
      scopes: ALL_GRANTED,
      clientName: "Claude",
      fastify,
    })
    const tools = await listTools(server)
    const names = new Set(tools.map((t) => t.name))

    // ping (always)
    expect(names.has("ping")).toBe(true)

    // 13 generation verbs (image / video / audio / character-location-object)
    // image: generate_image, modify_image
    expect(names.has("generate_image")).toBe(true)
    expect(names.has("modify_image")).toBe(true)
    // video: generate_video, animate_image, extract_frame, combine_videos,
    // add_captions, extend_video
    expect(names.has("generate_video")).toBe(true)
    expect(names.has("animate_image")).toBe(true)
    expect(names.has("extract_frame")).toBe(true)
    expect(names.has("combine_videos")).toBe(true)
    expect(names.has("add_captions")).toBe(true)
    expect(names.has("extend_video")).toBe(true)
    // audio: generate_music, generate_speech, download_youtube_audio
    expect(names.has("generate_music")).toBe(true)
    expect(names.has("generate_speech")).toBe(true)
    expect(names.has("download_youtube_audio")).toBe(true)
    // character / location / object
    expect(names.has("generate_character")).toBe(true)
    expect(names.has("generate_location")).toBe(true)
    expect(names.has("generate_object")).toBe(true)

    // 11 utility tools (jobs / workflows / components / apps / models / credits)
    expect(names.has("list_jobs")).toBe(true)
    expect(names.has("get_job")).toBe(true)
    expect(names.has("list_workflows")).toBe(true)
    expect(names.has("run_workflow")).toBe(true)
    expect(names.has("list_components")).toBe(true)
    expect(names.has("run_component")).toBe(true)
    expect(names.has("list_apps")).toBe(true)
    expect(names.has("run_app")).toBe(true)
    expect(names.has("list_models")).toBe(true)
    // credits:read + cloud-only (test setup pins EDITION=cloud)
    expect(names.has("check_balance")).toBe(true)
    expect(names.has("credit_transactions")).toBe(true)

    // 4 gallery tools
    expect(names.has("browse_gallery")).toBe(true)
    expect(names.has("list_favorites")).toBe(true)
    expect(names.has("favorite_asset")).toBe(true)
    expect(names.has("get_asset")).toBe(true)
    expect(names.has("display_asset")).toBe(true)

    // swap_face is intentionally absent — no /v1/swap-face route exists.
    expect(names.has("swap_face")).toBe(false)

    // 18 upload tools — four paths × three media kinds:
    //   request_*_upload         — handoff via user's own browser; bypasses
    //                              Claude.ai's bash sandbox by routing the
    //                              upload outside it
    //   prepare_*_upload         — presigned PUT, curl from non-sandboxed clients
    //   upload_*_init / _chunk / _complete — chunked, server-side stitching
    //                              via Redis. Works in sandbox-restricted
    //                              clients because chunks flow through the
    //                              MCP channel (allowlisted), not bash egress
    //   upload_*                 — inline base64, last-resort tiny-file fallback
    expect(names.has("request_image_upload")).toBe(true)
    expect(names.has("request_audio_upload")).toBe(true)
    expect(names.has("request_video_upload")).toBe(true)
    expect(names.has("upload_image_init")).toBe(true)
    expect(names.has("upload_image_chunk")).toBe(true)
    expect(names.has("upload_image_complete")).toBe(true)
    expect(names.has("upload_audio_init")).toBe(true)
    expect(names.has("upload_video_init")).toBe(true)

    // Sanity: ping + verbs + jobs + workflows + gallery + 12 upload tools
    // (4 paths × 3 kinds). Allow range for future additions + dynamic tools.
    expect(tools.length).toBeGreaterThanOrEqual(30)
    expect(tools.length).toBeLessThanOrEqual(60)
  })

  it("with only jobs:read, registers ping + jobs tools and nothing else", async () => {
    const fastify = Fastify()
    const server = await buildMcpServer({
      userId: "u1",
      scopes: ["jobs:read"],
      clientName: "Test",
      fastify,
    })
    const tools = await listTools(server)
    const names = tools.map((t) => t.name)

    expect(names).toContain("ping")
    expect(names).toContain("list_jobs")
    expect(names).toContain("get_job")
    // list_models is always-on (no gate)
    expect(names).toContain("list_models")

    // Must NOT include any execute-gated tool
    expect(names).not.toContain("generate_image")
    expect(names).not.toContain("run_workflow")
    expect(names).not.toContain("run_component")
    expect(names).not.toContain("run_app")
    // Must NOT include workflows:read tools
    expect(names).not.toContain("list_workflows")
    expect(names).not.toContain("list_components")
    // Must NOT include assets:read tools
    expect(names).not.toContain("browse_gallery")
    expect(names).not.toContain("favorite_asset")
    // Must NOT include credits:read tools
    expect(names).not.toContain("check_balance")
    expect(names).not.toContain("credit_transactions")
    // Must NOT include apps:read tools
    expect(names).not.toContain("list_apps")
  })

  it("with no scopes, registers only the unscoped tools (ping, list_models)", async () => {
    const fastify = Fastify()
    const server = await buildMcpServer({
      userId: "u1",
      scopes: [],
      clientName: "Test",
      fastify,
    })
    const tools = await listTools(server)
    const names = tools.map((t) => t.name)

    expect(names).toContain("ping")
    expect(names).toContain("list_models")
    expect(names).not.toContain("list_jobs")
    expect(names).not.toContain("generate_image")
    expect(names).not.toContain("check_balance")
    expect(tools).toHaveLength(2)
  })

  it("v3.0: dynamic per-user tools dropped — list_apps + get_app_inputs + run_app cover the same surface", async () => {
    const fastify = Fastify()
    const server = await buildMcpServer({
      userId: "u1",
      scopes: ALL_GRANTED,
      clientName: "Claude",
      fastify,
    })
    const tools = await listTools(server)
    const names = tools.map((t) => t.name)
    // The discovery trio replaces N per-user tools.
    expect(names).toContain("list_apps")
    expect(names).toContain("get_app_inputs")
    expect(names).toContain("run_app")
    expect(names).toContain("list_components")
    expect(names).toContain("get_component_inputs")
    expect(names).toContain("run_component")
    // Per-user dynamic tools must NOT show up anymore.
    expect(names.some((n) => n.startsWith("app_"))).toBe(false)
    expect(names.some((n) => n.startsWith("component_"))).toBe(false)
  })
})
