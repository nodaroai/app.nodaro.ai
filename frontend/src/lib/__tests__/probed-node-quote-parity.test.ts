// @test-watches packages/shared/src/__tests__/fixtures/probed-node-quote-parity.json
// @test-units-by-name prices the node types its fixture names (ai-avatar, cinematic-avatar, switchx)
/**
 * The editor's half of the probed-node quote parity: its quote (the node's
 * pill, its Run button, the confirm and the workflow badge — `getModelIdentifier`)
 * names the id the server's run estimate names for each fixture node. The
 * server's half reads the same fixture and prices that id.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowNode } from "@/types/nodes"

interface ParityCase { readonly name: string; readonly node: { readonly type: string; readonly data: Record<string, unknown> }; readonly expected: string }

const F = JSON.parse(readFileSync(join(__dirname, "../../../../packages/shared/src/__tests__/fixtures/probed-node-quote-parity.json"), "utf8")) as { cases: ParityCase[] }

describe("the editor's quote of the probed nodes equals the server's run estimate", () => {
  it.each(F.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const node = { id: "c", type: c.node.type, position: { x: 0, y: 0 }, data: { label: "c", ...c.node.data } } as unknown as WorkflowNode
    expect(getModelIdentifier(node, [], [node])).toBe(c.expected)
    expect(getModelIdentifier(node, [], [node], new Set(["c"]))).toBe(c.expected)
  })
})
