// @test-units-by-name prices the node types it names (mask-composite, trim-video, loop-video, combine-videos, generate-video, text-prompt, duration)
/**
 * A published app's input mapped onto a generation's duration or model, read
 * by the listing of a Mask Composite, a Trim, a Loop or a Combine Videos after
 * it (decided 2026-11-12):
 * - an input the app's user types with no domain the range can enumerate (free
 *   text, a number with no bounds) is listed as open — the most the run can
 *   render, as a value only the run knows — never at the creator's sample;
 * - an input with an enumerable domain (a select, a toggle, a bounded number)
 *   keeps the saved value in the "from" figure and is enumerated by the "up to".
 * The step's part is read as the listing with the step less the listing
 * without it, at the static base rows.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  hasCredits: () => false,
}))

import { VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC, longestModelClipSec } from "@nodaro/render-rules"
import { maskCompositeUnits } from "@nodaro/shared/media"
import { STATIC_CREDIT_COSTS, estimateWorkflowListingRange, type EstimateNode } from "../credits.js"
import { listingOpenValueNodeIds } from "../listing-range.js"
import { videoUtilityUnits } from "../../../lib/video-utility-credits.js"

type E = { source: string; target: string; targetHandle: string }
const settings = (items: unknown[]) => ({ presentationSettings: { inputItems: items } })
const nodeItem = (nodeId: string) => ({ type: "node", id: `${nodeId}-node`, nodeId })
const fieldItem = (nodeId: string, field: string, allowedValues?: unknown[]) => ({ type: "field", id: `${nodeId}-${field}`, nodeId, field, ...(allowedValues ? { allowedValues } : {}) })

const composite: EstimateNode = { id: "c", type: "mask-composite", data: {} }
const ROW = STATIC_CREDIT_COSTS["mask-composite"]!

/** The composite's units in the listing's "from" and "up to" figures. */
async function compositeUnits(nodes: EstimateNode[], edges: E[], items: unknown[]): Promise<{ from: number; upTo: number }> {
  const opts = { publishType: "app" as const, replaceableMediaNodeIds: new Set<string>(), snapshotSettings: settings(items) }
  const withStep = await estimateWorkflowListingRange([...nodes, composite], [...edges, { source: "g", target: "c", targetHandle: "video" }], opts)
  const without = await estimateWorkflowListingRange(nodes, edges, opts)
  return { from: (withStep.floor.preview - without.floor.preview) / ROW, upTo: (withStep.ceiling.preview - without.ceiling.preview) / ROW }
}

describe("an app input mapped onto a generation's duration, in the listing of a Mask Composite after it", () => {
  const text: EstimateNode = { id: "x", type: "text-prompt", data: { text: "5" } }
  const mapped: EstimateNode = { id: "g", type: "generate-video", data: { provider: "kling-4", duration: 5, fieldMappings: { duration: { sourceNodeId: "x" } } } }
  const open = maskCompositeUnits(longestModelClipSec("kling-4")! + 0.1)

  it("a free-text input is open: the model's longest clip, never the creator's sample", async () => {
    expect(listingOpenValueNodeIds(settings([nodeItem("x")]), [text, mapped])).toEqual(new Set(["x"]))
    expect(await compositeUnits([text, mapped], [], [nodeItem("x")])).toEqual({ from: open, upTo: open })
  })

  it("not exposed (the app shows another input): the Text node's value is the run's own, read as set", async () => {
    const other: EstimateNode = { id: "o", type: "text-prompt", data: { text: "a caption" } }
    expect(listingOpenValueNodeIds(settings([nodeItem("o")]), [text, other, mapped])).toEqual(new Set(["o"]))
    expect(await compositeUnits([text, other, mapped], [], [nodeItem("o")])).toEqual({ from: 2, upTo: 2 })
  })

  it("an app with no input items shows its Text nodes as inputs: open too", async () => {
    expect(listingOpenValueNodeIds(settings([]), [text, mapped]).has("x")).toBe(true)
  })

  it("a number input with no bounds (a Duration node exposed whole) is open too", async () => {
    const duration: EstimateNode = { id: "d", type: "duration", data: { seconds: 5 } }
    const wired: EstimateNode = { id: "g", type: "generate-video", data: { provider: "kling-4", duration: 5 } }
    const edges = [{ source: "d", target: "g", targetHandle: "field-duration" }]
    expect(listingOpenValueNodeIds(settings([nodeItem("d")]), [duration, wired])).toEqual(new Set(["d"]))
    expect((await compositeUnits([duration, wired], edges, [nodeItem("d")])).from).toBe(open)
  })

  it("an input with an enumerable domain is not open: \"from\" its saved value, \"up to\" its priciest choice", async () => {
    const duration: EstimateNode = { id: "d", type: "duration", data: { seconds: 5 } }
    const wired: EstimateNode = { id: "g", type: "generate-video", data: { provider: "kling-4", duration: 5 } }
    const edges = [{ source: "d", target: "g", targetHandle: "field-duration" }]
    const items = [fieldItem("d", "seconds", [5, 15])]
    expect(listingOpenValueNodeIds(settings(items), [duration, wired]).size).toBe(0)
    expect(await compositeUnits([duration, wired], edges, items)).toEqual({ from: 2, upTo: 4 })
  })
})

describe("the same input, in the listing of a Trim, a Loop or a Combine Videos after the generation", () => {
  const text: EstimateNode = { id: "x", type: "text-prompt", data: { text: "5" } }
  const mapped: EstimateNode = { id: "g", type: "generate-video", data: { provider: "kling-4", duration: 5, fieldMappings: { duration: { sourceNodeId: "x" } } } }
  const STEPS: ReadonlyArray<EstimateNode & { id: string; type: string }> = [
    { id: "s", type: "trim-video", data: { trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0 } },
    { id: "s", type: "loop-video", data: { mode: "repeat", repeatCount: 2 } },
    { id: "s", type: "combine-videos", data: { transition: "cut", trimStartFrames: 0, trimEndFrames: 0 } },
  ]
  /** The step's units at `sec` of input: its own formula, the one its run is charged by. */
  const unitsAt = (step: EstimateNode & { type: string }, sec: number) =>
    videoUtilityUnits(step.type, step.type === "combine-videos" ? { ...step.data, videoUrls: [""], upstreamDurations: [sec] } : { ...step.data, upstreamDuration: sec })!
  async function stepUnits(step: EstimateNode & { id: string; type: string }, items: unknown[]): Promise<{ from: number; upTo: number }> {
    const opts = { publishType: "app" as const, replaceableMediaNodeIds: new Set<string>(), snapshotSettings: settings(items) }
    const withStep = await estimateWorkflowListingRange([text, mapped, step], [{ source: "g", target: "s", targetHandle: "in" }], opts)
    const without = await estimateWorkflowListingRange([text, mapped], [], opts)
    const row = STATIC_CREDIT_COSTS[step.type]!
    return { from: (withStep.floor.preview - without.floor.preview) / row, upTo: (withStep.ceiling.preview - without.ceiling.preview) / row }
  }

  it.each(STEPS.map((s) => [s.type, s] as const))("%s: a free-text input is open — the model's longest clip, never the creator's sample", async (_type, step) => {
    const open = unitsAt(step, longestModelClipSec("kling-4")! + VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC)
    expect(open).toBeGreaterThan(unitsAt(step, 5 + VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC))
    expect(await stepUnits(step, [nodeItem("x")])).toEqual({ from: open, upTo: open })
  })

  it.each(STEPS.map((s) => [s.type, s] as const))("%s: a Text node the app does not expose is read as set", async (_type, step) => {
    const other: EstimateNode = { id: "o", type: "text-prompt", data: { text: "a caption" } }
    const opts = { publishType: "app" as const, replaceableMediaNodeIds: new Set<string>(), snapshotSettings: settings([nodeItem("o")]) }
    const withStep = await estimateWorkflowListingRange([text, other, mapped, step], [{ source: "g", target: "s", targetHandle: "in" }], opts)
    const without = await estimateWorkflowListingRange([text, other, mapped], [], opts)
    expect((withStep.floor.preview - without.floor.preview) / STATIC_CREDIT_COSTS[step.type]!).toBe(unitsAt(step, 5 + VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC))
  })
})
