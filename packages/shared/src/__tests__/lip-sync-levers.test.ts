import { describe, it, expect } from "vitest"
import { LIP_SYNC_PROVIDERS } from "../model-constants.js"
import { lipSyncLeverClearPatch, lipSyncLeversNotTaken, lipSyncTakesLever, withoutLipSyncLeversNotTaken } from "../lip-sync-levers.js"

describe("Lip Sync levers a model does not take", () => {
  it("OmniHuman 2.0 takes no resolution, fast mode or seed", () => {
    expect(lipSyncLeversNotTaken("omnihuman-2-0")).toEqual(["resolution", "fastMode", "seed"])
    expect(lipSyncTakesLever("omnihuman-2-0", "resolution")).toBe(false)
  })

  it("a node switched from 1.5 to 2.0 loses 1.5's 1080p, fast mode and seed", () => {
    const from15 = { provider: "omnihuman-1-5", resolution: "1080p", fastMode: true, seed: 42, prompt: "smile" }
    expect(lipSyncLeverClearPatch("omnihuman-2-0", from15)).toEqual({ resolution: undefined, fastMode: undefined, seed: undefined })
    expect(withoutLipSyncLeversNotTaken("omnihuman-2-0", from15)).toEqual({ provider: "omnihuman-1-5", resolution: undefined, fastMode: undefined, seed: undefined, prompt: "smile" })
  })

  it("nothing to clear: an empty patch, and the same object back", () => {
    const clean = { provider: "omnihuman-2-0", prompt: "x" }
    expect(lipSyncLeverClearPatch("omnihuman-2-0", clean)).toEqual({})
    expect(withoutLipSyncLeversNotTaken("omnihuman-2-0", clean)).toBe(clean)
  })

  it("every other model keeps every lever exactly as it was (kling, infinitalk, 1.5, the rest)", () => {
    const data = { resolution: "1080p", fastMode: true, seed: 7 }
    for (const provider of LIP_SYNC_PROVIDERS.filter((p) => p !== "omnihuman-2-0")) {
      expect(lipSyncLeversNotTaken(provider), provider).toEqual([])
      expect(withoutLipSyncLeversNotTaken(provider, data), provider).toBe(data)
    }
    expect(lipSyncLeversNotTaken(undefined)).toEqual([])
  })
})
