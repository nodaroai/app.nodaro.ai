import { describe, it, expect } from "vitest"

import { applyCastRebinds, castKeyForAsset, type CastRebind } from "../cast-rebind"
import type { Cast } from "../cast"

/**
 * The RECAST a Review row asks for, applied to a cast that has just been
 * enrolled (Task 5). The role keeps its name — that is what recast means — and
 * only the actor moves, exactly as `recastCastMember` does in the editor.
 */

const cast: Cast = {
  "young-man-in-red-jacket": {
    kind: "character",
    assetId: "char-young",
    displayName: "Young Man in Red Jacket",
    defaultRole: "the runner",
  },
  natalie: { kind: "character", assetId: "char-natalie", displayName: "Natalie" },
}

const rebind = (from: string, assetId: string, kind: "character" | "location" = "character"): CastRebind => ({
  from,
  to: { kind, assetId, name: "Marco" },
})

describe("castKeyForAsset", () => {
  it("finds the role a landed actor became, by asset alone", () => {
    expect(castKeyForAsset(cast, "char-young")).toBe("young-man-in-red-jacket")
    expect(castKeyForAsset(cast, "nobody")).toBeUndefined()
  })
})

describe("applyCastRebinds", () => {
  it("swaps the actor and keeps the role's name and word", () => {
    const next = applyCastRebinds(cast, [rebind("char-young", "char-marco")])
    expect(next["young-man-in-red-jacket"]).toEqual({
      kind: "character",
      assetId: "char-marco",
      displayName: "Young Man in Red Jacket",
      defaultRole: "the runner",
    })
    // The other role is untouched, and the input cast is never mutated.
    expect(next.natalie).toBe(cast.natalie)
    expect(cast["young-man-in-red-jacket"]!.assetId).toBe("char-young")
  })

  it("recasts ACROSS kinds — the registry keys a role by its name, not its kind", () => {
    const next = applyCastRebinds(cast, [rebind("char-young", "loc-alley", "location")])
    expect(next["young-man-in-red-jacket"]).toMatchObject({
      kind: "location",
      assetId: "loc-alley",
      displayName: "Young Man in Red Jacket",
    })
  })

  it("skips a rebind whose role never landed, and returns the SAME cast when none did", () => {
    const next = applyCastRebinds(cast, [rebind("char-ghost", "char-marco")])
    expect(next).toBe(cast)
  })

  it("applies several in order", () => {
    const next = applyCastRebinds(cast, [
      rebind("char-young", "char-marco"),
      rebind("char-natalie", "char-abi"),
    ])
    expect(next["young-man-in-red-jacket"]!.assetId).toBe("char-marco")
    expect(next.natalie!.assetId).toBe("char-abi")
  })
})
