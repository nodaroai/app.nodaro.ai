// @test-watches packages/shared/src/__tests__/fixtures/video-utility-quote-parity.json
// @test-units-by-name prices the node types its fixture names (trim-video, loop-video, combine-videos, generate-video, image-to-video, extend-video, upload-video, duration, llm-chat)
/**
 * Trim Video, Loop Video and Combine Videos are charged the length their run
 * measures, so the server's workflow estimate quotes them at the units the
 * editor quotes: both read the one measured walk (`measuredWireLengthSec`,
 * @nodaro/render-rules) with `VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC` on each
 * clip a node makes, and a clip nothing can size at the 8-second fallback.
 * Read on the step's own line of the estimate (its `onNode` tally at the static
 * rows), so the upstream nodes' own prices never enter it. A whole run is the
 * estimate with no run set (frozen nodes left out); the step alone is a run of
 * only `t`. The editor half is
 * the editor's lib tests (video-utility-quote-parity.test.ts), over the same
 * fixture.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC } from "@nodaro/render-rules"
import { CreditsService, STATIC_CREDIT_COSTS, type ChargedPriceTable } from "../credits.js"

type StepKey = "trim" | "loop" | "combine"

interface ParityCase {
  readonly name: string
  readonly step: StepKey
  readonly stepData?: Record<string, unknown>
  readonly nodes: ReadonlyArray<{ id: string; type: string; data: Record<string, unknown> }>
  readonly edges: ReadonlyArray<{ source: string; target: string; targetHandle: string }>
  readonly expectedUnits: { readonly whole: number; readonly alone: number }
  readonly partial?: { readonly runSet: readonly string[]; readonly expectedUnits: number }
}

const F = JSON.parse(
  readFileSync(join(__dirname, "../../../../../packages/shared/src/__tests__/fixtures/video-utility-quote-parity.json"), "utf8"),
) as { steps: Record<StepKey, { type: string; data: Record<string, unknown> }>; cases: ParityCase[] }

/** `STATIC_CREDIT_COSTS` as a price table: the base rows, unmarked. */
const STATIC_ROWS: ChargedPriceTable = { base: (id) => STATIC_CREDIT_COSTS[id], charge: (_id, base) => base }

/** The step's own line of the workflow estimate, in units of its row. */
function stepUnits(c: ParityCase, run: "whole" | "alone" | "partial"): number | undefined {
  const step = F.steps[c.step]
  const nodes = [...c.nodes, { id: "t", type: step.type, data: c.stepData ?? step.data }]
  let line: number | undefined
  const runNodeIds = run === "alone" ? new Set(["t"]) : run === "partial" ? new Set(c.partial!.runSet) : undefined
  CreditsService.estimateWorkflowCreditsAt(STATIC_ROWS, nodes, c.edges, runNodeIds ? { runNodeIds } : undefined, (id, credits) => {
    if (id === "t") line = (line ?? 0) + credits
  })
  return line === undefined ? undefined : line / STATIC_CREDIT_COSTS[step.type]!
}

const rows = F.cases.map((c) => [c.name, c] as const)

describe("the server's workflow estimate of a Trim, Loop or Combine Videos equals the editor's quote, read from the measured walk", () => {
  it("the slack is Mask Composite's (both charge the container), and every step's one-unit row is priced", () => {
    expect(VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC).toBe(0.1)
    for (const step of Object.values(F.steps)) expect(STATIC_CREDIT_COSTS[step.type]).toBeGreaterThan(0)
    expect(new Set(F.cases.map((c) => c.step))).toEqual(new Set(["trim", "loop", "combine"]))
  })

  it.each(rows)("%s — a whole run", (_name, c) => {
    expect(stepUnits(c, "whole")).toBe(c.expectedUnits.whole)
  })

  it.each(rows)("%s — a run of the step alone", (_name, c) => {
    expect(stepUnits(c, "alone")).toBe(c.expectedUnits.alone)
  })

  it.each(rows.filter(([, c]) => c.partial))("%s — a partial run", (_name, c) => {
    expect(stepUnits(c, "partial")).toBe(c.partial!.expectedUnits)
  })
})
