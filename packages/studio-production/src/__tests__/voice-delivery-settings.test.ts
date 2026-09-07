import { describe, it, expect } from "vitest"

import {
  VOICE_DELIVERY_BOUNDS,
  VOICE_DELIVERY_DEFAULTS,
  pruneDeliverySettings,
  readDeliverySettings,
  voiceDeliveryPresets,
} from "../voice-delivery-settings"

/**
 * The per-voiceover delivery levers (speed / stability / similarityBoost /
 * style — the exact `text-to-speech` route fields, camelCase, verified against
 * the platform's Zod). Load-bearing invariants: PRUNE-to-defaults (an
 * untouched popover sends NOTHING, keeping today's wire byte-identical), and
 * the preset list derives from `@nodaro/prompts`' factory presets — never a
 * hand-copied table that can drift from the platform's.
 */

describe("pruneDeliverySettings", () => {
  it("returns undefined when every lever is at its default", () => {
    expect(pruneDeliverySettings({ ...VOICE_DELIVERY_DEFAULTS })).toBeUndefined()
    expect(pruneDeliverySettings({})).toBeUndefined()
    expect(pruneDeliverySettings(undefined)).toBeUndefined()
  })

  it("keeps only the levers that differ from defaults", () => {
    expect(
      pruneDeliverySettings({ ...VOICE_DELIVERY_DEFAULTS, style: 0.6 }),
    ).toEqual({ style: 0.6 })
  })

  it("keeps multiple tuned levers intact", () => {
    const tuned = { speed: 0.9, stability: 0.8, similarityBoost: 0.75, style: 0 }
    expect(pruneDeliverySettings(tuned)).toEqual({ speed: 0.9, stability: 0.8 })
  })
})

describe("VOICE_DELIVERY_BOUNDS", () => {
  it("names exactly the four route levers the defaults do (D4)", () => {
    expect(Object.keys(VOICE_DELIVERY_BOUNDS).sort()).toEqual(
      Object.keys(VOICE_DELIVERY_DEFAULTS).sort(),
    )
  })
})

describe("readDeliverySettings", () => {
  it("clamps an out-of-range lever to its bound instead of dropping it (D4)", () => {
    expect(readDeliverySettings({ speed: 3 })).toEqual({ speed: 1.2 })
    expect(readDeliverySettings({ speed: 0.1 })).toEqual({ speed: 0.7 })
  })

  it("clamping onto the default value prunes it away — the wire stays untouched", () => {
    // -5 clamps to `style`'s own floor, 0 — which IS the default, so the
    // clamped value is pruned same as an untouched lever: this reader's
    // clamp and the prune-to-defaults rule compose, they don't fight.
    expect(readDeliverySettings({ style: -5 })).toBeUndefined()
  })

  it("drops a non-numeric or foreign field instead of trusting it", () => {
    expect(readDeliverySettings({ speed: "fast", bogus: 1 })).toBeUndefined()
  })

  it("keeps an in-range value unchanged", () => {
    expect(readDeliverySettings({ speed: 0.9, stability: 0.8 })).toEqual({
      speed: 0.9,
      stability: 0.8,
    })
  })

  it("returns undefined for a non-object value", () => {
    expect(readDeliverySettings(undefined)).toBeUndefined()
    expect(readDeliverySettings("nonsense")).toBeUndefined()
    expect(readDeliverySettings(null)).toBeUndefined()
  })
})

describe("voiceDeliveryPresets", () => {
  it("derives from the platform factory presets (non-empty, numeric settings)", () => {
    const presets = voiceDeliveryPresets()
    expect(presets.length).toBeGreaterThanOrEqual(5)
    for (const p of presets) {
      expect(p.id).toMatch(/^text-to-speech\//)
      expect(p.name.length).toBeGreaterThan(0)
      const values = Object.values(p.settings)
      expect(values.length).toBeGreaterThan(0)
      for (const v of values) expect(typeof v).toBe("number")
    }
  })

  it("includes the known narration staples", () => {
    const names = voiceDeliveryPresets().map((p) => p.name)
    expect(names).toContain("Calm Narrator")
    expect(names).toContain("Audiobook")
  })

  it("carries only the four route levers (no stray preset keys)", () => {
    for (const p of voiceDeliveryPresets()) {
      for (const key of Object.keys(p.settings)) {
        expect(["speed", "stability", "similarityBoost", "style"]).toContain(key)
      }
    }
  })
})
