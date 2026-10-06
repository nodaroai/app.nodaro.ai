import { describe, expect, it } from "vitest"
import { LEGACY_EXPOSED_FIELD_KEYS } from "../exposed-field-keys.js"
import { UGC_NODE_RUN_STATE_KEYS, UGC_NODE_TYPES, UGC_OVERRIDABLE_FIELDS, findUgcLockedFields, stripUgcRunState } from "../ugc-run-state.js"

describe("UGC run state", () => {
  it("covers exactly the five UGC types", () => {
    const five = ["ugc-cards", "ugc-clip", "ugc-clips", "ugc-creator", "ugc-script"]
    expect([...UGC_NODE_TYPES].sort()).toEqual(five)
    expect(Object.keys(UGC_NODE_RUN_STATE_KEYS).sort()).toEqual(five)
    expect(Object.keys(UGC_OVERRIDABLE_FIELDS).sort()).toEqual(five)
  })

  it("never lists a run-state key as overridable", () => {
    for (const [type, fields] of Object.entries(UGC_OVERRIDABLE_FIELDS)) {
      for (const field of fields) expect(UGC_NODE_RUN_STATE_KEYS[type]).not.toContain(field)
    }
  })

  it("no UGC type has a legacy exposed-field rename (the lock reads the stored key)", () => {
    for (const type of UGC_NODE_TYPES) expect(Object.hasOwn(LEGACY_EXPOSED_FIELD_KEYS, type)).toBe(false)
  })

  it("strips every run-state key and turns keepResult off, leaving choices and other nodes alone", () => {
    const nodes = [
      { id: "c", type: "ugc-creator", data: { source: "photo", gender: "man", keepResult: true, result: { v: 1 } } },
      { id: "s", type: "ugc-script", data: { targetDurationSec: 20, keepResult: true, result: { v: 1 } } },
      { id: "l", type: "ugc-clips", data: { voiceId: "v", quote: { lines: [] }, result: {}, __listResults: ["{}"], ugcOutputs: { "plan-out": "{}" } } },
      { id: "k", type: "ugc-clip", data: { rerender: { "2": 1 }, warnings: ["x"], __listResults: ["u"], __listResultMeta: [], clipWarnings: [], durationSec: 9 } },
      { id: "d", type: "ugc-cards", data: { result: { report: "No issues." } } },
      { id: "t", type: "text-prompt", data: { text: "keep", result: "keep" } },
    ]
    const out = stripUgcRunState(nodes)
    expect(out.map((n) => n.data)).toEqual([
      { source: "photo", gender: "man", keepResult: false },
      { targetDurationSec: 20, keepResult: false },
      { voiceId: "v" },
      {},
      {},
      { text: "keep", result: "keep" },
    ])
    expect(nodes[0]!.data.keepResult).toBe(true) // input untouched
    expect(out[5]).toBe(nodes[5]) // other nodes are returned as they are
  })

  it("leaves a UGC node with no data object alone", () => {
    const node = { id: "x", type: "ugc-clip" }
    expect(stripUgcRunState([node])).toEqual([node])
  })

  it("refuses every UGC key outside the allow-list", () => {
    const nodes = [{ id: "creator", type: "ugc-creator" }, { id: "script", type: "ugc-script" }, { id: "clip", type: "ugc-clip" }]
    expect(findUgcLockedFields(nodes, { creator: { source: "photo", gender: "woman", photoUrl: "https://cdn.example/p.png" }, script: { targetDurationSec: 20 } })).toEqual([])
    expect(findUgcLockedFields(nodes, { creator: { keepResult: true, result: {} }, script: { keepResult: true }, clip: { rerender: {} } })).toEqual([
      { nodeId: "creator", nodeType: "ugc-creator", field: "keepResult" },
      { nodeId: "creator", nodeType: "ugc-creator", field: "result" },
      { nodeId: "script", nodeType: "ugc-script", field: "keepResult" },
      { nodeId: "clip", nodeType: "ugc-clip", field: "rerender" },
    ])
    // A future field is refused without anyone listing it.
    expect(findUgcLockedFields(nodes, { script: { language: "he" } })).toEqual([{ nodeId: "script", nodeType: "ugc-script", field: "language" }])
  })

  it("ignores non-UGC nodes and missing inputs", () => {
    expect(findUgcLockedFields([{ id: "t", type: "text-prompt" }], { t: { text: "x" } })).toEqual([])
    expect(findUgcLockedFields(null, { t: { text: "x" } })).toEqual([])
    expect(findUgcLockedFields([{ id: "c", type: "ugc-creator" }], undefined)).toEqual([])
  })
})
