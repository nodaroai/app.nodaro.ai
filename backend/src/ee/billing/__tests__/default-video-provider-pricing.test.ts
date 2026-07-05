import { describe, it, expect } from "vitest"
import { DEFAULT_VIDEO_PROVIDER, DEFAULT_VIDEO_DURATION_SEC } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../credits.js"

// The platform's nothing-specified video request resolves to this composite
// (see applyDefaultVideoSelection + the omitted-resolution → 480p snap in
// buildVideoCreditModelIdentifier). If the tier is ever unseeded, every
// provider-omitted API/SDK call hard-fails with price_not_configured.
describe("default video provider pricing", () => {
  it("the pure-default composite is seeded", () => {
    const id = `${DEFAULT_VIDEO_PROVIDER}:${DEFAULT_VIDEO_DURATION_SEC}s:480p`
    expect(STATIC_CREDIT_COSTS[id]).toBeGreaterThan(0)
  })

  it("the base identifier is seeded (duration-omitted with explicit provider)", () => {
    expect(STATIC_CREDIT_COSTS[DEFAULT_VIDEO_PROVIDER]).toBeGreaterThan(0)
  })
})
