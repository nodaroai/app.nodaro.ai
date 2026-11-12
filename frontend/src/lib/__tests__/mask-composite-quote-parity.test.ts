// @test-watches packages/shared/src/__tests__/fixtures/mask-composite-quote-parity.json
/**
 * For an upload, a clip added from the Library and a Video link, the editor
 * quotes a Mask Composite at the units the server's run estimate quotes: its
 * leading video's length as the graph gives it, and the 300 s cap when the
 * graph gives none. It never falls back to a length the upstream node merely
 * stores (metadata with no result row for the file, an earlier file's length,
 * a Video link's whole length), which the server does not read. A video added
 * from the Library records the row a fresh upload records, so both read its
 * length. Not covered: any other node's output (a generation, an Extend Video,
 * or a step that recorded a length of its own, and a chain built on one), which
 * the editor reads at the length that node records or is set to and the
 * server's estimate does not read. The server
 * half is backend/src/ee/billing/__tests__/mask-composite-quote-parity.test.ts,
 * over the same fixture.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { maskCompositeLeadHandle, maskCompositeUnits } from "@nodaro/shared/media"
import type { LibraryAsset } from "@/lib/api"
import { assetToUploadNode } from "@/lib/asset-to-node"
import { maskCompositePricingUnits, maskCompositeQuotedSec } from "@/lib/video-utility-estimate"
import { upstreamVideoDurationSec } from "@/lib/upstream-video-duration"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

interface ParityCase {
  readonly name: string
  readonly composite: Record<string, unknown>
  readonly nodes: ReadonlyArray<{ id: string; type: string; data: Record<string, unknown> }>
  readonly edges: ReadonlyArray<{ source: string; targetHandle: string }>
  readonly expectedUnits: number
  readonly fallbackDecidedBefore?: number
  /** The Library asset `nodes[0]` was added from: the node is built through `assetToUploadNode`. */
  readonly libraryAsset?: LibraryAsset
}

const F = JSON.parse(
  readFileSync(join(__dirname, "../../../../packages/shared/src/__tests__/fixtures/mask-composite-quote-parity.json"), "utf8"),
) as { cases: ParityCase[] }

/** The case's sources: a Library case's first node built by the real add, held to the fixture the server half reads. */
function sourcesOf(c: ParityCase): ParityCase["nodes"] {
  if (!c.libraryAsset) return c.nodes
  const [first, ...rest] = c.nodes
  const built = assetToUploadNode(c.libraryAsset)!
  expect(built.type).toBe(first!.type)
  const rows = (first!.data.generatedResults as Array<Record<string, unknown>>).map((r) => ({
    ...r,
    jobId: expect.stringMatching(/^upload-\d+$/),
    timestamp: expect.any(String),
  }))
  expect(built.data).toEqual({ ...first!.data, generatedResults: rows })
  return [{ id: first!.id, type: built.type, data: built.data }, ...rest]
}

function graph(c: ParityCase): { composite: WorkflowNode; nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const composite = { id: "c", type: "mask-composite", position: { x: 0, y: 0 }, data: { label: "c", ...c.composite } } as unknown as WorkflowNode
  const nodes = [...sourcesOf(c).map((n) => ({ ...n, position: { x: 0, y: 0 }, data: { label: n.id, ...n.data } })), composite] as unknown as WorkflowNode[]
  const edges = c.edges.map((e, i) => ({ id: `e${i}`, source: e.source, target: "c", targetHandle: e.targetHandle })) as WorkflowEdge[]
  return { composite, nodes, edges }
}

describe("the editor's Mask Composite quote equals the server's run estimate for uploads, Library clips and Video links", () => {
  it.each(F.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const { composite, nodes, edges } = graph(c)
    expect(maskCompositePricingUnits(composite, nodes, edges)).toBe(c.expectedUnits)
    // The node's own pill reads the same length: `null` exactly when the cap is quoted.
    const sec = maskCompositeQuotedSec(composite, nodes, edges)
    expect(maskCompositeUnits(sec)).toBe(c.expectedUnits)
    if (c.expectedUnits === 60) expect(sec).toBeNull()
  })

  it.each(F.cases.filter((c) => c.fallbackDecidedBefore !== undefined).map((c) => [c.name, c] as const))(
    "%s — the stored length the editor used to quote is still there, and is no longer read",
    (_name, c) => {
      const { composite, nodes, edges } = graph(c)
      const stored = upstreamVideoDurationSec("c", maskCompositeLeadHandle(composite.data as Record<string, unknown>), nodes, edges)
      expect(maskCompositeUnits(stored)).toBe(c.fallbackDecidedBefore)
      expect(maskCompositeQuotedSec(composite, nodes, edges)).toBeNull()
    },
  )
})
