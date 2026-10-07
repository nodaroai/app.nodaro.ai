/**
 * The trigger-branch walk, server side (`triggerRunScope`), on the fixture the
 * editor's copy (`triggerBranch` in preview-gate.ts) is tested against too
 * (decided 2026-10-05). The armed-trigger warning promises what the server
 * will refuse; the two walks may only differ if this file and the editor's
 * parity test disagree with the same expected answers.
 */
import { describe, it, expect } from "vitest"
import fixture from "./fixtures/trigger-branch-scope.json"
import { triggerRunScope } from "../execution-graph.js"

type Case = {
  name: string
  triggerType: string
  triggerNodeId: string
  nodes: Array<{ id: string; type: string; data?: Record<string, unknown>; parentId?: string }>
  edges: Array<{ id: string; source: string; target: string }>
  expected: string[] | null
}

describe("triggerRunScope on the shared trigger-branch fixture", () => {
  it("the fixture is not empty", () => {
    expect((fixture.cases as Case[]).length).toBeGreaterThanOrEqual(8)
  })

  it.each((fixture.cases as Case[]).map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const scope = triggerRunScope(c.nodes, c.edges, { triggerType: c.triggerType, triggerNodeId: c.triggerNodeId })
    expect(scope === null ? null : [...scope].sort()).toEqual(c.expected)
  })
})
