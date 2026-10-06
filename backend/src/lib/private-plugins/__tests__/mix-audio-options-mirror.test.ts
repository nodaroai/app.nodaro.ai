import { describe, expect, expectTypeOf, it } from "vitest"
import type { mixAudio } from "../../../providers/video/mix-audio.js"
import type { MixAudioDuck } from "../../mix-audio-duck.js"
import type { PluginMixAudioOptions } from "../types.js"

type MixAudioOptions = Parameters<typeof mixAudio>[0]

// `PluginMixAudioOptions` is a hand-synced mirror of the real `MixAudioOptions`
// that `toolkit.ts` binds. These are compile-time checks (tsc covers tests):
// a field added to the real options that the mirror does not carry makes a
// plugin unable to pass it without a type error.
describe("PluginMixAudioOptions mirrors MixAudioOptions", () => {
  it("carries `duck` with exactly the shape the real mixer accepts", () => {
    type PluginDuck = NonNullable<PluginMixAudioOptions["duck"]>
    expectTypeOf<PluginDuck>().toExtend<MixAudioDuck>()
    expectTypeOf<MixAudioDuck>().toExtend<PluginDuck>()
    expectTypeOf<keyof PluginMixAudioOptions>().toEqualTypeOf<keyof MixAudioOptions>()
    expect(true).toBe(true)
  })
})
