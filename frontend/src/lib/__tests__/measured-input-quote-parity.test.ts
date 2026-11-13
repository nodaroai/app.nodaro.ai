// @test-watches packages/shared/src/__tests__/fixtures/measured-input-quote-parity.json
/**
 * When what reaches a Video SFX, a Video Mask, a Video Depth, a Pitch & Tempo,
 * a Dubbing or a Video Upscale (Topaz, Nodaro) is made by another node — a generation,
 * an Extend Video, a step that re-runs — the editor quotes the step at the
 * figure the server's workflow estimate quotes: both read the one measured
 * walk (`measuredWireLengthSec`, @nodaro/render-rules) with the step's slack
 * (`MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC`). A node that runs is read at its
 * planned length plus the slack once on each clip a node makes, a node that
 * does not run at the take it hands on, a frozen node never as running, and
 * anything unknown at the step's cap. The row steps are read through
 * `getModelIdentifier` (the id every estimate prices), Dubbing and Topaz
 * through their pricing units (`getExactPricingUnits`) and their pills' own
 * readers. The server half is
 * backend/src/ee/billing/__tests__/measured-input-quote-parity.test.ts, over
 * the same fixture.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { getExactPricingUnits } from "@/components/editor/workflow-editor/types"
import { wholeRunExecutable } from "@/components/editor/workflow-editor/estimate-run-credits"
import { dubbingQuotedMinutesOf, lipSyncPricingUnits, lipSyncQuoteIsEstimate, nodaroVideoUpscaleRefusedSec, videoUpscalePricingUnits } from "@/lib/video-utility-estimate"
import { LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS } from "@nodaro/shared/credits"
import { NODARO_VIDEO_UPSCALE_RATE_SECONDS, nodaroVideoUpscaleCreditId } from "@nodaro/render-rules"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

type Step = "videoSfx" | "videoMask" | "videoDepth" | "pitchTempo" | "dubbing" | "topaz" | "nodaroUpscale" | "lipSync"
/** A step's figure; `null` (Lip Sync only): a length nothing knows before the run — each estimate's own unknown figure. */
type Figures = Readonly<Partial<Record<Step, number | null>>>

interface ParityCase {
  readonly name: string
  readonly steps?: readonly Step[]
  readonly handles?: Readonly<Partial<Record<Step, string>>>
  readonly nodes: ReadonlyArray<{ id: string; type: string; data: Record<string, unknown> }>
  readonly edges: ReadonlyArray<{ source: string; target?: string; targetHandle: string }>
  readonly expected: { readonly whole: Figures; readonly alone: Figures }
  readonly partial?: { readonly runSet: readonly string[]; readonly expected: Figures }
}

const F = JSON.parse(
  readFileSync(join(__dirname, "../../../../packages/shared/src/__tests__/fixtures/measured-input-quote-parity.json"), "utf8"),
) as { cases: ParityCase[] }

const STEPS: readonly Step[] = ["videoSfx", "videoMask", "videoDepth", "pitchTempo", "dubbing", "topaz", "nodaroUpscale"]

/** The step `c` each case wires into, and the input its `@input` wires land on. */
const STEP: Readonly<Record<Step, { type: string; data: Record<string, unknown>; input: string }>> = {
  videoSfx: { type: "video-sfx", data: {}, input: "video" },
  videoMask: { type: "video-mask", data: {}, input: "video" },
  videoDepth: { type: "video-depth", data: {}, input: "video" },
  pitchTempo: { type: "pitch-tempo", data: {}, input: "in" },
  dubbing: { type: "dubbing", data: { targetLanguage: "es" }, input: "video" },
  topaz: { type: "video-upscale", data: { targetResolution: "1080p" }, input: "video" },
  nodaroUpscale: { type: "video-upscale", data: { provider: "nodaro-video-upscale", targetResolution: "1080p" }, input: "video" },
  // A Lip Sync priced by the seconds of its audio (OmniHuman 2.0): named only by the cases that list it.
  lipSync: { type: "lip-sync", data: { provider: "omnihuman-2-0" }, input: "audio" },
}

function graph(c: ParityCase, step: Step): { node: WorkflowNode; nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const node = { id: "c", type: STEP[step].type, position: { x: 0, y: 0 }, data: { label: "c", ...STEP[step].data } } as unknown as WorkflowNode
  const nodes = [...c.nodes.map((n) => ({ ...n, position: { x: 0, y: 0 }, data: { label: n.id, ...n.data } })), node] as unknown as WorkflowNode[]
  const handle = (h: string) => (h === "@input" ? c.handles?.[step] ?? STEP[step].input : h)
  const edges = c.edges.map((e, i) => ({ id: `e${i}`, source: e.source, target: e.target ?? "c", targetHandle: handle(e.targetHandle) })) as WorkflowEdge[]
  return { node, nodes, edges }
}

/** The N of a `…:<N>s` / `…:<N>m` row id. */
function rowFigure(id: string): number {
  const m = /:(\d+)[sm]$/.exec(id)
  if (!m) throw new Error(`not a sized row: ${id}`)
  return Number(m[1])
}

/** The figure a run set quotes: the row's N for the row steps, the units for Dubbing and Topaz, the billed seconds for Nodaro Video Upscale (0 for a clip it refuses). `undefined` = the pill (no run set). */
function figure(step: Step, node: WorkflowNode, nodes: WorkflowNode[], edges: WorkflowEdge[], rerunIds: ReadonlySet<string> | undefined): number {
  if (step === "dubbing") {
    return rerunIds ? getExactPricingUnits(node, nodes, edges, rerunIds) : dubbingQuotedMinutesOf(node, nodes, edges)
  }
  if (step === "lipSync") {
    expect(getModelIdentifier(node, edges, nodes, rerunIds)).toBe("omnihuman-2-0:per-second")
    return rerunIds ? getExactPricingUnits(node, nodes, edges, rerunIds) : lipSyncPricingUnits(node, nodes, edges)
  }
  if (step === "nodaroUpscale") {
    expect(getModelIdentifier(node, edges, nodes, rerunIds)).toBe(nodaroVideoUpscaleCreditId("1080p"))
    if (nodaroVideoUpscaleRefusedSec(node, nodes, edges, rerunIds ?? new Set()) !== undefined) return 0
    return (rerunIds ? getExactPricingUnits(node, nodes, edges, rerunIds) : videoUpscalePricingUnits(node, nodes, edges)) * NODARO_VIDEO_UPSCALE_RATE_SECONDS
  }
  if (step === "topaz") {
    expect(getModelIdentifier(node, edges, nodes, rerunIds)).toBe("topaz-video:per-unit")
    return rerunIds ? getExactPricingUnits(node, nodes, edges, rerunIds) : videoUpscalePricingUnits(node, nodes, edges)
  }
  return rowFigure(getModelIdentifier(node, edges, nodes, rerunIds))
}

const rows = F.cases.flatMap((c) => (c.steps ?? STEPS).map((step) => [`${c.name} — ${step}`, c, step] as const))

/**
 * The editor's figure for a fixture value. A Lip Sync of unknown length shows
 * an estimate (15 s, its line marked ≈) where the server's run-set check holds
 * the most a run takes: the run measures the audio before it holds.
 */
const want = (v: number | null | undefined): number | undefined => (v === null ? LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS : v)

describe("the editor's quote of the measuring steps equals the server's workflow estimate on what another node makes", () => {
  it("covers the cases the shared rule was written for", () => {
    expect(F.cases.length).toBeGreaterThanOrEqual(16)
    expect(F.cases.some((c) => c.partial)).toBe(true)
    for (const c of F.cases) for (const step of c.steps ?? STEPS) {
      // `null`: a Lip Sync of unknown length (each estimate's own unknown figure), the only step that names one.
      for (const v of [c.expected.whole[step], c.expected.alone[step]]) {
        if (v === null) expect(step, c.name).toBe("lipSync")
        else expect(v, `${c.name} — ${step}`).toBeTypeOf("number")
      }
    }
  })

  it.each(rows)("%s — a whole run", (_name, c, step) => {
    const { node, nodes, edges } = graph(c, step)
    const whole = new Set(wholeRunExecutable(nodes).map((n) => n.id))
    expect(whole.has("c")).toBe(true)
    expect(figure(step, node, nodes, edges, whole)).toBe(want(c.expected.whole[step]))
    if (c.expected.whole[step] === null) expect(lipSyncQuoteIsEstimate(node, nodes, edges, whole)).toBe(true)
  })

  it.each(rows)("%s — the step alone: its Run and its pill", (_name, c, step) => {
    const { node, nodes, edges } = graph(c, step)
    expect(figure(step, node, nodes, edges, new Set(["c"]))).toBe(want(c.expected.alone[step]))
    expect(figure(step, node, nodes, edges, undefined)).toBe(want(c.expected.alone[step]))
  })

  it.each(rows.filter(([, c]) => c.partial))("%s — a partial run", (_name, c, step) => {
    const { node, nodes, edges } = graph(c, step)
    expect(figure(step, node, nodes, edges, new Set(c.partial!.runSet))).toBe(want(c.partial!.expected[step]))
  })
})
