// @test-units-by-name routes wires into the use-case types its shared fixture names
// @test-watches tools/units/__fixtures__/use-case-input-routing.json
/**
 * How the wires into a use-case node land, on the server's engine — its real
 * input resolver over tools/units/__fixtures__/use-case-input-routing.json.
 * The editor's half, held to the same values, is
 * frontend/src/__tests__/use-case-input-routing.test.ts.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import type { SimpleEdge, SimpleNode } from "../types.js"

interface RoutingCase {
  readonly name: string
  readonly type: string
  readonly sources: ReadonlyArray<{ readonly id: string; readonly type: string; readonly data: Record<string, unknown> }>
  readonly wires: ReadonlyArray<{ readonly source: string; readonly sourceHandle: string | null; readonly targetHandle: string }>
  readonly expected: Record<string, unknown>
  readonly absent: readonly string[]
}

const FIXTURE = path.resolve(__dirname, "../../../../../tools/units/__fixtures__/use-case-input-routing.json")
const CASES = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: RoutingCase[] }).cases
const USE_CASE_KEYS = ["useCaseMedia", "useCaseMusic", "useCaseIntroCard", "useCaseMasterAudio"] as const

describe("a use-case node's inputs — the server's engine", () => {
  it("reads cases", () => expect(CASES.length).toBeGreaterThan(0))
  for (const c of CASES) {
    it(c.name, () => {
      const target: SimpleNode = { id: "u1", type: c.type, data: { label: c.type } }
      const nodes: SimpleNode[] = [...c.sources.map((s) => ({ id: s.id, type: s.type, data: { label: s.id, ...s.data } })), target]
      const edges: SimpleEdge[] = c.wires.map((w, i) => ({ id: `e${i}`, source: w.source, target: "u1", sourceHandle: w.sourceHandle, targetHandle: w.targetHandle }))
      const r = resolveNodeInputs(target, edges, {}, nodes) as unknown as Record<string, unknown>
      expect(Object.fromEntries(USE_CASE_KEYS.flatMap((k) => (r[k] === undefined ? [] : [[k, r[k]]])))).toEqual(c.expected)
      for (const k of c.absent) expect(r[k], k).toBeUndefined()
    })
  }
})
