import { describe, expect, it } from "vitest"
import { LEGACY_EXPOSED_FIELD_KEYS } from "../exposed-field-keys.js"
import {
  UGC_CREATOR_CANDIDATES_KEY, UGC_NODE_RUN_STATE_KEYS, UGC_NODE_TYPES, UGC_OVERRIDABLE_FIELDS, UGC_PICK_FIRST_MESSAGE, findUgcLockedFields, stripUgcRunState, ugcPickPending,
  ugcRunWaitsForPick,
} from "../ugc-run-state.js"

describe("UGC run state", () => {
  it("covers exactly the six UGC types", () => {
    const five = ["ugc-cards", "ugc-clip", "ugc-clips", "ugc-creator", "ugc-finish-clips", "ugc-script"]
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
      { id: "c", type: "ugc-creator", data: { source: "photo", gender: "man", photoUrl: "https://cdn.example/me.png", keepResult: true, result: { v: 1 } } },
      { id: "s", type: "ugc-script", data: { targetDurationSec: 20, keepResult: true, result: { v: 1 } } },
      { id: "l", type: "ugc-clips", data: { voiceId: "v", quote: { lines: [] }, result: {}, __listResults: ["{}"], ugcOutputs: { "plan-out": "{}" } } },
      { id: "k", type: "ugc-clip", data: { rerender: { "2": 1 }, rerenderPending: { "2": true }, warnings: ["x"], __listResults: ["u"], __listResultMeta: [], clipWarnings: [], durationSec: 9 } },
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

  it("never ships the author's own photo: a UGC Creator's photo goes, its source stays — a My photo run's image (that photo) too", () => {
    const photo = "https://cdn.example/me.png"
    // What a My photo run writes onto the creator: its image IS the photo (the creator wire names it).
    const [creator] = stripUgcRunState([
      {
        id: "c",
        type: "ugc-creator",
        data: {
          source: "photo",
          gender: "woman",
          photoUrl: photo,
          generatedImageUrl: photo,
          ugcOutputs: { creator: '{"v":1}', image: photo },
          result: { v: 1, identityImages: [photo] },
          executionStatus: "completed",
          resultsRunId: "exec-1",
          resultsRunEndedAt: "2026-10-09T09:00:40.000Z",
        },
      },
    ])
    expect(JSON.stringify(creator)).not.toContain(photo)
    expect(creator!.data).not.toHaveProperty("generatedImageUrl")
    expect(creator!.data).toMatchObject({ source: "photo", gender: "woman", keepResult: false })
  })

  it("no published creator carries the author's last image, whatever its source", () => {
    expect(UGC_NODE_RUN_STATE_KEYS["ugc-creator"]).toContain("generatedImageUrl")
    const [creator] = stripUgcRunState([{ id: "c", type: "ugc-creator", data: { source: "sampled", gender: "man", generatedImageUrl: "https://cdn.example/drawn.png" } }])
    expect(creator!.data).toEqual({ source: "sampled", gender: "man", keepResult: false })
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
    // The script's language is a choice a run may set; a future field is refused without anyone listing it.
    expect(findUgcLockedFields(nodes, { script: { language: "he" } })).toEqual([])
    expect(findUgcLockedFields(nodes, { script: { voice: "x" } })).toEqual([{ nodeId: "script", nodeType: "ugc-script", field: "voice" }])
  })

  it("ignores non-UGC nodes and missing inputs", () => {
    expect(findUgcLockedFields([{ id: "t", type: "text-prompt" }], { t: { text: "x" } })).toEqual([])
    expect(findUgcLockedFields(null, { t: { text: "x" } })).toEqual([])
    expect(findUgcLockedFields([{ id: "c", type: "ugc-creator" }], undefined)).toEqual([])
  })

  it("a creator's candidates are run state: stripped at publish and locked against a run's overrides", () => {
    const nodes = [{ id: "c", type: "ugc-creator", data: { source: "sampled", gender: "woman", keepResult: false, candidates: [{ imageUrl: "https://cdn.example/a.png", record: { v: 1 } }] } }]
    expect(UGC_NODE_RUN_STATE_KEYS["ugc-creator"]).toContain(UGC_CREATOR_CANDIDATES_KEY)
    expect(stripUgcRunState(nodes)[0]!.data).toEqual({ source: "sampled", gender: "woman", keepResult: false })
    expect(findUgcLockedFields(nodes, { c: { candidates: [] } })).toEqual([{ nodeId: "c", nodeType: "ugc-creator", field: "candidates" }])
  })
})

describe("Pick a creator first", () => {
  const option = { imageUrl: "https://cdn.example/a.png", record: { v: 1 } }
  const creator = (candidates?: unknown) => ({ id: "c", type: "ugc-creator", data: { source: "sampled", ...(candidates ? { candidates } : {}) } })
  it("options waiting: one or more stored on the node", () => {
    expect(ugcPickPending(creator([option, option]).data)).toBe(true)
    expect(ugcPickPending(creator([option]).data)).toBe(true)
    expect(ugcPickPending(creator([]).data)).toBe(false)
    expect(ugcPickPending(creator().data)).toBe(false)
  })
  it("a run that executes a creator with options waiting is refused; its own re-draw is not; other nodes never are", () => {
    expect(ugcRunWaitsForPick([creator([option, option])])).toBe(true)
    expect(ugcRunWaitsForPick([creator([option, option])], { redrawId: "c" })).toBe(false)
    expect(ugcRunWaitsForPick([creator()])).toBe(false)
    expect(ugcRunWaitsForPick([{ id: "x", type: "ugc-clips", data: { candidates: [option] } }])).toBe(false)
    expect(UGC_PICK_FIRST_MESSAGE).toBe("Pick a creator first.")
  })
  it("the note of the last draw is run state", () => {
    expect(UGC_NODE_RUN_STATE_KEYS["ugc-creator"]).toContain("optionFailed")
  })
  it("reads options only from a data object, and only a list counts", () => {
    for (const data of [undefined, null, "candidates", [option], { candidates: { 0: option } }, { candidates: "x" }]) {
      expect(ugcPickPending(data), JSON.stringify(data)).toBe(false)
    }
    expect(ugcRunWaitsForPick([])).toBe(false)
    expect(ugcRunWaitsForPick([{ id: "c", type: null, data: { candidates: [option] } }, { id: "d" }])).toBe(false)
  })
  it("a second creator waiting is refused even while the first is re-drawn", () => {
    const other = { ...creator([option]), id: "c2" }
    expect(ugcRunWaitsForPick([creator([option, option]), other], { redrawId: "c" })).toBe(true)
  })
  it("the note of the last draw is stripped at publish", () => {
    const nodes = [{ id: "c", type: "ugc-creator", data: { source: "sampled", gender: "woman", keepResult: false, optionFailed: true } }]
    expect(stripUgcRunState(nodes)[0]!.data).toEqual({ source: "sampled", gender: "woman", keepResult: false })
  })
})
