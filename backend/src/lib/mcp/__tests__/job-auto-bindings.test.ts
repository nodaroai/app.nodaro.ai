import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { type Scope } from "../../scopes.js"

vi.mock("../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { buildMcpServer } = await import("../server.js")
// Shared tools/list shim — same private-API reflection every MCP tool test
// uses; keeping one copy means an SDK-internals change is fixed in one place.
const { listTools } = await import("../tools/__tests__/_helpers.js")

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

const JOB_AUTO_URI = "ui://nodaro/widget/v4/job-auto"

/** Every previously widget-less job verb that must now bind the job-auto card. */
const JOB_AUTO_VERBS = [
  "generate_character_motion",
  "generate_location_motion",
  "generate_object_motion",
  "generate_creature_motion",
  "render_shot_sequence",
  "forced_alignment",
  "run_component",
  "image_to_text",
  "generate_script",
  "transcribe",
  "suno_lyrics",
  "suno_style_boost",
  "video_analysis",
]
// create_explainer / create_launch_video are hasCredits()-gated (verbs.ts) —
// asserted separately below only when the tools are present in the catalog.
const CREDIT_GATED_VERBS = ["create_explainer", "create_launch_video"]

describe("job-auto widget bindings", () => {
  it("every widget-less job verb declares _meta ui/resourceUri = job-auto", async () => {
    const fastify = Fastify()
    const server = await buildMcpServer({
      userId: "u1",
      scopes: ALL_GRANTED,
      clientName: "Claude",
      fastify,
    })
    const tools = await listTools(server)
    const byName = new Map(tools.map((t) => [t.name, t]))

    for (const name of JOB_AUTO_VERBS) {
      const tool = byName.get(name)
      expect(tool, `tool ${name} missing from catalog`).toBeTruthy()
      expect(tool!._meta?.["ui/resourceUri"], `${name} missing job-auto _meta`).toBe(JOB_AUTO_URI)
    }
    for (const name of CREDIT_GATED_VERBS) {
      const tool = byName.get(name)
      if (tool) {
        expect(tool._meta?.["ui/resourceUri"], `${name} missing job-auto _meta`).toBe(JOB_AUTO_URI)
      }
    }
    // voice_clone stays deliberately widget-less (returns a voice_id, not media).
    expect(byName.get("voice_clone")?._meta?.["ui/resourceUri"]).toBeUndefined()
  })
})

describe("get_asset outputData contract", () => {
  it("get_asset always exposes raw output_data as structuredContent.outputData", () => {
    // The job-auto widget renders text/component outputs from outputData
    // (rules 2-3 of its decision tree). A cleanup that removes the field
    // would blank every text and component card while all widget-side tests
    // stay green — pin the server side here.
    const src = readFileSync(resolve(__dirname, "../tools/gallery.ts"), "utf8")
    expect(src).toContain("outputData: out")
    expect(src).toContain("CONTRACTUAL dependency")
  })
})
