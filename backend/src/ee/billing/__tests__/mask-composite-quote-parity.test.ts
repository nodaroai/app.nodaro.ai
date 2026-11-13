// @test-watches packages/shared/src/__tests__/fixtures/mask-composite-quote-parity.json
// @test-units-by-name prices the node types its fixture names (upload-video, youtube-video, mask-composite)
/**
 * For an upload, a clip added from the Library and a Video link, the server's
 * run estimate quotes a Mask Composite at the units the editor quotes: its
 * leading video's length as the graph gives it, and the 300 s cap when the
 * graph gives none — never a length the upstream node merely stores. A
 * Library case's node is exactly what the editor's Library add writes (the
 * editor half builds it and holds it to the fixture). A video another node
 * makes (a generation, an Extend Video, a step that re-runs, and a chain built
 * on one) is held to the same parity, for Mask Composite and Video Overlay
 * both, by planned-length-quote-parity.test.ts. The editor half is
 * frontend/src/lib/__tests__/mask-composite-quote-parity.test.ts, over the
 * same fixture.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { CreditsService, STATIC_CREDIT_COSTS } from "../credits.js"

interface ParityCase {
  readonly name: string
  readonly composite: Record<string, unknown>
  readonly nodes: ReadonlyArray<{ id: string; type: string; data: Record<string, unknown> }>
  readonly edges: ReadonlyArray<{ source: string; targetHandle: string }>
  readonly expectedUnits: number
}

const F = JSON.parse(
  readFileSync(join(__dirname, "../../../../../packages/shared/src/__tests__/fixtures/mask-composite-quote-parity.json"), "utf8"),
) as { cases: ParityCase[] }

/** The composite's part of the run estimate: the graph with it, less the graph without it (base credits). */
function compositeEstimate(c: ParityCase): number {
  const composite = { id: "c", type: "mask-composite", data: c.composite }
  const edges = c.edges.map((e) => ({ source: e.source, target: "c", targetHandle: e.targetHandle }))
  return (
    CreditsService.estimateWorkflowBaseCredits([...c.nodes, composite], edges) -
    CreditsService.estimateWorkflowBaseCredits([...c.nodes], [])
  )
}

describe("the server's run estimate of a Mask Composite equals the editor's quote for uploads, Library clips and Video links", () => {
  it.each(F.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(compositeEstimate(c)).toBe(c.expectedUnits * STATIC_CREDIT_COSTS["mask-composite"]!)
  })
})
