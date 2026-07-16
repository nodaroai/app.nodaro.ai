import { describe, it, expect } from "vitest"
import { getVideoAudioCapability, VIDEO_AUDIO_CAPABILITY, isVeoProvider, isSeedance2Provider, AUDIO_ADDON_PROVIDERS } from "@nodaro/shared"
import { KIE_VIDEO_MODELS, KIE_TEXT_TO_VIDEO_MODELS } from "../models.js"

/**
 * Drift guard — the shared `VIDEO_AUDIO_CAPABILITY` single source of truth must
 * stay in sync with the KIE model configs it consolidates. A new audio-capable
 * model (declaring `extraParams.sound` / `generate_audio`) added to `models.ts`
 * without a matching capability entry fails HERE rather than silently disabling
 * the audio toggle in the UI + skipping the Story→Video dialogue auto-pick.
 */
const ALL_VIDEO_MODELS = [
  ...Object.entries(KIE_VIDEO_MODELS),
  ...Object.entries(KIE_TEXT_TO_VIDEO_MODELS),
]

function declaresAudioParam(extraParams: Record<string, unknown> | undefined): boolean {
  const ep = extraParams ?? {}
  return "sound" in ep || "generate_audio" in ep
}

describe("VIDEO_AUDIO_CAPABILITY drift guard vs KIE model configs", () => {
  it("every model declaring an audio param is classified audio-capable", () => {
    for (const [key, cfg] of ALL_VIDEO_MODELS) {
      if (declaresAudioParam(cfg.extraParams)) {
        expect(
          getVideoAudioCapability(key).mode,
          `${key} declares an audio param in models.ts but VIDEO_AUDIO_CAPABILITY says "none"`,
        ).not.toBe("none")
      }
    }
  })

  it("VEO models are native_speech", () => {
    for (const [key] of ALL_VIDEO_MODELS) {
      if (isVeoProvider(key)) {
        expect(getVideoAudioCapability(key).mode, key).toBe("native_speech")
      }
    }
  })

  it("Seedance-2 models are audio_driven", () => {
    for (const [key] of ALL_VIDEO_MODELS) {
      if (isSeedance2Provider(key)) {
        expect(getVideoAudioCapability(key).mode, key).toBe("audio_driven")
      }
    }
  })

  it("Kling audio-addon models are audio-capable + cost-affecting on `sound`", () => {
    for (const [key] of ALL_VIDEO_MODELS) {
      if (AUDIO_ADDON_PROVIDERS.has(key)) {
        const cap = getVideoAudioCapability(key)
        expect(cap.mode, key).not.toBe("none")
        expect(cap.field, key).toBe("sound")
        expect(cap.affectsCost, key).toBe(true)
      }
    }
  })

  it("capability defaultOn mirrors the model config's own `sound` default", () => {
    // The `:audio` billing suffix falls back to `defaultOn` when the caller
    // expressed no intent — it must therefore match what the provider layer
    // actually does by default (models.ts extraParams.sound). A mismatch
    // re-opens the billed-without-generating / generated-without-billing gap
    // for intent-less requests.
    for (const [key, cfg] of ALL_VIDEO_MODELS) {
      if (!AUDIO_ADDON_PROVIDERS.has(key)) continue
      const ep = (cfg.extraParams ?? {}) as Record<string, unknown>
      if (!("sound" in ep)) continue
      const cap = getVideoAudioCapability(key)
      expect(cap.defaultOn === true, `${key}: capability defaultOn must equal models.ts extraParams.sound`)
        .toBe(ep.sound === true)
    }
  })

  it("a capability's named toggle field actually exists on the model config", () => {
    const cfgByKey = new Map(ALL_VIDEO_MODELS)
    for (const [model, cap] of Object.entries(VIDEO_AUDIO_CAPABILITY)) {
      const cfg = cfgByKey.get(model)
      // VEO-style native models have no extraParams toggle (own endpoint); only
      // assert when the model exists in the KIE maps and claims a toggle field.
      if (!cfg) continue
      if (cap.field === "sound") {
        expect("sound" in (cfg.extraParams ?? {}), `${model} claims field "sound"`).toBe(true)
      }
      if (cap.field === "generateAudio") {
        expect(
          "generate_audio" in (cfg.extraParams ?? {}),
          `${model} claims field "generateAudio"`,
        ).toBe(true)
      }
    }
  })
})
