// @test-watches packages/shared/src/__tests__/fixtures/probed-node-quote-parity.json
// @test-units-by-name prices the node types its fixture names (ai-avatar, cinematic-avatar, switchx)
/**
 * The server's half of the probed-node quote parity: its run estimate names
 * the id the editor quotes for each fixture node (`getNodeModelIdentifier`),
 * and its line is that id's price — above 0, where the bare node type, priced
 * nowhere, used to make it 0 (the credit check before a run and an app's
 * listing read the same estimate). The editor's half reads the same fixture.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { CreditsService, getNodeModelIdentifier, STATIC_CREDIT_COSTS } from "../credits.js"

interface ParityCase { readonly name: string; readonly node: { readonly type: string; readonly data: Record<string, unknown> }; readonly expected: string }

const F = JSON.parse(readFileSync(join(__dirname, "../../../../../packages/shared/src/__tests__/fixtures/probed-node-quote-parity.json"), "utf8")) as { cases: ParityCase[] }

const STATIC_PRICES = { base: (id: string) => STATIC_CREDIT_COSTS[id], charge: (_id: string, base: number) => base }

describe("the server's run estimate names the probed nodes' quoted id, and prices it", () => {
  it("covers Cinematic Avatar, SwitchX and AI Avatar", () => {
    expect(new Set(F.cases.map((c) => c.node.type))).toEqual(new Set(["cinematic-avatar", "switchx", "ai-avatar"]))
  })

  it.each(F.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const node = { id: "c", type: c.node.type, data: c.node.data }
    expect(getNodeModelIdentifier(node)).toBe(c.expected)
    let line: number | undefined
    CreditsService.estimateWorkflowCreditsAt(STATIC_PRICES as never, [node], [], undefined, (id, credits) => {
      if (id === "c") line = credits
    })
    expect(STATIC_CREDIT_COSTS[c.expected]).toBeGreaterThan(0)
    expect(line).toBe(STATIC_CREDIT_COSTS[c.expected])
  })
})
