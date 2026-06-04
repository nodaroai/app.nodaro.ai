import { describe, it, expect } from "vitest"
import {
  buildAppliedConfigPatch,
  selectSettings,
  type ResultGenerationSettings,
} from "@/hooks/use-result-generation-settings"
import type { Job } from "@/lib/api"

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

  // --- Video-specific fields (additive; image jobs simply don't record them) ---

  it("video: restores duration / videoSize / generateAudio when present", () => {
    const v: ResultGenerationSettings = {
      provider: "kling-3.0",
      aspectRatio: "16:9",
      resolution: "1080p",
      duration: 5,
      videoSize: "high",
      generateAudio: true,
    }
    const patch = buildAppliedConfigPatch(v, { includePrompt: false })
    expect(patch.duration).toBe(5)
    expect(patch.videoSize).toBe("high")
    expect(patch.generateAudio).toBe(true)
  })

  it("video: restores generateAudio === false (a meaningful value, not 'absent')", () => {
    const v: ResultGenerationSettings = { provider: "veo3", generateAudio: false }
    const patch = buildAppliedConfigPatch(v, { includePrompt: false })
    expect("generateAudio" in patch).toBe(true)
    expect(patch.generateAudio).toBe(false)
  })

  it("video: omits duration / videoSize / generateAudio the job didn't record", () => {
    const v: ResultGenerationSettings = { provider: "kling", aspectRatio: "16:9" }
    const patch = buildAppliedConfigPatch(v, { includePrompt: false })
    expect("duration" in patch).toBe(false)
    expect("videoSize" in patch).toBe(false)
    expect("generateAudio" in patch).toBe(false)
  })
})

describe("selectSettings — video fields", () => {
  function jobWith(input: Record<string, unknown>): Job {
    return { input_data: input } as unknown as Job
  }

  it("extracts duration (number), videoSize (string), generateAudio (boolean)", () => {
    const s = selectSettings(
      jobWith({
        provider: "kling-3.0",
        aspectRatio: "16:9",
        resolution: "1080p",
        duration: 5,
        videoSize: "high",
        generateAudio: true,
      }),
    )
    expect(s.duration).toBe(5)
    expect(s.videoSize).toBe("high")
    expect(s.generateAudio).toBe(true)
  })

  it("preserves generateAudio === false (not coerced away)", () => {
    const s = selectSettings(jobWith({ provider: "veo3", generateAudio: false }))
    expect(s.generateAudio).toBe(false)
  })

  it("omits duration when it isn't a number", () => {
    const s = selectSettings(jobWith({ provider: "kling", duration: "5" }))
    expect(s.duration).toBeUndefined()
  })
})
