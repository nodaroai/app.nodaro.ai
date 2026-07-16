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
    // image: generate_image, modify_image, image_collage
    expect(names.has("generate_image")).toBe(true)
    expect(names.has("modify_image")).toBe(true)
    expect(names.has("image_collage")).toBe(true)
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
    // voice: list_voices (enumerate premade catalog), and voice_changer_pro —
    // the latter is hasCredits()-gated, present here because the test env is
    // EDITION=cloud (see the module-level note above).
    expect(names.has("list_voices")).toBe(true)
    expect(names.has("voice_changer_pro")).toBe(true)
    // character / location / object / creature
    expect(names.has("generate_character")).toBe(true)
    expect(names.has("generate_location")).toBe(true)
    expect(names.has("generate_object")).toBe(true)
    expect(names.has("generate_creature")).toBe(true)

    // creature Studio tools — mirror the object Studio surface (assets:write
    // for approve/recaption, workflows:execute for motion).
    expect(names.has("approve_creature_main_image")).toBe(true)
    expect(names.has("recaption_creature")).toBe(true)
    expect(names.has("generate_creature_motion")).toBe(true)

    // utility tools (jobs / workflows / projects / components / apps / models / credits)
    expect(names.has("list_jobs")).toBe(true)
    expect(names.has("get_job")).toBe(true)
    expect(names.has("list_workflows")).toBe(true)
    expect(names.has("get_workflow")).toBe(true)
    expect(names.has("get_workflow_json")).toBe(true)
    expect(names.has("create_workflow")).toBe(true)
    expect(names.has("delete_workflow")).toBe(true)
    expect(names.has("update_workflow_json")).toBe(true)
    expect(names.has("export_workflow")).toBe(true)
    expect(names.has("import_workflow")).toBe(true)
    expect(names.has("run_workflow")).toBe(true)
    expect(names.has("list_projects")).toBe(true)
    expect(names.has("get_project")).toBe(true)
    expect(names.has("list_components")).toBe(true)
    expect(names.has("run_component")).toBe(true)
    expect(names.has("list_apps")).toBe(true)
    expect(names.has("run_app")).toBe(true)
    expect(names.has("list_models")).toBe(true)
    // credits:read + cloud-only (test setup pins EDITION=cloud)
    expect(names.has("check_balance")).toBe(true)
    expect(names.has("credit_transactions")).toBe(true)

    // Video Director tools:
    //   start_video_director — always-on (pure content delivery, no scope gate)
    //   create_explainer / create_launch_video — hasCredits() + workflows:execute
    //   Test env is EDITION=cloud so hasCredits()=true; all scopes granted so
    //   workflows:execute passes.
    expect(names.has("start_video_director")).toBe(true)
    expect(names.has("create_explainer")).toBe(true)
    expect(names.has("create_launch_video")).toBe(true)

    // 4 gallery tools
    expect(names.has("browse_gallery")).toBe(true)
    expect(names.has("list_favorites")).toBe(true)
    expect(names.has("favorite_asset")).toBe(true)
    expect(names.has("get_asset")).toBe(true)
    expect(names.has("display_asset")).toBe(true)

    // character discovery tools (assets:read)
    expect(names.has("list_characters")).toBe(true)
    expect(names.has("get_character")).toBe(true)

    // swap_face is intentionally absent — no /v1/swap-face route exists.
    expect(names.has("swap_face")).toBe(false)

    // 9 upload tools — three paths × three media kinds:
    //   upload_*_widget   — in-chat file picker (Apps clients), multi-file
    //                       via max_files; auto-announces URLs on success
    //   request_*_upload  — Nodaro upload page in user's own browser;
    //                       universal handoff for Apps clients without
    //                       widget rendering
    //   prepare_*_upload  — presigned PUT for non-Apps CLI clients with
    //                       unrestricted bash (Cursor / Cline / Desktop / Code)
    //
    // The chunked (`upload_*_init / _chunk / _complete`) and inline
    // base64 (`upload_*`) tools were dropped — the widget supersedes
    // them for every meaningful use case.
    expect(names.has("upload_image_widget")).toBe(true)
    expect(names.has("upload_audio_widget")).toBe(true)
    expect(names.has("upload_video_widget")).toBe(true)
    expect(names.has("request_image_upload")).toBe(true)
    expect(names.has("request_audio_upload")).toBe(true)
    expect(names.has("request_video_upload")).toBe(true)
    expect(names.has("prepare_image_upload")).toBe(true)
    expect(names.has("prepare_audio_upload")).toBe(true)
    expect(names.has("prepare_video_upload")).toBe(true)
    // Dropped tools — chunked + inline base64 paths
    expect(names.has("upload_image_init")).toBe(false)
    expect(names.has("upload_image_chunk")).toBe(false)
    expect(names.has("upload_image_complete")).toBe(false)
    expect(names.has("upload_audio_init")).toBe(false)
    expect(names.has("upload_video_init")).toBe(false)
    expect(names.has("upload_image")).toBe(false)
    expect(names.has("upload_audio")).toBe(false)
    expect(names.has("upload_video")).toBe(false)

    // Sanity: ping + verbs + jobs + workflows + projects + gallery + 9 upload
    // tools + app tools (list_apps, get_app_inputs, run_app, delete_app_run) +
    // shot-sequence tools (forced_alignment, resolve_shot_sequence, render_shot_sequence) +
    // shot-shape catalog tools (list_shot_shapes, get_shot_shape — ungated) +
    // list_brand_presets (ungated brand-token preset catalog) +
    // video-director tools (start_video_director, create_explainer, create_launch_video) +
    // get_recipe (ungated content-delivery recipe catalog).
    // Upper bound has headroom for future tool additions; bump when adding
    // a new tool family rather than tracking every single tool.
    expect(tools.length).toBeGreaterThanOrEqual(30)
    expect(tools.length).toBeLessThanOrEqual(145)
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
    // start_video_director is always-on (pure content delivery, no scope gate)
    expect(names).toContain("start_video_director")

    // Must NOT include any execute-gated tool
    expect(names).not.toContain("generate_image")
    expect(names).not.toContain("run_workflow")
    expect(names).not.toContain("run_component")
    expect(names).not.toContain("run_app")
    // create_explainer / create_launch_video require workflows:execute
    expect(names).not.toContain("create_explainer")
    expect(names).not.toContain("create_launch_video")
    // Must NOT include workflows:read tools
    expect(names).not.toContain("list_workflows")
    expect(names).not.toContain("list_components")
    // Must NOT include assets:read tools
    expect(names).not.toContain("browse_gallery")
    expect(names).not.toContain("favorite_asset")
    expect(names).not.toContain("list_characters")
    expect(names).not.toContain("get_character")
    // Must NOT include credits:read tools
    expect(names).not.toContain("check_balance")
    expect(names).not.toContain("credit_transactions")
    // Must NOT include apps:read tools
    expect(names).not.toContain("list_apps")
  })

  it("with no scopes, registers only the unscoped tools (ping, list_models, start_film_director, start_workflow_editor, get_node_skill, get_picker_catalog, start_video_director, list_shot_shapes, get_shot_shape, list_brand_presets, get_recipe)", async () => {
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
    // start_film_director is intentionally ungated — pure content delivery
    // (returns the canonical SKILL.md). Universal visibility is the whole
    // point, since skill discovery is per-client and unreliable.
    expect(names).toContain("start_film_director")
    // start_workflow_editor + get_node_skill are also ungated content delivery
    // tools (return backend/skills/*.md) — same posture as start_film_director.
    expect(names).toContain("start_workflow_editor")
    expect(names).toContain("get_node_skill")
    // get_picker_catalog is also ungated content delivery (returns parameter-
    // picker value catalogs) — same posture as get_node_skill.
    expect(names).toContain("get_picker_catalog")
    // start_video_director is unconditionally registered on all editions —
    // pure content delivery, no scope gate, same posture as start_film_director.
    expect(names).toContain("start_video_director")
    // list_shot_shapes + get_shot_shape: ungated catalog discovery for the
    // shot-sequence blueprint catalog — same posture as list_models / get_node_skill.
    expect(names).toContain("list_shot_shapes")
    expect(names).toContain("get_shot_shape")
    // list_brand_presets: ungated catalog discovery for the brand-token
    // preset library — same posture as list_shot_shapes / list_models.
    expect(names).toContain("list_brand_presets")
    // get_recipe: ungated content-delivery recipe catalog — same posture as
    // start_video_director / get_node_skill.
    expect(names).toContain("get_recipe")
    expect(names).not.toContain("list_jobs")
    expect(names).not.toContain("generate_image")
    expect(names).not.toContain("check_balance")
    // create_explainer / create_launch_video require workflows:execute
    expect(names).not.toContain("create_explainer")
    expect(names).not.toContain("create_launch_video")
    expect(tools).toHaveLength(11)
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
