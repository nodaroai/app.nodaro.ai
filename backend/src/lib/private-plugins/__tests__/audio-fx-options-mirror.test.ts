import { describe, expect, expectTypeOf, it } from "vitest"
import type { AudioFxOptions } from "../../../providers/video/audio-fx.js"
import type { PluginAudioFxOptions } from "../types.js"

type AllKeys<T> = T extends unknown ? keyof T : never

// `PluginAudioFxOptions` is a hand-synced mirror of the real `AudioFxOptions`
// that `toolkit.ts` binds (compile-time checks; tsc covers tests). A field
// added to the real options that the mirror lacks is one a plugin cannot pass.
describe("PluginAudioFxOptions mirrors AudioFxOptions", () => {
  it("carries every option the real function accepts, including the lossless/local ones", () => {
    expectTypeOf<AllKeys<PluginAudioFxOptions>>().toEqualTypeOf<AllKeys<AudioFxOptions>>()
    expectTypeOf<NonNullable<PluginAudioFxOptions["format"]>>().toEqualTypeOf<"mp3" | "wav">()
    expectTypeOf<PluginAudioFxOptions["outputPath"]>().toEqualTypeOf<string | undefined>()
    expect(true).toBe(true)
  })

  it("every existing call shape still type-checks (additive only)", () => {
    const urlOnly: PluginAudioFxOptions = { audioUrl: "https://x/a.mp3", preset: "room" }
    const withKnobs: PluginAudioFxOptions = { audioUrl: "u", preset: "echo", delayMs: 100, decay: 0.3 }
    const local: PluginAudioFxOptions = { inputPath: "/tmp/a.wav", outputPath: "/tmp/b.wav", preset: "room", format: "wav" }
    expect([urlOnly, withKnobs, local]).toHaveLength(3)
  })
})
