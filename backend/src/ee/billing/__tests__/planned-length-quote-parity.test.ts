// @test-watches packages/shared/src/__tests__/fixtures/planned-length-quote-parity.json
// @test-units-by-name prices the node types its fixture names (mask-composite, video-overlay, upload-video, upload-audio, generate-video, generate-video-pro, image-to-video, extend-video, trim-video, loop-video, combine-videos, resize-video, lip-sync, motion-transfer, pro-3d-render, video-to-video, face-swap, manual-edit, text, duration, provider)
/**
 * When what reaches a Mask Composite or a Video Overlay is made by another node
 * — a generation, an Extend Video, a step that re-runs — the server's workflow
 * estimate quotes the step at the units the editor quotes: both read the one
 * measured walk (`measuredWireLengthSec`, @nodaro/render-rules). Read on the
 * step's own line of the estimate (its `onNode` tally at the static base rows),
 * so the upstream nodes' own prices never enter it. A whole run is the
 * estimate with no run set (frozen nodes left out); the step alone is a run of
 * only `c`. The editor half is
 * the editor's lib tests (planned-length-quote-parity.test.ts), over the
 * same fixture.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { CreditsService, STATIC_CREDIT_COSTS, type ChargedPriceTable } from "../credits.js"

type Step = "maskComposite" | "videoOverlay"
type Units = Readonly<Record<Step, number>>

interface ParityCase {
  readonly name: string
  readonly nodes: ReadonlyArray<{ id: string; type: string; data: Record<string, unknown> }>
  readonly edges: ReadonlyArray<{ source: string; target?: string; targetHandle: string }>
  readonly expectedUnits: { readonly whole: Units; readonly alone: Units }
  /** A partial run: exactly these nodes run (`runNodeIds`). */
  readonly partial?: { readonly runSet: readonly string[]; readonly expectedUnits: Units }
}

const F = JSON.parse(
  readFileSync(join(__dirname, "../../../../../packages/shared/src/__tests__/fixtures/planned-length-quote-parity.json"), "utf8"),
) as { cases: ParityCase[] }

const STEP: Readonly<Record<Step, { type: string; data: Record<string, unknown>; row: string }>> = {
  maskComposite: { type: "mask-composite", data: {}, row: "mask-composite" },
  videoOverlay: { type: "video-overlay", data: { layers: [{ videoUrl: "https://cdn.example/layer.mp4", start: 0 }] }, row: "video-overlay:video" },
}

/** `STATIC_CREDIT_COSTS` as a price table: the base rows, unmarked. */
const STATIC_ROWS: ChargedPriceTable = { base: (id) => STATIC_CREDIT_COSTS[id], charge: (_id, base) => base }

/** The step's own line of the workflow estimate, for a whole run (`runNodeIds` absent), a run of `c` alone, or the case's partial run. */
function stepLine(c: ParityCase, step: Step, run: "whole" | "alone" | "partial"): number | undefined {
  const nodes = [...c.nodes, { id: "c", type: STEP[step].type, data: STEP[step].data }]
  const edges = c.edges.map((e) => ({ source: e.source, target: e.target ?? "c", targetHandle: e.targetHandle }))
  let line: number | undefined
  const runNodeIds = run === "alone" ? new Set(["c"]) : run === "partial" ? new Set(c.partial!.runSet) : undefined
  CreditsService.estimateWorkflowCreditsAt(STATIC_ROWS, nodes, edges, runNodeIds ? { runNodeIds } : undefined, (id, credits) => {
    if (id === "c") line = (line ?? 0) + credits
  })
  return line
}

const rows = F.cases.flatMap((c) => (["maskComposite", "videoOverlay"] as const).map((step) => [`${c.name} — ${step}`, c, step] as const))

describe("the server's workflow estimate of a Mask Composite and a Video Overlay equals the editor's quote on a video another node makes", () => {
  it("the one-unit rows the units are priced at", () => {
    expect(STATIC_CREDIT_COSTS["mask-composite"]).toBeGreaterThan(0)
    expect(STATIC_CREDIT_COSTS["video-overlay:video"]).toBeGreaterThan(0)
  })

  it.each(rows)("%s — a whole run", (_name, c, step) => {
    expect(stepLine(c, step, "whole")).toBe(c.expectedUnits.whole[step] * STATIC_CREDIT_COSTS[STEP[step].row]!)
  })

  it.each(rows)("%s — a run of the step alone", (_name, c, step) => {
    expect(stepLine(c, step, "alone")).toBe(c.expectedUnits.alone[step] * STATIC_CREDIT_COSTS[STEP[step].row]!)
  })

  it.each(rows.filter(([, c]) => c.partial))("%s — a partial run", (_name, c, step) => {
    expect(stepLine(c, step, "partial")).toBe(c.partial!.expectedUnits[step] * STATIC_CREDIT_COSTS[STEP[step].row]!)
  })
})
