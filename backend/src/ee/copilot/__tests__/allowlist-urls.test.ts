/**
 * No allowlisted tool may put a media address into the model's context.
 *
 * The copilot's whole destination boundary is that the model never authors a
 * URL. That is cheap to hold while it has never SEEN one — and PR 1 hands it
 * the gallery and the uploads, which are where R2
 * addresses live. The MCP tools happen to keep their URLs in
 * `structuredContent`, which `dispatchTool` drops, so the text the model reads
 * is id-first today. That is an ACCIDENT of how those tools were written, not
 * a decision anyone recorded — one edit to `formatRow` would undo it silently.
 *
 * So this pins it through the REAL path: a fixture row with sentinel URLs, a
 * real MCP server, the copilot's own dispatcher, and an assertion that not one
 * of those URLs came out the other side.
 *
 * It deliberately does NOT assert "the text matches no https://" — a user's
 * own prompt can legitimately contain a link, and that test would go red on
 * real data, get relaxed, and stop protecting anything.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import Fastify from "fastify"

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

const { createMcpInvoker } = await import("../../../lib/mcp/invoke.js")
const { newSession } = await import("../../../lib/mcp/session.js")
const { buildServer } = await import("../../../lib/mcp/tools/__tests__/_helpers.js")
const { registerGallery } = await import("../../../lib/mcp/tools/gallery.js")
const { dispatchTool } = await import("../tools/registry.js")
const { MCP_TOOL_ALLOWLIST } = await import("../constants.js")
const { supabase } = await import("../../../lib/supabase.js")

import type { Scope } from "../../../lib/scopes.js"

/** Every URL in the fixture. None of these may reach the model. */
const SECRETS = {
  output: "https://r2.test/SECRET-OUTPUT.png",
  thumb: "https://r2.test/SECRET-THUMB.png",
  reference: "https://r2.test/SECRET-REFERENCE.png",
  upload: "https://r2.test/SECRET-UPLOAD.png",
}

const GALLERY_ROW = {
  id: "job-1",
  job_type: "generate-image",
  // A prompt is user-authored and may legitimately contain a link — the point
  // of asserting on SENTINELS rather than on "no https://".
  input_data: { prompt: "a knight, ref https://example.com/moodboard", imageUrl: SECRETS.reference },
  output_data: { imageUrl: SECRETS.output, thumbnailUrl: SECRETS.thumb },
  completed_at: "2026-08-24T12:00:00Z",
  created_at: "2026-08-24T12:00:00Z",
  provider: "nano-banana",
  status: "completed",
}

const UPLOAD_ROW = {
  id: "asset-1",
  type: "image",
  filename: "passport-scan.png",
  r2_url: SECRETS.upload,
  metadata: { thumbnail_url: SECRETS.thumb },
  created_at: "2026-08-24T12:00:00Z",
}

function chainReturning(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "neq", "in", "is", "not", "or", "ilike", "order", "limit", "lt", "gt"]) {
    chain[m] = vi.fn(() => chain)
  }
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve)
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null })
  chain.single = vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null })
  return chain
}

function copilotDeps(invoker: ReturnType<typeof createMcpInvoker>) {
  return {
    ctx: {
      userId: "u1",
      workflowId: "wf1",
      projectId: "p1",
      threadId: "t1",
      turnId: "turn1",
  allowPublishing: false,
  userLinks: new Set<string>(),
      fastify: {} as never,
      emit: vi.fn(),
    },
    invoker,
    addedNodeTypes: new Set<string>(), wiredAssets: [], created: { count: 0 },
  }
}

function galleryInvoker() {
  const server = buildServer()
  registerGallery({
    server,
    session: newSession({ userId: "u1", scopes: ["assets:read"] as Scope[], clientName: "Copilot" }),
    fastify: Fastify(),
  })
  return createMcpInvoker(server)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("allowlisted media tools never hand the model a URL", () => {
  it("browse_gallery: no output, thumbnail or reference address survives dispatch", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chainReturning([GALLERY_ROW]))

    const outcome = await dispatchTool(copilotDeps(galleryInvoker()), "browse_gallery", { limit: 5 })

    expect(outcome.text).toContain("job-1") // the id IS what the model gets
    for (const [label, url] of Object.entries(SECRETS)) {
      expect(outcome.text, `${label} leaked into the model's context`).not.toContain(url)
    }
  })

  it("browse_uploads: the filename comes through, the R2 address does not", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chainReturning([UPLOAD_ROW]))

    const outcome = await dispatchTool(copilotDeps(galleryInvoker()), "browse_uploads", { limit: 5 })

    expect(outcome.text).toContain("asset-1")
    expect(outcome.text).not.toContain(SECRETS.upload)
    expect(outcome.text).not.toContain(SECRETS.thumb)
  })

  it("keeps list_favorites OFF the allowlist — its text is bare ids", async () => {
    // It returns job ids and nothing else; the hydrated rows go into
    // structuredContent, which dispatch drops. The model would need one
    // get_job per id to learn what any of them is, so it paid prefix bytes on
    // every turn for a capability it could not use.
    expect(MCP_TOOL_ALLOWLIST.has("list_favorites")).toBe(false)
  })

  it("keeps the two tools whose TEXT embeds output URLs off the allowlist", async () => {
    // `get_asset` and `display_asset` dump the job row, URLs and all. They are
    // the reason this is an allowlist and not a scope: both register under
    // `assets:read`, which the copilot session already carries.
    expect(MCP_TOOL_ALLOWLIST.has("get_asset")).toBe(false)
    expect(MCP_TOOL_ALLOWLIST.has("display_asset")).toBe(false)
  })

  it("forces every media-bearing tool to be classified, so the next one cannot slip in", async () => {
    // The invariant, rather than a list someone must remember to update: any
    // tool added to the allowlist must be either covered by a case above or
    // written down here as carrying no media. A new gallery-shaped tool fails
    // this until its author makes a decision.
    const COVERED_ABOVE = new Set(["browse_gallery", "browse_uploads"])
    const CARRIES_NO_MEDIA = new Set([
      "diagnose_run",
      "get_job",
      "get_node_skill",
      "get_picker_catalog",
      "list_models",
      "list_node_presets",
      "get_node_preset",
      "get_recipe",
      "list_brand_presets",
      "check_balance",
      "list_voices",
      "list_workflows",
      "list_components",
      "get_component_inputs",
      // Entity reads DO return the entity's own image url, deliberately: the
      // user picked that character, and it is how the model recognises it.
      // They are not a route to anyone else's media — `entityOwnerFilter`.
      "list_characters",
      "get_character",
      "list_locations",
      "get_location",
      "list_objects",
      "get_object",
      "list_creatures",
      "get_creature",
    ])

    const unclassified = [...MCP_TOOL_ALLOWLIST].filter(
      (name) => !COVERED_ABOVE.has(name) && !CARRIES_NO_MEDIA.has(name),
    )
    expect(unclassified, "new allowlisted tools must be classified for media leakage").toEqual([])
  })
})
