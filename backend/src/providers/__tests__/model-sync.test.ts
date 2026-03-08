import { describe, it, expect, vi } from "vitest"

// credits.ts imports supabase and config at module scope — mock them
vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn() },
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/billing/stripe-config.js", () => ({
  FREE_TIER_RESTRICTIONS: { blockedModels: [], dailyCreditCap: 10 },
  TIER_STORAGE_LIMITS: {},
}))

import {
  KIE_IMAGE_MODELS,
  KIE_VIDEO_MODELS,
  KIE_TEXT_TO_VIDEO_MODELS,
  KIE_VIDEO_TO_VIDEO_MODELS,
  KIE_MUSIC_MODELS,
  KIE_TTS_MODELS,
  KIE_LIP_SYNC_MODELS,
  KIE_AUDIO_ISOLATION_MODELS,
  KIE_SOUND_EFFECT_MODELS,
  KIE_VIDEO_UPSCALE_MODELS,
  KIE_MOTION_TRANSFER_MODELS,
} from "../kie/models.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All model config maps bundled for cross-cutting assertions. */
const ALL_MODEL_MAPS = {
  ...KIE_IMAGE_MODELS,
  ...KIE_VIDEO_MODELS,
  ...KIE_TEXT_TO_VIDEO_MODELS,
  ...KIE_VIDEO_TO_VIDEO_MODELS,
  ...KIE_MUSIC_MODELS,
  ...KIE_TTS_MODELS,
  ...KIE_LIP_SYNC_MODELS,
  ...KIE_AUDIO_ISOLATION_MODELS,
  ...KIE_SOUND_EFFECT_MODELS,
  ...KIE_VIDEO_UPSCALE_MODELS,
  ...KIE_MOTION_TRANSFER_MODELS,
}

const ALL_MODEL_KEYS = [
  ...Object.keys(KIE_IMAGE_MODELS),
  ...Object.keys(KIE_VIDEO_MODELS),
  ...Object.keys(KIE_TEXT_TO_VIDEO_MODELS),
  ...Object.keys(KIE_VIDEO_TO_VIDEO_MODELS),
  ...Object.keys(KIE_MUSIC_MODELS),
  ...Object.keys(KIE_TTS_MODELS),
  ...Object.keys(KIE_LIP_SYNC_MODELS),
  ...Object.keys(KIE_AUDIO_ISOLATION_MODELS),
  ...Object.keys(KIE_SOUND_EFFECT_MODELS),
  ...Object.keys(KIE_VIDEO_UPSCALE_MODELS),
  ...Object.keys(KIE_MOTION_TRANSFER_MODELS),
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("KIE model config integrity", () => {
  it("every image model has positive cost and credits", () => {
    for (const [key, cfg] of Object.entries(KIE_IMAGE_MODELS)) {
      expect(cfg.cost, `${key} cost`).toBeGreaterThan(0)
      expect(cfg.credits, `${key} credits`).toBeGreaterThan(0)
    }
  })

  it("every video model has positive cost and credits", () => {
    for (const [key, cfg] of Object.entries(KIE_VIDEO_MODELS)) {
      expect(cfg.cost, `${key} cost`).toBeGreaterThan(0)
      expect(cfg.credits, `${key} credits`).toBeGreaterThan(0)
    }
  })

  it("every text-to-video model has positive cost and credits", () => {
    for (const [key, cfg] of Object.entries(KIE_TEXT_TO_VIDEO_MODELS)) {
      expect(cfg.cost, `${key} cost`).toBeGreaterThan(0)
      expect(cfg.credits, `${key} credits`).toBeGreaterThan(0)
    }
  })

  it("every video model with allowedDurations has at least one duration", () => {
    const allVideoModels = { ...KIE_VIDEO_MODELS, ...KIE_TEXT_TO_VIDEO_MODELS }
    for (const [key, cfg] of Object.entries(allVideoModels)) {
      if (cfg.allowedDurations) {
        expect(
          cfg.allowedDurations.length,
          `${key} allowedDurations should not be empty`
        ).toBeGreaterThan(0)
      }
    }
  })

  it("all model keys follow lowercase kebab/dot naming", () => {
    for (const key of ALL_MODEL_KEYS) {
      expect(key, `key "${key}" naming`).toMatch(/^[a-z0-9][a-z0-9._-]*$/)
    }
  })

  it("all models have a valid KIE model ID string", () => {
    for (const [key, cfg] of Object.entries(ALL_MODEL_MAPS)) {
      expect(cfg.model, `${key} model ID`).toBeTruthy()
      expect(typeof cfg.model, `${key} model type`).toBe("string")
    }
  })

  it("no image model key duplicates a video model key", () => {
    const imageKeys = new Set(Object.keys(KIE_IMAGE_MODELS))
    for (const key of Object.keys(KIE_VIDEO_MODELS)) {
      expect(
        imageKeys.has(key),
        `"${key}" appears in both IMAGE and VIDEO maps`
      ).toBe(false)
    }
  })
})
