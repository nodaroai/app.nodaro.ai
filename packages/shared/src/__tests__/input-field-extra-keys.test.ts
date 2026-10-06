import { describe, expect, it } from "vitest"
// The index's `INPUT_FIELD_MAP` is the component-types key-only map; the typed
// per-node-type table is read through `getInputFieldSchema`.
import { INPUT_FIELD_EXTRA_KEYS, INPUT_FIELD_MAP, UGC_OVERRIDABLE_FIELDS, getInputFieldExtraKeys, getInputFieldSchema } from "../index.js"

/** The keys the node actually reads (its data fields). PR B's UgcCreatorData must keep these names. */
const NODE_READS: Record<string, readonly string[]> = {
  "ugc-creator": ["source", "gender", "photoUrl", "categoryOverride", "seed", "keepResult", "result"],
}

describe("INPUT_FIELD_EXTRA_KEYS (spec §6.6)", () => {
  it("every extra key is a field the node reads and is overridable", () => {
    for (const [type, extras] of Object.entries(INPUT_FIELD_EXTRA_KEYS)) {
      for (const { key } of extras) {
        expect(NODE_READS[type], type).toContain(key)
        expect(UGC_OVERRIDABLE_FIELDS[type], `${type}.${key}`).toContain(key)
      }
    }
  })
  it("the primary key is overridable too, and the three creator keys are exactly the overridable set", () => {
    expect(getInputFieldSchema("ugc-creator")).toEqual({ key: "source", type: "select" })
    expect(INPUT_FIELD_MAP["ugc-creator"]).toBe("source")
    const all = [getInputFieldSchema("ugc-creator")!.key, ...INPUT_FIELD_EXTRA_KEYS["ugc-creator"]!.map((e) => e.key)]
    expect(all.sort()).toEqual([...UGC_OVERRIDABLE_FIELDS["ugc-creator"]!].sort())
  })
  it("getInputFieldExtraKeys returns the extras, and nothing for a type without any", () => {
    expect(getInputFieldExtraKeys("ugc-creator")).toEqual([
      { key: "gender", type: "select" },
      { key: "photoUrl", type: "image-url" },
    ])
    expect(getInputFieldExtraKeys("text-prompt")).toEqual([])
    expect(getInputFieldExtraKeys("constructor")).toEqual([])
  })
})
