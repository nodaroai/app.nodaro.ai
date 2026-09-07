import { describe, it, expect } from "vitest"

import type { ShotClipResult, ShotStillResult } from "../shot-results"

/**
 * Smoke coverage for the types-only result module: it must LOAD (so the
 * extraction can't reintroduce a runtime cycle back into `shot.ts`) and both
 * result contracts must still be importable from their own path.
 */
describe("shot-results", () => {
  it("loads and carries the still/clip result contracts", async () => {
    const mod = await import("../shot-results")
    expect(mod).toBeDefined()

    const still: ShotStillResult = { url: "https://r2/still.png" }
    const clip: ShotClipResult = { url: "https://r2/clip.mp4" }
    expect([still.url, clip.url]).toEqual([
      "https://r2/still.png",
      "https://r2/clip.mp4",
    ])
  })
})
