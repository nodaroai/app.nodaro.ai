import { describe, it, expect } from "vitest"
import { DEFAULT_MUSIC_PROVIDER, MUSIC_PROVIDERS, MUSIC_PROVIDER_LABELS, resolveMusicProvider } from "../model-constants.js"

describe("resolveMusicProvider", () => {
  it("keeps a model the node offers", () => {
    for (const p of MUSIC_PROVIDERS) expect(resolveMusicProvider(p)).toBe(p)
  })

  // New nodes started on "suno"; older ones carry retired models.
  it.each(["suno", "musicgen", "lyria", "bark", undefined, "", 7])("runs %s as the default model", (value) => {
    expect(resolveMusicProvider(value)).toBe(DEFAULT_MUSIC_PROVIDER)
  })

  it("names every model it offers", () => {
    for (const p of MUSIC_PROVIDERS) expect(MUSIC_PROVIDER_LABELS[p]).toBeTruthy()
  })
})
