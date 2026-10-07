import { describe, expect, it } from "vitest"
import { LockedOverrideError, describeLockedOverrides, findLockedOverrides } from "../input-override-lock.js"
import { applyInputOverridesToNodes } from "../../workers/apply-input-overrides.js"

const graph = () => [
  { id: "creator", type: "ugc-creator", data: { source: "sampled", gender: "woman", keepResult: false } },
  { id: "script", type: "ugc-script", data: { targetDurationSec: 15, keepResult: false } },
]

describe("the run-override lock covers UGC run state (spec §6.6)", () => {
  it("refuses an injected result or keepResult, with the UGC sentence", () => {
    const locked = findLockedOverrides(graph(), { creator: { keepResult: true, result: { v: 1, kind: "photo", identityImages: ["https://cdn.example/x.png"] } } })
    expect(locked.map((l) => l.field)).toEqual(["keepResult", "result"])
    expect(locked.every((l) => l.kind === "ugc")).toBe(true)
    expect(describeLockedOverrides(locked)).toContain('inputOverrides cannot set "keepResult" on a UGC node "creator".')
  })

  it("the merge throws and leaves the graph untouched", () => {
    const nodes = graph()
    expect(() => applyInputOverridesToNodes(nodes as never, { script: { keepResult: true } })).toThrow(LockedOverrideError)
    expect(nodes[1]!.data.keepResult).toBe(false)
  })

  it("keeps photoUrl, source, gender and targetDurationSec overridable", () => {
    expect(findLockedOverrides(graph(), { creator: { source: "photo", gender: "man", photoUrl: "https://cdn.example/p.png" }, script: { targetDurationSec: 20 } })).toEqual([])
  })

  it("an outbound refusal and a UGC refusal in one request read as two sentences", () => {
    const nodes = [...graph(), { id: "hook", type: "webhook-output", data: {} }]
    const locked = findLockedOverrides(nodes, { hook: { url: "https://attacker.example/x" }, creator: { result: {} } })
    expect(locked.map((l) => l.kind)).toEqual(["outbound", "ugc"])
    const message = describeLockedOverrides(locked)
    expect(message).toContain('Refused: "url" on webhook-output node "hook"')
    expect(message).toContain('inputOverrides cannot set "result" on a UGC node "creator".')
  })

  it("an outbound-only refusal keeps its sentence, and the overflow count rides on it", () => {
    const outbound = Array.from({ length: 12 }, (_, i) => ({ nodeId: `h${i}`, nodeType: "webhook-output", field: "url", kind: "outbound" as const }))
    const message = describeLockedOverrides(outbound)
    expect(message).toMatch(/Refused: .*, and 2 more$/)
    expect(message).not.toContain("UGC")
  })

  it("counts overflow once the message holds a UGC sentence", () => {
    const ugc = Array.from({ length: 12 }, (_, i) => ({ nodeId: `c${i}`, nodeType: "ugc-creator", field: "result", kind: "ugc" as const }))
    const message = describeLockedOverrides(ugc)
    expect(message.endsWith("2 more refused.")).toBe(true)
  })
})
