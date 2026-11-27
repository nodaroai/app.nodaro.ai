import { afterEach, describe, expect, it } from "vitest"
import { engineTakesPortion, engineTakesShortClips, loadedEngineTakesPortion } from "../video-remake-portion.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../private-plugins/supports-registry.js"

/**
 * A part of the clip (`castSwap.portion`) and short clips (`castSwap.shortClips`), decided 2026-11-25:
 * each is taken only by an engine that declares it exactly `true`; absent, false or any other value is not.
 */
describe("video remake: part of the clip and short clips", () => {
  afterEach(() => _resetPluginSupportsForTests())

  it("is taken only by an engine that declares castSwap.portion true", () => {
    expect(engineTakesPortion(undefined)).toBe(false)
    expect(engineTakesPortion({ portion: false } as never)).toBe(false)
    expect(engineTakesPortion({ portion: "true" } as never)).toBe(false)
    expect(engineTakesPortion({ upscaleChoice: true } as never)).toBe(false)
    expect(engineTakesPortion({ portion: true } as never)).toBe(true)
    expect(loadedEngineTakesPortion()).toBe(false)
    setPluginSupports({ castSwap: { portion: true } as never })
    expect(loadedEngineTakesPortion()).toBe(true)
  })

  it("takes 2-second clips only where the engine declares castSwap.shortClips true", () => {
    expect(engineTakesShortClips(undefined)).toBe(false)
    expect(engineTakesShortClips({ shortClips: false } as never)).toBe(false)
    expect(engineTakesShortClips({ portion: true } as never)).toBe(false)
    expect(engineTakesShortClips({ shortClips: true } as never)).toBe(true)
  })
})
