import { describe, it, expect } from "vitest"
import {
  AUDIO_PRODUCER_TYPES,
  VIDEO_PRODUCER_TYPES,
  DYNAMIC_PRODUCER_TYPES,
} from "../producer-types.js"

/**
 * Producer-set membership is what every downstream node's typed-handle
 * `accepts(sourceType)` predicate consults to decide whether an edge LEAVING
 * a source node may land on its input. A node with audio/video OUTPUT handles
 * that is absent from these sets can't connect its outputs anywhere — the
 * canvas validator hard-rejects every edge (drift bug class, see file header).
 *
 * This guards the recurrence where `voice-changer-pro` (renamed from
 * voice-recast in #3581) shipped with output handles but was never added to
 * the producer sets, so "cannot connect the outputs of voice-changer-pro".
 */
describe("producer-types", () => {
  const ALL_SETS = {
    AUDIO_PRODUCER_TYPES,
    VIDEO_PRODUCER_TYPES,
    DYNAMIC_PRODUCER_TYPES,
  } as const

  it("registers voice-changer-pro as an audio producer (its default output)", () => {
    expect(AUDIO_PRODUCER_TYPES.has("voice-changer-pro")).toBe(true)
  })

  it("registers voice-changer-pro as a dynamic producer (dual-mode → accepted on BOTH audio and video input handles)", () => {
    expect(DYNAMIC_PRODUCER_TYPES.has("voice-changer-pro")).toBe(true)
  })

  // voice-changer-pro is a behavioral twin of voice-changer (identical
  // dual-mode output: audio in → audio out; video in → video out). Their
  // producer-set membership must never drift apart — if voice-changer is
  // later added to/removed from any set, the same must happen for the Pro
  // variant, or its outputs silently stop connecting in exactly one mode.
  it("keeps voice-changer-pro's producer membership identical to its twin voice-changer", () => {
    for (const [name, set] of Object.entries(ALL_SETS)) {
      expect(
        set.has("voice-changer-pro"),
        `voice-changer-pro must match voice-changer in ${name}`,
      ).toBe(set.has("voice-changer"))
    }
  })
})
