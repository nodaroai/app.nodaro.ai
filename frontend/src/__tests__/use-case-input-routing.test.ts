// @test-units-by-name routes wires into the use-case types its shared fixture names
// @test-watches tools/units/__fixtures__/use-case-input-routing.json
/**
 * How the wires into a use-case node land, on the canvas's engine — its real
 * input resolver over tools/units/__fixtures__/use-case-input-routing.json.
 * The server's half, held to the same values, is
 * backend/src/services/workflow-engine/__tests__/use-case-input-routing.test.ts.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { resolveNodeInputs } from "@/components/editor/workflow-editor/node-input-resolver"

interface RoutingCase {
  readonly name: string
  readonly type: string
  readonly sources: ReadonlyArray<{ readonly id: string; readonly type: string; readonly data: Record<string, unknown> }>
  readonly wires: ReadonlyArray<{ readonly source: string; readonly sourceHandle: string | null; readonly targetHandle: string }>
  readonly expected: Record<string, unknown>
  readonly absent: readonly string[]
}

const FIXTURE = path.resolve(__dirname, "../../../tools/units/__fixtures__/use-case-input-routing.json")
const CASES = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: RoutingCase[] }).cases
const USE_CASE_KEYS = ["useCaseMedia", "useCaseMusic", "useCaseIntroCard", "useCaseMasterAudio"] as const

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode

describe("a use-case node's inputs — the canvas's engine", () => {
  it("reads cases", () => expect(CASES.length).toBeGreaterThan(0))
  for (const c of CASES) {
    it(c.name, () => {
      const target = node("u1", c.type)
      const nodes = [...c.sources.map((s) => node(s.id, s.type, s.data)), target]
      const edges = c.wires.map((w, i) => ({ id: `e${i}`, source: w.source, target: "u1", sourceHandle: w.sourceHandle, targetHandle: w.targetHandle })) as unknown as WorkflowEdge[]
      const r = resolveNodeInputs(target, nodes, edges) as unknown as Record<string, unknown>
      expect(Object.fromEntries(USE_CASE_KEYS.flatMap((k) => (r[k] === undefined ? [] : [[k, r[k]]])))).toEqual(c.expected)
      for (const k of c.absent) expect(r[k], k).toBeUndefined()
    })
  }
})
