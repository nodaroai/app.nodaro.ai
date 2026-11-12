import { describe, it, expect } from "vitest"
import { getVideoAudioCapability, VIDEO_AUDIO_CAPABILITY, isVeoProvider, isSeedance2Provider, AUDIO_ADDON_PROVIDERS } from "@nodaro/shared/models"
import { KIE_VIDEO_MODELS, KIE_TEXT_TO_VIDEO_MODELS } from "../models.js"

/**
 * Drift guard — the shared `VIDEO_AUDIO_CAPABILITY` single source of truth must
 * stay in sync with the KIE model configs it consolidates. A new audio-capable
 * model (declaring `extraParams.sound` / `generate_audio` / `audio`) added to
 * `models.ts` without a matching capability entry fails HERE rather than
 * silently disabling the audio toggle in the UI + skipping the Story→Video
 * dialogue auto-pick.
 *
 * The lever names must be kept in step with `applyVideoAudioToggle`'s write in
 * @nodaro/shared (`WIRE_KEY_BY_FIELD` below): a lever the guard doesn't know
 * about is a lever a model can declare while the capability table stays
 * silent, and the suite passes vacuously (the Wan 3.0 `audio` case, 2026-09).
 */
const ALL_VIDEO_MODELS = [
  ...Object.entries(KIE_VIDEO_MODELS),
  ...Object.entries(KIE_TEXT_TO_VIDEO_MODELS),
]

/** The wire key each capability `field` writes (`applyVideoAudioToggle`). */
const WIRE_KEY_BY_FIELD = {
  sound: "sound",
  generateAudio: "generate_audio",
  audio: "audio",
  generateAudioSwitch: "generate_audio_switch",
} as const

function declaresAudioParam(extraParams: Record<string, unknown> | undefined): boolean {
  const ep = extraParams ?? {}
  return Object.values(WIRE_KEY_BY_FIELD).some((key) => key in ep)
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

  it("audio-addon models are audio-capable, cost-affecting and switchable", () => {
    // `affectsCost` is what makes applyVideoAudioToggle read ONLY the canonical
    // `sound` intent — the flag the `:audio` row is built from — whatever wire
    // key the model's switch has (Kling `sound`, PixVerse V6 Max
    // `generate_audio_switch`).
    for (const [key] of ALL_VIDEO_MODELS) {
      if (AUDIO_ADDON_PROVIDERS.has(key)) {
        const cap = getVideoAudioCapability(key)
        expect(cap.mode, key).not.toBe("none")
        expect(cap.field, key).toBeDefined()
        expect(cap.alwaysOn, key).toBeUndefined()
        expect(cap.affectsCost, key).toBe(true)
      }
    }
    // The Kling members keep their own lever.
    expect(getVideoAudioCapability("kling").field).toBe("sound")
    expect(getVideoAudioCapability("kling-3.0").field).toBe("sound")
  })

  it("capability defaultOn mirrors the model config's own switch default", () => {
    // The `:audio` billing suffix falls back to `defaultOn` when the caller
    // expressed no intent — it must therefore match what the provider layer
    // actually does by default (models.ts extraParams, under the model's own
    // wire key). A mismatch re-opens the billed-without-generating /
    // generated-without-billing gap for intent-less requests.
    let checked = 0
    for (const [key, cfg] of ALL_VIDEO_MODELS) {
      if (!AUDIO_ADDON_PROVIDERS.has(key)) continue
      const cap = getVideoAudioCapability(key)
      const wireKey = cap.field ? WIRE_KEY_BY_FIELD[cap.field] : undefined
      const ep = (cfg.extraParams ?? {}) as Record<string, unknown>
      if (!wireKey || !(wireKey in ep)) continue
      checked++
      expect(cap.defaultOn === true, `${key}: capability defaultOn must equal models.ts extraParams.${wireKey}`)
        .toBe(ep[wireKey] === true)
    }
    expect(checked).toBeGreaterThan(0)
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
      if (cap.field === "audio") {
        expect("audio" in (cfg.extraParams ?? {}), `${model} claims field "audio"`).toBe(true)
      }
      if (cap.field === "generateAudioSwitch") {
        expect("generate_audio_switch" in (cfg.extraParams ?? {}), `${model} claims field "generateAudioSwitch"`).toBe(true)
      }
    }
  })
})
