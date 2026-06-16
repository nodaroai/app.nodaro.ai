import { describe, it, expect } from "vitest"
import { presetState, lowerNameSet } from "../preset-state"

describe("presetState", () => {
  const NONE: ReadonlySet<string> = new Set()

  it("returns 'idle' when the preset is neither generated nor generating", () => {
    expect(presetState("smile", NONE, NONE)).toBe("idle")
  })

  it("returns 'created' when an item with that name already exists", () => {
    expect(presetState("smile", new Set(["smile"]), NONE)).toBe("created")
  })

  it("returns 'creating' when a job for that name is in flight", () => {
    expect(presetState("smile", NONE, new Set(["smile"]))).toBe("creating")
  })

  it("prefers 'creating' over 'created' (e.g. a replace-regenerate of an existing item)", () => {
    expect(presetState("smile", new Set(["smile"]), new Set(["smile"]))).toBe("creating")
  })

  it("matches case-insensitively so 'Smile' preset hits a lowercased 'smile' item", () => {
    expect(presetState("Smile", new Set(["smile"]), NONE)).toBe("created")
    expect(presetState("WALKING", NONE, new Set(["walking"]))).toBe("creating")
  })
})

describe("lowerNameSet", () => {
  it("builds a lowercased set of item names", () => {
    const set = lowerNameSet([{ name: "Front" }, { name: "side" }, { name: "Three-Quarter" }])
    expect(set).toEqual(new Set(["front", "side", "three-quarter"]))
  })

  it("returns an empty set for no items", () => {
    expect(lowerNameSet([])).toEqual(new Set())
  })
})
