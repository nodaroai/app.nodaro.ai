import { describe, it, expect } from "vitest"
import {
  buildAppliedConfigPatch,
  type ResultGenerationSettings,
} from "@/hooks/use-result-generation-settings"

const FULL: ResultGenerationSettings = {
  provider: "nano-banana-pro",
  aspectRatio: "16:9",
  resolution: "2K",
  quality: "high",
  seed: 12345,
  renderingSpeed: "TURBO",
  styleType: "GENERAL",
  expandPrompt: true,
  prompt: "a red fox in snow",
  negativePrompt: "blurry, low quality",
}

describe("buildAppliedConfigPatch", () => {
  it("config-only: restores generation params, clears providers, omits prompt/negative", () => {
    const patch = buildAppliedConfigPatch(FULL, { includePrompt: false })
    expect(patch).toEqual({
      providers: undefined,
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      quality: "high",
      seed: 12345,
      renderingSpeed: "TURBO",
      styleType: "GENERAL",
      expandPrompt: true,
    })
    expect("prompt" in patch).toBe(false)
    expect("negativePrompt" in patch).toBe(false)
  })

  it("config + prompt: also restores prompt and negative prompt", () => {
    const patch = buildAppliedConfigPatch(FULL, { includePrompt: true })
    expect(patch.prompt).toBe("a red fox in snow")
    expect(patch.negativePrompt).toBe("blurry, low quality")
    expect(patch.provider).toBe("nano-banana-pro")
  })

  it("always clears providers so a stale multi-provider cohort can't win", () => {
    const patch = buildAppliedConfigPatch(FULL, { includePrompt: false })
    expect("providers" in patch).toBe(true)
    expect(patch.providers).toBeUndefined()
  })

  it("omits fields the job didn't record (e.g. provider without a resolution lever)", () => {
    const minimal: ResultGenerationSettings = { provider: "flux", aspectRatio: "1:1" }
    const patch = buildAppliedConfigPatch(minimal, { includePrompt: false })
    expect(patch).toEqual({ providers: undefined, provider: "flux", aspectRatio: "1:1" })
    expect("resolution" in patch).toBe(false)
    expect("quality" in patch).toBe(false)
  })

  it("config + prompt with no recorded prompt → clears to empty strings", () => {
    const noPrompt: ResultGenerationSettings = { provider: "flux" }
    const patch = buildAppliedConfigPatch(noPrompt, { includePrompt: true })
    expect(patch.prompt).toBe("")
    expect(patch.negativePrompt).toBe("")
  })
})
