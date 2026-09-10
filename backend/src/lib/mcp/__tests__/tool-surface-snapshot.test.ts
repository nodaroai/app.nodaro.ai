import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { type Scope } from "../../scopes.js"

// Audit 2026-09-06 fix #3 (D-8, C-13(4), A-4 / D-4).
//
// MEMBERSHIP: `server-full.test.ts` bounded the catalog to `30..165` tools
// and pinned the unscoped count at 13 — a dropped tool family, or a gated
// family re-registered outside its edition gate, passed CI. This test
// asserts the EXACT name set per (edition × scope grant) from a checked-in
// fixture. Adding a tool is a one-line fixture change made on purpose; the
// studio program's +17 lands the same way.
//
// BUDGET: `tools/list` was 315 KB for 167 tools (+67 % since June) —
// ~80 k tokens of definitions per session on every host, cached for days by
// Claude.ai. A description carries WHEN to use a tool, its preconditions,
// what comes back and its cost class; model tables, caps and prompting
// doctrine live behind `get_node_skill` / `get_recipe` / `list_models`.
// The budget is the tripwire on that rule.
vi.mock("../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
let credits = true
vi.mock("../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => credits }
})
const { buildMcpServer } = await import("../server.js")

const ALL_GRANTED: Scope[] = [
  "workflows:read", "workflows:write", "workflows:execute", "jobs:read",
  "assets:read", "assets:write", "credits:read", "apps:read",
]
const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = JSON.parse(readFileSync(resolve(here, "fixtures/tool-surface.json"), "utf8")) as Record<string, string[]>

/** Per-tool and total wire budget for the cloud edition under ALL_GRANTED. */
// 2026-09-06 baseline after the six trims: max tool 8.1 KB, total 303 KB. The
// headroom is deliberately small — a family that grows the list must raise this
// on purpose, not slide under it.
//
// RAISED 2026-09-08 by the studio production family's wire size and nothing
// else: 310_000 + 23_730 = 333_730, where 23_730 B is the sum of the seventeen
// tool definitions as `tools/list` serves them (largest: generate_studio_clip
// at 1_978 B, well under the per-tool budget). The 85 B of headroom the list
// had before the family landed is therefore exactly the headroom it has after.
// 23_578 of those bytes are the tools as first written; the remaining 152 are
// the sentence the read tool's description gained, saying that reading also
// lands finished work — the same raise-by-exactly-the-cost rule, applied to a
// sentence.
// The planned-keyframe tool adds 2,042 B to tools/list (measured by this suite).
// Advanced scene controls and immutable input selection add exactly 1_866 B:
// generate_3d_scene 2_391 -> 3_754 (+1_363), edit_3d_scene 3_146 -> 3_649 (+503).
// Combined tools/list total is 337_553; preserve the same 85 B headroom.
//
// RAISED 2026-09-08 by the image_overlay tool's wire size and nothing else —
// see IMAGE_OVERLAY_TOOL_BYTES below; the 85 B of headroom is carried across.
const IMAGE_OVERLAY_TOOL_BYTES = 7_788 // measured: 345_426 total − 337_638 base (layer kinds, eleven shapes, platform variants + pricing note, qr_text + mask controls)
//
// RAISED 2026-09-09 by the two arguments the in-app studio assistant needs and
// nothing else: the preview flag on `edit_studio_production` and the landing
// flag on `get_studio_production`. MEASURED by this suite — 345_785 total
// − 345_426 base = 359 B, the two `describe` strings plus their schema
// entries. Neither tool moves near the per-tool budget (the largest definition
// in the list is `animate_image` at 8_122 B, and neither of these is in the top
// five). The fixture does NOT move: it names tools, and no tool was added.
const STUDIO_PREVIEW_ARGS_BYTES = 359
//
// RAISED 2026-09-09 by `suggest_overlay_placement` and nothing else — the
// vision-model half of the overlay node, which had a route but no tool. MEASURED
// by this suite: 347_305 total − 345_785 = 1_520 B, well under the per-tool
// budget (the definition is one paragraph plus five arguments; the placement
// vocabulary it answers in is already documented on `image_overlay`).
const SUGGEST_PLACEMENT_TOOL_BYTES = 1_520
//
// RAISED 2026-09-09 by the LANDING CONTRACT and nothing else. A studio
// generation lands into the document on the next `get_studio_production` (D5,
// reconcile-on-read) and nowhere else, and the six tools that leave a marker
// each said that badly: three ("describe", "still", "score") said the media
// "lands by itself", which reads as "no further step"; "keyframe" said nothing
// about landing at all; "clip" and "revoice" named the read but not that the
// job tools are not it. A user polling `wait_for_job` to `completed` therefore
// saw an empty film. All six now name the read and say that `get_job` /
// `wait_for_job` land nothing, and the read itself says out loud that it is
// also the write. MEASURED by this suite: 347_887 total − 347_305 = 582 B for
// seven descriptions. No tool was added, so the fixture does not move, and
// none of the seven is near the per-tool budget (the largest in the list is
// `animate_image` at 8_122 B).
const LANDING_CONTRACT_BYTES = 582
//
// RAISED 2026-09-10 by the four GPT Image 2.5 models (Flare + Sunburst, each
// t2i and i2i) and nothing else — they widen the model enums and capability
// text that `generate_image` / `modify_image` already carry; no tool was added,
// so the fixture does NOT move. MEASURED by this suite, on top of the
// landing-contract raise above: 348_038 total − 347_887 = 151 B. Neither tool moves near the per-tool budget (`generate_image`
// is 8_095 B against the 8_192 B cap — the tightest in the list, and the reason
// the 2.5 descriptions are kept to one clause each rather than a paragraph).
const GPT_IMAGE_2_5_MODELS_BYTES = 151
export const TOOL_WIRE_BUDGET = {
  perToolBytes: 8_192,
  totalBytes:
    337_638 +
    IMAGE_OVERLAY_TOOL_BYTES +
    STUDIO_PREVIEW_ARGS_BYTES +
    SUGGEST_PLACEMENT_TOOL_BYTES +
    LANDING_CONTRACT_BYTES +
    GPT_IMAGE_2_5_MODELS_BYTES,
}

type ToolDef = { name: string; description?: string }
async function list(scopes: Scope[]): Promise<ToolDef[]> {
  const server = await buildMcpServer({ userId: "u1", scopes, clientName: "Claude", fastify: Fastify() })
  const inner = (server as unknown as {
    server: { _requestHandlers: Map<string, (r: unknown, e: unknown) => Promise<{ tools: ToolDef[] }>> }
  }).server
  const res = await inner._requestHandlers.get("tools/list")!({ method: "tools/list", params: {} }, {})
  return res.tools
}

describe("tool surface — exact membership per edition × scope grant", () => {
  it.each([
    ["cloud", "all", true, ALL_GRANTED],
    ["cloud", "jobs", true, ["jobs:read"] as Scope[]],
    ["cloud", "none", true, [] as Scope[]],
    ["community", "all", false, ALL_GRANTED],
    ["community", "none", false, [] as Scope[]],
  ])("%s edition, %s scopes: the fixture names, nothing more, nothing less", async (edition, grant, hasCredits, scopes) => {
    credits = hasCredits
    const names = (await list(scopes)).map((t) => t.name).sort()
    expect(names).toEqual(FIXTURE[`${edition}/${grant}`])
  })
})

describe("tool surface — wire budget (cloud, all scopes)", () => {
  it("keeps every tool definition and the whole list under budget", async () => {
    credits = true
    const tools = await list(ALL_GRANTED)
    const sizes = tools.map((t) => ({ name: t.name, bytes: JSON.stringify(t).length })).sort((a, b) => b.bytes - a.bytes)
    const over = sizes.filter((s) => s.bytes > TOOL_WIRE_BUDGET.perToolBytes)
    expect(over, `over the ${TOOL_WIRE_BUDGET.perToolBytes} B per-tool budget`).toEqual([])
    const total = sizes.reduce((sum, s) => sum + s.bytes, 0)
    expect(total, `top: ${JSON.stringify(sizes.slice(0, 5))}`).toBeLessThanOrEqual(TOOL_WIRE_BUDGET.totalBytes)
  })
})
