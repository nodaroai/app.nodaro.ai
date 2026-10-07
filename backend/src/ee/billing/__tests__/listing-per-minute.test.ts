/**
 * A listing whose price follows the recording's length lists it per minute
 * (decided 2026-10-07): fixed parts plus a part per minute of the episode,
 * never the 180-minute maximum and never a guessed typical length. And a
 * listing counts a clips plan's fan-out (each clip's render and captions) by
 * the clip count, exactly as the editor's estimate does.
 *
 * At STATIC_CREDIT_COSTS' base prices: Apply EDL 10 / output minute at Final,
 * 1 at Preview; Edit Plan standard 4 / source minute, plus a flat 20 for clips
 * and trailer.
 */
import { describe, it, expect } from "vitest"
import { CreditsService, STATIC_CREDIT_COSTS } from "../credits.js"
import { APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE, APPLY_EDL_PROXY_CREDITS_PER_OUTPUT_MINUTE } from "../../../lib/apply-edl-plan.js"
import { EDIT_PLAN_LEGACY_DURATION_KEYS, mediaLengthSecOf, withoutMediaLength } from "@nodaro/render-rules"
import { exposedMediaNodeIds } from "../../../lib/exposed-text-caps.js"

type N = { id: string; type: string; data?: Record<string, unknown> }
type E = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: Record<string, unknown> }

const STT = STATIC_CREDIT_COSTS["elevenlabs-stt"]!
const PLAN_RATE = 4
const PLAN_FLAT = 20

function chain(plan: Record<string, unknown>, render: Record<string, unknown> = { quality: "final" }, recording: Record<string, unknown> = {}) {
  const nodes: N[] = [
    { id: "rec", type: "upload-video", data: recording },
    { id: "stt", type: "transcribe", data: { provider: "elevenlabs-stt" } },
    { id: "plan", type: "edit-plan", data: { planTier: "standard", ...plan } },
    { id: "render", type: "apply-edl", data: render },
  ]
  const edges: E[] = [
    { source: "rec", target: "stt", sourceHandle: "video", targetHandle: "audio" },
    { source: "rec", target: "plan", sourceHandle: "video", targetHandle: "sources" },
    { source: "stt", target: "plan", sourceHandle: "json", targetHandle: "transcript" },
    { source: "plan", target: "render", sourceHandle: "edl", targetHandle: "edl" },
  ]
  return { nodes, edges }
}

const listing = (
  g: { nodes: N[]; edges: E[] },
  type: "app" | "component" | "template" = "template",
  replaceableMediaNodeIds?: ReadonlySet<string>,
) => CreditsService.estimateWorkflowBaseListing(g.nodes, g.edges, type, { replaceableMediaNodeIds })

describe("a tighten of an episode of unknown length lists per minute", () => {
  it("the plan's rate and the render's rate are per minute; the transcript is fixed", () => {
    expect(listing(chain({ mode: "tighten" }))).toEqual({
      preview: STT,
      final: 0,
      previewPerMinute: PLAN_RATE + APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE,
      finalPerMinute: 0,
    })
  })

  it("at the 180-minute cap it is the figure the listing quoted before", () => {
    const l = listing(chain({ mode: "tighten" }))
    const ceiling = PLAN_RATE * 180 + STT + APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE * 180
    expect(l.preview + 180 * l.previewPerMinute).toBe(ceiling)
  })

  // Decided 2026-10-07: a known length prices the plan at that length — its
  // step on a plugin that reserves steps, its started minutes on one that
  // charges per started minute — the id the run reserves for it.
  it("a creator's recording an app user cannot replace is fixed: the render at its length, the plan at its step", () => {
    const l = listing(chain({ mode: "tighten" }, { quality: "final" }, { durationSeconds: 10 * 60 }), "app", new Set())
    expect(l.previewPerMinute).toBe(0)
    expect(l.preview).toBe(STT + PLAN_RATE * 15 + APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE * 10)
  })

  it("…and at its started minutes when the plugin charges per started minute", () => {
    const g = chain({ mode: "tighten" }, { quality: "final" }, { durationSeconds: 10 * 60 })
    const l = CreditsService.estimateWorkflowBaseListing(g.nodes, g.edges, "app", { replaceableMediaNodeIds: new Set(), editPlanPerMinute: true })
    expect(l.previewPerMinute).toBe(0)
    expect(l.preview).toBe(STT + PLAN_RATE * 10 + APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE * 10)
  })
})

// Review F2: the creator's sample recording is not the app user's. A source
// the app user (an exposed upload input) or the template's cloner (every
// upload node) replaces has an unknown length when the listing is priced, so
// its length-dependent parts list per minute, whatever sample length it saved.
describe("a sample recording that is replaced is not the user's length", () => {
  const sampled = (keys: Record<string, unknown>) => chain({ mode: "tighten" }, { quality: "final" }, keys)
  const perMinute = { preview: STT, final: 0, previewPerMinute: PLAN_RATE + APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE, finalPerMinute: 0 }

  it.each([
    ["a design-time length", { durationSeconds: 10 * 60 }],
    ["a measured length", { url: "https://cdn/ep.mp4", metadata: { durationSeconds: 10 * 60, mediaUrl: "https://cdn/ep.mp4" } }],
    ["a result's length", { generatedResults: [{ url: "https://cdn/ep.mp4", duration: 10 * 60 }] }],
  ])("a template's upload node with %s lists per minute", (_label, keys) => {
    expect(listing(sampled(keys))).toEqual(perMinute)
  })

  it("an app's exposed recording input lists per minute", () => {
    expect(listing(sampled({ durationSeconds: 10 * 60 }), "app", new Set(["rec"]))).toEqual(perMinute)
  })

  it("an app listed without its exposed inputs treats every upload as replaced (never under-quote)", () => {
    expect(listing(sampled({ durationSeconds: 10 * 60 }), "app")).toEqual(perMinute)
  })

  it("an app's exposed inputs are its media inputs: the classifier the runner uses", () => {
    const g = sampled({ durationSeconds: 10 * 60 })
    const settings = { presentationSettings: { inputItems: [{ type: "node", nodeId: "rec" }] } }
    expect([...exposedMediaNodeIds(settings, g.nodes)]).toEqual(["rec"])
    expect([...exposedMediaNodeIds({ presentationSettings: { inputItems: [] } }, g.nodes)]).toEqual(["rec"])
    expect([...exposedMediaNodeIds(null, g.nodes)]).toEqual(["rec"])
  })
})

describe("withoutMediaLength", () => {
  // Every field mediaLengthSecOf reads: removing them must leave the length
  // unknown, so a new length field cannot be added to the reader alone.
  const full: Record<string, unknown> = {
    url: "https://cdn/ep.mp4",
    duration: 600,
    generatedResults: [{ url: "https://cdn/ep.mp4", duration: 600 }, { url: "https://cdn/b.mp4", duration: 30 }],
    activeResultIndex: 1,
    metadata: { durationSeconds: 600, mediaUrl: "https://cdn/ep.mp4", width: 1920 },
    ...Object.fromEntries(EDIT_PLAN_LEGACY_DURATION_KEYS.map((k) => [k, 600])),
  }

  it("leaves no length the reader finds, and every other field", () => {
    expect(mediaLengthSecOf(full)).toBeGreaterThan(0)
    const stripped = withoutMediaLength(full)
    expect(mediaLengthSecOf(stripped)).toBeUndefined()
    expect(stripped.url).toBe("https://cdn/ep.mp4")
    expect((stripped.metadata as Record<string, unknown>).width).toBe(1920)
    expect((stripped.generatedResults as { url: string }[]).map((r) => r.url)).toEqual(["https://cdn/ep.mp4", "https://cdn/b.mp4"])
  })

  it.each([...EDIT_PLAN_LEGACY_DURATION_KEYS, "duration"])("a length in %s alone is removed", (key) => {
    expect(mediaLengthSecOf(withoutMediaLength({ [key]: 600 }))).toBeUndefined()
  })

  it("never mutates its input", () => {
    const copy = JSON.parse(JSON.stringify(full))
    withoutMediaLength(full)
    expect(full).toEqual(copy)
  })
})

describe("a trailer's plan is per minute, its render is not", () => {
  it("the plan's flat and the 2-minute render are fixed; the plan's rate is per minute", () => {
    expect(listing(chain({ mode: "trailer" }))).toEqual({
      preview: STT + PLAN_FLAT + APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE * 2,
      final: 0,
      previewPerMinute: PLAN_RATE,
      finalPerMinute: 0,
    })
  })
})

describe("a listing with no length-dependent part is exactly what it was", () => {
  it("no per-minute part, and the run estimate's whole-graph figure", () => {
    const nodes: N[] = [
      { id: "img", type: "generate-image", data: { provider: "gpt-image-2" } },
      { id: "cap", type: "add-captions", data: {} },
    ]
    const edges: E[] = [{ source: "img", target: "cap", targetHandle: "in" }]
    const l = listing({ nodes, edges })
    expect(l.previewPerMinute).toBe(0)
    expect(l.finalPerMinute).toBe(0)
    expect(l.preview).toBe(CreditsService.estimateWorkflowBaseCredits(nodes, edges, { scope: "whole-graph" }))
  })
})

describe("the clip count fans out the render and the captions after it", () => {
  function clipPack(count: number | undefined) {
    const g = chain({ mode: "clips", count, targetDurationSec: 60 })
    g.nodes.push({ id: "cap", type: "add-captions", data: {} })
    g.edges.push({ source: "render", target: "cap", sourceHandle: "media", targetHandle: "in", data: { outputMode: "each" } })
    return g
  }
  // One caption run, as the run estimate prices it in this graph.
  const captions = CreditsService.estimateWorkflowBaseCredits(clipPack(5).nodes, clipPack(5).edges, { runNodeIds: new Set(["cap"]) })

  it("5 clips: 5 renders of 2 minutes and 5 captions", () => {
    expect(listing(clipPack(5))).toEqual({
      preview: STT + PLAN_FLAT + 5 * APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE * 2 + 5 * captions,
      final: 0,
      previewPerMinute: PLAN_RATE,
      finalPerMinute: 0,
    })
  })

  it("no count set: the plan's default clip count (8)", () => {
    expect(listing(clipPack(undefined)).preview).toBe(STT + PLAN_FLAT + 8 * APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE * 2 + 8 * captions)
  })
})

// Review F1: an app run's Render final renders the plan the app user's
// Preview run just made, never the creator's saved one. So the final part
// re-plans too, and its render is per minute of the user's episode.
describe("a Preview render's Render final is per minute of the user's episode, whatever the creator saved", () => {
  const seg = (inMs: number, outMs: number) => ({ id: `s${inMs}`, inMs, outMs, video: "v" })
  const saved = { version: 1, clock: "master", sources: [{ id: "v", url: "https://cdn/v.mp4", kind: "video" }], segments: [seg(0, 150_000)] }

  it.each([
    ["no saved plan", {}],
    ["a 3-minute saved plan", { generatedJson: saved }],
  ])("%s", (_label, planData) => {
    expect(listing(chain({ mode: "tighten", ...planData }, { quality: "proxy" }), "app")).toEqual({
      preview: STT,
      final: 0,
      previewPerMinute: PLAN_RATE + APPLY_EDL_PROXY_CREDITS_PER_OUTPUT_MINUTE,
      finalPerMinute: APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE,
    })
  })

  it("a frozen plan does not re-run: its saved plan is exact", () => {
    const l = listing(chain({ mode: "tighten", generatedJson: saved, skipped: true }, { quality: "proxy" }), "app")
    expect(l.finalPerMinute).toBe(0)
    expect(l.final).toBe(APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE * 3)
  })

  it("a component has no final part", () => {
    const l = listing(chain({ mode: "tighten" }, { quality: "proxy" }), "component")
    expect(l.final).toBe(0)
    expect(l.finalPerMinute).toBe(0)
  })
})
