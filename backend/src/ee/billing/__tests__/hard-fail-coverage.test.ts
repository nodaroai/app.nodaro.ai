/**
 * Hard-fail policy regression — every credit identifier produced at runtime
 * must have a STATIC_CREDIT_COSTS entry.
 *
 * Context: 2026-05 we adopted a hard-fail policy for missing prices —
 * `getModelCreditBaseCost` now throws `PriceNotConfiguredError` instead of
 * silently defaulting to 1 credit. STATIC_CREDIT_COSTS is the runtime
 * fallback that prevents this, so it MUST cover every (provider, duration,
 * sound, resolution, hasVideoRef, quality, renderingSpeed, llmModel, ...)
 * combination the runtime can compute.
 *
 * This walks the four credit-identifier builders the routes consume and
 * verifies the universe of emitted identifiers is a subset of
 * STATIC_CREDIT_COSTS. A failure here means a route will hard-fail with
 * 503 `price_not_configured` for some legal input — a regression in
 * deployment hygiene.
 *
 * Complementary to `composite-credit-coverage.test.ts` which only covers
 * `buildCreditModelIdentifier` (image). This test covers video, motion,
 * and LLM as well.
 */

import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS } from "../credits.js"
import {
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  IMAGE_GEN_PROVIDERS,
  IMAGE_I2I_PROVIDERS,
  IMAGE_EDIT_PROVIDERS,
  buildVideoCreditModelIdentifier,
  buildMotionCreditModelIdentifier,
  buildCreditModelIdentifier,
  buildLlmCreditIdentifier,
  LLM_MODELS,
} from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Plausible-input matrices for each builder
// ---------------------------------------------------------------------------

const VIDEO_DURATIONS: Array<number | undefined> = [undefined, 4, 5, 6, 8, 10, 12, 15]
const VIDEO_SOUNDS: Array<boolean | undefined> = [undefined, true, false]
const VIDEO_NODE_TYPES: Array<"image-to-video" | "text-to-video" | undefined> = [
  undefined,
  "image-to-video",
  "text-to-video",
]
const VIDEO_MODES: Array<string | undefined> = [undefined, "high", "pro"]
const VIDEO_RESOLUTIONS: Array<string | undefined> = [undefined, "480p", "720p", "1080p"]
const VIDEO_HAS_REFS: Array<boolean | undefined> = [undefined, true, false]

const MOTION_PROVIDERS = ["kling", "kling-3.0", "wan-animate-move", "wan-animate-replace"]
const MOTION_RESOLUTIONS = ["480p", "580p", "720p", "1080p"]
const MOTION_DURATIONS: Array<number | undefined> = [undefined, 5, 10, 15, 30]

const IMAGE_QUALITIES: Array<string | undefined> = [undefined, "medium", "high"]
const IMAGE_RESOLUTIONS: Array<string | undefined> = [undefined, "1K", "2K", "4K"]
const IMAGE_RENDERING_SPEEDS: Array<string | undefined> = [
  undefined,
  "BALANCED",
  "TURBO",
  "QUALITY",
]
const IMAGE_TARGET_RESOLUTIONS: Array<string | undefined> = [undefined, "2K", "4K", "8K"]

const LLM_FEATURES = [
  "prompt-helper",
  "ai-writer",
  "llm-chat",
  "translate",
  "scene-graph-ai",
  "video-composer",
  "after-effects",
  "lottie-overlay",
  "3d-title",
  "motion-graphics",
  "qa-check",
  "generate-script",
  "image-to-text",
]

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("hard-fail policy: every runtime-emitted credit identifier is in STATIC_CREDIT_COSTS", () => {
  it("video / motion / image / LLM coverage", () => {
    const missing = new Map<string, string[]>()
    const seen = new Set<string>()

    function check(id: string, source: string) {
      if (seen.has(id)) return
      seen.add(id)
      if (STATIC_CREDIT_COSTS[id] === undefined) {
        if (!missing.has(id)) missing.set(id, [])
        missing.get(id)!.push(source)
      }
    }

    // VIDEO (i2v + t2v)
    const videoProviders = new Set<string>([...IMAGE_TO_VIDEO_PROVIDERS, ...TEXT_TO_VIDEO_PROVIDERS])
    for (const provider of videoProviders) {
      for (const duration of VIDEO_DURATIONS) {
        for (const sound of VIDEO_SOUNDS) {
          for (const nodeType of VIDEO_NODE_TYPES) {
            for (const mode of VIDEO_MODES) {
              for (const resolution of VIDEO_RESOLUTIONS) {
                for (const hasRef of VIDEO_HAS_REFS) {
                  const id = buildVideoCreditModelIdentifier(
                    provider,
                    duration,
                    sound,
                    nodeType,
                    mode,
                    resolution,
                    hasRef,
                  )
                  check(
                    id,
                    `video ${provider} d=${duration} s=${sound} nt=${nodeType} m=${mode} r=${resolution} ref=${hasRef}`,
                  )
                }
              }
            }
          }
        }
      }
    }

    // MOTION (Kling 2.6 + 3.0, Wan Animate move/replace)
    for (const provider of MOTION_PROVIDERS) {
      for (const resolution of MOTION_RESOLUTIONS) {
        for (const duration of MOTION_DURATIONS) {
          const id = buildMotionCreditModelIdentifier(provider, resolution, duration)
          check(id, `motion ${provider} r=${resolution} d=${duration}`)
        }
      }
    }

    // IMAGE (gen + i2i + edit)
    const imageProviders = new Set<string>([
      ...IMAGE_GEN_PROVIDERS,
      ...IMAGE_I2I_PROVIDERS,
      ...IMAGE_EDIT_PROVIDERS,
    ])
    for (const provider of imageProviders) {
      for (const quality of IMAGE_QUALITIES) {
        for (const resolution of IMAGE_RESOLUTIONS) {
          for (const renderingSpeed of IMAGE_RENDERING_SPEEDS) {
            for (const targetResolution of IMAGE_TARGET_RESOLUTIONS) {
              const id = buildCreditModelIdentifier(
                provider,
                quality,
                resolution,
                renderingSpeed,
                targetResolution,
              )
              check(
                id,
                `image ${provider} q=${quality} r=${resolution} rs=${renderingSpeed} tr=${targetResolution}`,
              )
            }
          }
        }
      }
    }

    // LLM (every feature × every model)
    for (const feature of LLM_FEATURES) {
      check(buildLlmCreditIdentifier(feature, undefined), `llm ${feature} (no model)`)
      for (const model of LLM_MODELS) {
        const id = buildLlmCreditIdentifier(feature, model.id)
        check(id, `llm ${feature} ${model.id} tier=${model.tier}`)
      }
    }

    // Assertion: nothing missing. The message lists every gap so PR review
    // can see all of them at once.
    const summary = [...missing.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, samples]) => `  - "${id}"  e.g. ${samples[0]}`)
      .join("\n")
    expect(
      missing.size,
      missing.size === 0
        ? "no missing identifiers"
        : `${missing.size} credit identifier(s) the runtime can emit are NOT in STATIC_CREDIT_COSTS. ` +
            `Hard-fail policy (2026-05) means routes will return 503 "price_not_configured" for these inputs. ` +
            `Add an entry to STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts AND a matching ` +
            `INSERT INTO model_pricing migration (per CLAUDE.md "Provider Enum Sync" steps 7 + 9):\n${summary}`,
    ).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Directly-emitted credit identifiers
//
// Some identifiers don't come out of any composite builder — they're written
// directly by route/handler/webhook code (e.g. `character-lora-training` is
// only ever emitted by `routes/character-training.ts`'s creditGuard resolver;
// `flux-lora-character` is only ever set by `payload-builder.ts`'s LoRA swap).
//
// The walker above doesn't enumerate these, so this describe block is the
// regression net: if anyone removes either row from STATIC_CREDIT_COSTS, the
// runtime will 503 with `price_not_configured` and this test will catch it.
// ─────────────────────────────────────────────────────────────────────────────

describe("directly-emitted credit identifiers (not via buildCreditModelIdentifier)", () => {
  const DIRECTLY_EMITTED_IDS = [
    "flux-lora-character",
    "character-lora-training",
  ] as const

  it.each(DIRECTLY_EMITTED_IDS)(
    "%s is present in STATIC_CREDIT_COSTS",
    (id) => {
      expect(STATIC_CREDIT_COSTS[id]).toBeDefined()
      expect(STATIC_CREDIT_COSTS[id]).toBeGreaterThan(0)
    },
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Free inline / control nodes (node-executor.ts INLINE_NODES)
//
// These are pure in-process logic (0cr). A pipeline path prices some of them by
// their BARE node type, so the 2026-05 hard-fail policy throws
// PriceNotConfiguredError if an entry is missing — which stalled prod pipeline
// e06d9ff3 at shot-list scene generation on bare "split-text" (2026-05-27).
// Every free inline node MUST have an explicit 0 entry.
// ─────────────────────────────────────────────────────────────────────────────

describe("free inline / control node identifiers price to 0 (must not hard-fail)", () => {
  const FREE_INLINE_IDS = [
    "combine-text",
    "split-text",
    "composite",
    "extract-field",
    "json-process",
    "filter-list",
    "deduplicate",
    "merge-lists",
    "sort-list",
    "webhook-output",
    "preview",
    "teleport-send",
    "teleport-receive",
    "router",
    "sub-workflow",
  ] as const

  it.each(FREE_INLINE_IDS)("%s is present in STATIC_CREDIT_COSTS as 0", (id) => {
    expect(STATIC_CREDIT_COSTS[id]).toBe(0)
  })
})
