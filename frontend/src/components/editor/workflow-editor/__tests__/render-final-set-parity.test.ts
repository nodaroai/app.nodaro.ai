/**
 * The editor's half of the Render final run-set parity (decided 2026-10-06):
 * the set the editor's Render final runs and the set the server derives for
 * an agent's Render final (`renderFinal` on POST /v1/workflows/:id/run) are
 * one rule, `@nodaro/render-rules`. Both sides read the same fixture; the
 * server's half is backend/src/routes/__tests__/render-final-run-set-parity.test.ts.
 */
import { describe, it, expect } from "vitest"
import fixture from "../../../../../../backend/src/routes/__tests__/fixtures/render-final-sets.json"
import { renderFinalRunSet, renderRunOverrides } from "../render-final-set"

interface Case {
  readonly nodes: ReadonlyArray<{ id: string; type: string; data: Record<string, unknown> }>
  readonly edges: ReadonlyArray<{ source: string; target: string; targetHandle?: string }>
  readonly runSet: readonly string[]
}

const cases = Object.entries((fixture as { cases: Record<string, Case> }).cases)

describe("Render final run set — the editor reads the shared fixture", () => {
  it.each(cases)("%s", (_name, c) => {
    const set = renderFinalRunSet("render", c.nodes, c.edges)
    expect([...set].sort()).toEqual([...c.runSet].sort())
    // The one-shot override the editor sends is the one the server derives.
    expect(renderRunOverrides("render", "final", set)).toEqual({ render: { quality: "final" } })
  })
})
