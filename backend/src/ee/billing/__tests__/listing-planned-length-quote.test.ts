// @test-units-by-name prices the node types it names (mask-composite, video-overlay, upload-video, generate-video, extend-video, loop-video)
/**
 * A published app's listing prices Mask Composite and Video Overlay through the
 * same measured walk as the workflow estimate and the editor
 * (`measuredWireLengthSec`): a video another node makes in the app's run at the
 * length that node will produce, plus the step's slack once on each clip a
 * node makes on the way; unknown at the cap. A recording the app's user replaces has
 * no length to the listing (its sample's is removed), so a step built on one
 * stays at the cap. Read on the step's own line of the listing, at the static
 * base rows.
 */
import { describe, expect, it } from "vitest"
import { CreditsService, STATIC_CREDIT_COSTS, type ChargedPriceTable } from "../credits.js"

type Step = "maskComposite" | "videoOverlay"
type N = { id: string; type: string; data: Record<string, unknown> }
type E = { source: string; target: string; targetHandle: string }

const STEP: Readonly<Record<Step, { type: string; data: Record<string, unknown>; row: string; cap: number }>> = {
  maskComposite: { type: "mask-composite", data: {}, row: "mask-composite", cap: 60 },
  videoOverlay: { type: "video-overlay", data: { layers: [{ videoUrl: "https://cdn.example/layer.mp4", start: 0 }] }, row: "video-overlay:video", cap: 12 },
}
const STATIC_ROWS: ChargedPriceTable = { base: (id) => STATIC_CREDIT_COSTS[id], charge: (_id, base) => base }

const upload = (id: string, sec: number): N => ({ id, type: "upload-video", data: { url: `https://cdn.example/${id}.mp4`, generatedResults: [{ url: `https://cdn.example/${id}.mp4`, duration: sec }], activeResultIndex: 0 } })
const gen5: N = { id: "g", type: "generate-video", data: { provider: "kling-4", duration: 5 } }
const into = (source: string): E => ({ source, target: "c", targetHandle: "video" })

/** The step's own units in an app listing of `nodes` + the step `c`, with `replaced` the uploads the app's user replaces. */
function listedUnits(step: Step, nodes: N[], edges: E[], replaced: string[] = []): number {
  const all = [...nodes, { id: "c", type: STEP[step].type, data: STEP[step].data }]
  let fixed = 0
  CreditsService.estimateWorkflowListingAt(STATIC_ROWS, all, edges, "app", { replaceableMediaNodeIds: new Set(replaced) }, (id, part, credits) => {
    if (id === "c" && part === "preview") fixed += credits
  })
  return fixed / STATIC_CREDIT_COSTS[STEP[step].row]!
}

describe("the app listing quotes Mask Composite and Video Overlay at the planned length", () => {
  it("a generation set to 5 s: its planned length plus the slack", () => {
    expect(listedUnits("maskComposite", [gen5], [into("g")])).toBe(2)
    expect(listedUnits("videoOverlay", [gen5], [into("g")])).toBe(1)
  })

  it("a 5 s generation looped twice: the slack carried by each copy", () => {
    const loop: N = { id: "l", type: "loop-video", data: { mode: "repeat", repeatCount: 2 } }
    const edges = [{ source: "g", target: "l", targetHandle: "video" }, into("l")]
    expect(listedUnits("maskComposite", [gen5, loop], edges)).toBe(3)
    expect(listedUnits("videoOverlay", [gen5, loop], edges)).toBe(3)
  })

  it("a known 10 s upload extended by 5 s on Seedance 2.5: source plus the added clip", () => {
    const x: N = { id: "x", type: "extend-video", data: { provider: "seedance-2-5-extend", duration: 5 } }
    const edges = [{ source: "u", target: "x", targetHandle: "video" }, into("x")]
    expect(listedUnits("maskComposite", [upload("u", 10), x], edges)).toBe(4)
    expect(listedUnits("videoOverlay", [upload("u", 10), x], edges)).toBe(3)
  })

  it("the same extension of an upload the app's user replaces: the cap — the sample's length is not the user's", () => {
    const x: N = { id: "x", type: "extend-video", data: { provider: "seedance-2-5-extend", duration: 5 } }
    const edges = [{ source: "u", target: "x", targetHandle: "video" }, into("x")]
    expect(listedUnits("maskComposite", [upload("u", 10), x], edges, ["u"])).toBe(STEP.maskComposite.cap)
    expect(listedUnits("videoOverlay", [upload("u", 10), x], edges, ["u"])).toBe(STEP.videoOverlay.cap)
  })

  it("a VEO extension: a length the catalog does not declare — the cap", () => {
    const x: N = { id: "x", type: "extend-video", data: { duration: 5 } }
    const edges = [{ source: "u", target: "x", targetHandle: "video" }, into("x")]
    expect(listedUnits("maskComposite", [upload("u", 10), x], edges)).toBe(STEP.maskComposite.cap)
    expect(listedUnits("videoOverlay", [upload("u", 10), x], edges)).toBe(STEP.videoOverlay.cap)
  })
})
