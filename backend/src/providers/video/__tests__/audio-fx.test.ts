import { describe, it, expect } from "vitest"
import { buildAudioFxArgs } from "../audio-fx.js"

describe("buildAudioFxArgs", () => {
  it("reverb preset (room) splits dry/wet, convolves via afir, and amixes them back", () => {
    const args = buildAudioFxArgs({ audioUrl: "x", preset: "room" })
    expect(args[0]).toBe("-filter_complex")
    const fc = args[1]
    expect(fc).toContain("anoisesrc")
    expect(fc).toContain("afir")
    expect(fc).toContain("asplit") // dry/wet split so the dry passes through
    expect(fc).toContain("amix")   // mixed back (afir alone drops the dry)
    expect(args).toContain("-map")
    expect(args).toContain("[out]")
  })

  it("dry/wet is a complementary unity crossfade (mix=50 → dry 0.5, wet 0.5)", () => {
    const fc = buildAudioFxArgs({ audioUrl: "x", preset: "hall", mix: 50 })[1]
    // both legs at 0.5 → sum ≈ unity (no longer dry@1.0 + wet@×8 = too loud)
    expect(fc).toContain("volume=0.500")
    expect((fc.match(/volume=0\.500/g) ?? []).length).toBe(2) // dry + wet
    expect(fc).toContain("alimiter=limit=0.95") // hard clip/corruption safety
  })

  it("mix=100 is full wet at unity (NOT ×8 → no clipping/corruption)", () => {
    const fc = buildAudioFxArgs({ audioUrl: "x", preset: "hall", mix: 100 })[1]
    expect(fc).toContain("volume=1.000") // wet at unity
    expect(fc).toContain("volume=0.000") // dry muted
    expect(fc).not.toContain("volume=8.000")
  })

  it("mix=0 bypasses reverb (wet volume 0, dry at full) — passthrough, NOT silence", () => {
    const fc = buildAudioFxArgs({ audioUrl: "x", preset: "room", mix: 0 })[1]
    expect(fc).toContain("volume=0.000") // wet muted
    expect(fc).toContain("volume=1.000") // dry at full
    expect(fc).toContain("asplit")
  })

  it("church (cathedral scenario) uses a long IR (3.0s decay)", () => {
    const fc = buildAudioFxArgs({ audioUrl: "x", preset: "church" })[1]
    expect(fc).toContain("d=3")
  })

  it("telephone band-limits via -af (no filter_complex)", () => {
    const args = buildAudioFxArgs({ audioUrl: "x", preset: "telephone" })
    expect(args[0]).toBe("-af")
    expect(args[1]).toContain("highpass=f=300")
    expect(args[1]).toContain("lowpass=f=3400")
  })

  it("echo uses aecho with the supplied delay/decay", () => {
    const args = buildAudioFxArgs({ audioUrl: "x", preset: "echo", delayMs: 300, decay: 0.5 })
    expect(args[0]).toBe("-af")
    expect(args[1]).toContain("aecho=0.8:0.88:300:0.5")
  })

  it("custom applies only the set knobs (EQ + delay)", () => {
    const args = buildAudioFxArgs({ audioUrl: "x", preset: "custom", eqLow: 3, eqHigh: -2, delayMs: 200 })
    const chain = args[1]
    expect(chain).toContain("bass=g=3")
    expect(chain).toContain("treble=g=-2")
    expect(chain).toContain("aecho")
  })

  it("custom with no knobs is a no-op (anull)", () => {
    expect(buildAudioFxArgs({ audioUrl: "x", preset: "custom" })[1]).toBe("anull")
  })
})
