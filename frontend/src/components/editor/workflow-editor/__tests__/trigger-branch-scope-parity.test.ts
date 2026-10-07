/**
 * The editor's copy of the trigger-branch walk (`triggerBranch`, behind the
 * armed-trigger warning) against the server's (`triggerRunScope`), on ONE
 * fixture both suites read (decided 2026-10-05). The warning promises what the
 * server will refuse, so the two walks must agree case for case; the server
 * side runs the same cases in
 * backend/src/services/workflow-engine/__tests__/trigger-branch-scope-parity.test.ts.
 * The walk stays here rather than moving into the Apache shared package.
 */
import { describe, it, expect } from "vitest"
import fixture from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/trigger-branch-scope.json"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { triggerBranch } from "../preview-gate"

type Case = {
  name: string
  triggerNodeId: string
  nodes: unknown[]
  edges: unknown[]
  expected: string[] | null
}

describe("triggerBranch on the shared trigger-branch fixture", () => {
  it("the fixture is not empty", () => {
    expect((fixture.cases as Case[]).length).toBeGreaterThanOrEqual(8)
  })

  it.each((fixture.cases as Case[]).map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const scope = triggerBranch(c.triggerNodeId, c.nodes as WorkflowNode[], c.edges as WorkflowEdge[])
    expect(scope === null ? null : [...scope].sort()).toEqual(c.expected)
  })
})
