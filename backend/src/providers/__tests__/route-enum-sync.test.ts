/**
 * Route enum / KIE config sync tests.
 *
 * The "Provider Enum Sync" rule in CLAUDE.md flags 12 places that must be
 * updated when a provider list changes for any node type. The route Zod
 * (step 3) is now imported directly from `@nodaro/shared`, so additions to
 * the shared array automatically reach the route — that bug class is
 * architecturally solved.
 *
 * The remaining drift risk is between **the KIE model registry** and the
 * shared provider arrays. If a developer adds a model to KIE config
 * (`kie/models.ts`) but forgets to add it to the shared list, the model is
 * unreachable: the route Zod rejects it before the router ever sees it.
 *
 * These tests cross-check both directions:
 *   - every KIE-registered model is in the corresponding shared array
 *     (catches: "added to KIE but route Zod rejects it")
 *   - every shared array entry is reachable somewhere — either KIE,
 *     Replicate, or an explicit DIRECT_API exemption (catches: "added to
 *     shared but no provider implementation, route accepts then router
 *     throws")
 *
 * The DIRECT_API_EXEMPTIONS set documents the providers that bypass the
 * providerRegistry path and are dispatched directly from worker handlers
 * (VEO upscale, Replicate-via-direct-SDK lip-sync, ElevenLabs v3).
 */

import { describe, it, expect, vi } from "vitest"

// credits.ts imports supabase + config at module scope (transitively pulled
// in via kie/models.ts → kie/index.ts in some paths). Mock to keep the test
// hermetic.
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
vi.mock("@/ee/billing/stripe-config.js", () => ({
  FREE_TIER_RESTRICTIONS: { blockedModels: [], dailyCreditCap: 10 },
  TIER_STORAGE_LIMITS: {},
}))

import {
  KIE_IMAGE_MODELS,
  KIE_VIDEO_MODELS,
  KIE_TEXT_TO_VIDEO_MODELS,
  KIE_VIDEO_TO_VIDEO_MODELS,
  KIE_MOTION_TRANSFER_MODELS,
  KIE_VIDEO_UPSCALE_MODELS,
  KIE_LIP_SYNC_MODELS,
  KIE_TTS_MODELS,
  KIE_STT_MODELS,
} from "../kie/models.js"
import {
  IMAGE_GEN_PROVIDERS,
  IMAGE_I2I_PROVIDERS,
  IMAGE_EDIT_PROVIDERS,
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  VIDEO_TO_VIDEO_PROVIDERS,
  VIDEO_UPSCALE_PROVIDERS,
  MOTION_TRANSFER_PROVIDERS,
  LIP_SYNC_PROVIDERS,
  TTS_PROVIDERS,
  TRANSCRIBE_PROVIDERS,
} from "@nodaro/shared"

/**
 * Providers in the shared list that DO NOT go through providerRegistry.
 * These are dispatched directly from worker handlers — they are reachable
 * via routes (Zod accepts them) but unregistered with KIE / Replicate's
 * supportedModels. Add a comment per entry so future readers know why.
 */
const DIRECT_API_EXEMPTIONS = new Set<string>([
  // ── Video upscale ──────────────────────────────────────────────────────
  // VEO upscale uses the special VEO endpoint via workers/handlers/video-ai.ts,
  // NOT the standard KIE jobs/createTask flow. They appear in the route Zod
  // (VIDEO_UPSCALE_PROVIDERS) but are not in KIE_VIDEO_UPSCALE_MODELS.
  "veo-1080p",
  "veo-4k",
  // ── Lip sync ───────────────────────────────────────────────────────────
  // Replicate-direct lip-sync providers — implemented in
  // backend/src/providers/replicate/lip-sync.ts and dispatched directly from
  // the lip-sync worker, not via providerRegistry.
  "latentsync",
  "wav2lip",
  "video-retalking",
  "sadtalker",
  // Seedance 2 / 2-fast — go through the i2v worker with audio plumbed
  // as reference_audio_urls. They appear in LIP_SYNC_PROVIDERS for UX
  // purposes but the lip-sync route delegates to the i2v code path.
  "seedance-2",
  "seedance-2-fast",
  // ── TTS ────────────────────────────────────────────────────────────────
  // ElevenLabs v3 routes through ElevenLabs direct API
  // (backend/src/providers/elevenlabs/direct-tts.ts), not via KIE.
  "elevenlabs-v3",
  // Bare "elevenlabs" was a legacy alias kept for backwards compat — it
  // resolves at runtime to one of the v2/v3 variants.
  "elevenlabs",
  // ── Replicate i2v ─────────────────────────────────────────────────────
  // Kling 3 Omni goes through backend/src/providers/replicate/video.ts,
  // not the KIE registry. It's in IMAGE_TO_VIDEO_PROVIDERS for Zod/UI but
  // dispatched via the replicate provider directly in the i2v worker.
  "kling-3-omni",
])

/**
 * Models that are registered in `kie/models.ts` but not in any shared
 * provider array — meaning they're configured at the provider layer (cost,
 * pricing, KIE model id) but UNREACHABLE through any route. This is dead
 * or half-wired code: someone added the KIE config + pricing but never
 * added it to a route's Zod enum or a frontend dropdown.
 *
 * Adding entries here is a STOPGAP — the right fix is to either (a) wire
 * the model up by adding it to the appropriate shared array + frontend
 * dropdown, or (b) remove it from `kie/models.ts` and pricing.
 *
 * Empty for now — grok-upscale was wired up properly in IMAGE_EDIT_PROVIDERS.
 */
const KIE_DEAD_CODE: ReadonlySet<string> = new Set<string>([])

// ---------------------------------------------------------------------------
// 1) Every KIE-registered model must appear in the corresponding shared
//    provider array — otherwise the route Zod rejects requests for that
//    model and KIE's claim of support is unreachable.
// ---------------------------------------------------------------------------

describe("KIE registered models ⊆ shared provider arrays", () => {
  it("KIE_VIDEO_MODELS ⊆ IMAGE_TO_VIDEO_PROVIDERS", () => {
    const shared = new Set<string>(IMAGE_TO_VIDEO_PROVIDERS)
    const orphans = Object.keys(KIE_VIDEO_MODELS).filter((k) => !shared.has(k))
    expect(orphans, `KIE registers these i2v models but they're missing from IMAGE_TO_VIDEO_PROVIDERS — the route Zod will reject all requests using them: ${orphans.join(", ")}`).toEqual([])
  })

  it("KIE_TEXT_TO_VIDEO_MODELS ⊆ TEXT_TO_VIDEO_PROVIDERS", () => {
    const shared = new Set<string>(TEXT_TO_VIDEO_PROVIDERS)
    const orphans = Object.keys(KIE_TEXT_TO_VIDEO_MODELS).filter((k) => !shared.has(k))
    expect(orphans, `KIE registers these t2v models but they're missing from TEXT_TO_VIDEO_PROVIDERS: ${orphans.join(", ")}`).toEqual([])
  })

  it("KIE_VIDEO_TO_VIDEO_MODELS ⊆ VIDEO_TO_VIDEO_PROVIDERS", () => {
    const shared = new Set<string>(VIDEO_TO_VIDEO_PROVIDERS)
    const orphans = Object.keys(KIE_VIDEO_TO_VIDEO_MODELS).filter((k) => !shared.has(k))
    expect(orphans, `KIE registers these v2v models but they're missing from VIDEO_TO_VIDEO_PROVIDERS: ${orphans.join(", ")}`).toEqual([])
  })

  it("KIE_MOTION_TRANSFER_MODELS ⊆ MOTION_TRANSFER_PROVIDERS", () => {
    const shared = new Set<string>(MOTION_TRANSFER_PROVIDERS)
    const orphans = Object.keys(KIE_MOTION_TRANSFER_MODELS).filter((k) => !shared.has(k))
    expect(orphans, `KIE registers these motion-transfer models but they're missing from MOTION_TRANSFER_PROVIDERS: ${orphans.join(", ")}`).toEqual([])
  })

  it("KIE_VIDEO_UPSCALE_MODELS ⊆ VIDEO_UPSCALE_PROVIDERS", () => {
    const shared = new Set<string>(VIDEO_UPSCALE_PROVIDERS)
    const orphans = Object.keys(KIE_VIDEO_UPSCALE_MODELS).filter((k) => !shared.has(k))
    expect(orphans, `KIE registers these upscale models but they're missing from VIDEO_UPSCALE_PROVIDERS: ${orphans.join(", ")}`).toEqual([])
  })

  it("KIE_LIP_SYNC_MODELS ⊆ LIP_SYNC_PROVIDERS", () => {
    const shared = new Set<string>(LIP_SYNC_PROVIDERS)
    const orphans = Object.keys(KIE_LIP_SYNC_MODELS).filter((k) => !shared.has(k))
    expect(orphans, `KIE registers these lip-sync models but they're missing from LIP_SYNC_PROVIDERS: ${orphans.join(", ")}`).toEqual([])
  })

  it("KIE_TTS_MODELS ⊆ TTS_PROVIDERS", () => {
    const shared = new Set<string>(TTS_PROVIDERS)
    const orphans = Object.keys(KIE_TTS_MODELS).filter((k) => !shared.has(k))
    expect(orphans, `KIE registers these TTS models but they're missing from TTS_PROVIDERS: ${orphans.join(", ")}`).toEqual([])
  })

  it("KIE_STT_MODELS ⊆ TRANSCRIBE_PROVIDERS", () => {
    const shared = new Set<string>(TRANSCRIBE_PROVIDERS)
    const orphans = Object.keys(KIE_STT_MODELS).filter((k) => !shared.has(k))
    expect(orphans, `KIE registers these STT models but they're missing from TRANSCRIBE_PROVIDERS: ${orphans.join(", ")}`).toEqual([])
  })

  // KIE_IMAGE_MODELS is split: t2i variants must be in IMAGE_GEN_PROVIDERS;
  // i2i variants must be in IMAGE_I2I_PROVIDERS or IMAGE_EDIT_PROVIDERS.
  it("KIE_IMAGE_MODELS (text-to-image variants) ⊆ IMAGE_GEN_PROVIDERS", () => {
    const sharedT2I = new Set<string>(IMAGE_GEN_PROVIDERS)
    const t2iKeys = Object.entries(KIE_IMAGE_MODELS)
      .filter(([, cfg]) => cfg.inputType !== "image-to-image")
      .map(([k]) => k)
    const orphans = t2iKeys.filter((k) => !sharedT2I.has(k))
    expect(orphans, `KIE registers these T2I image models but they're missing from IMAGE_GEN_PROVIDERS: ${orphans.join(", ")}`).toEqual([])
  })

  it("KIE_IMAGE_MODELS (image-to-image variants) ⊆ IMAGE_I2I_PROVIDERS ∪ IMAGE_EDIT_PROVIDERS", () => {
    const sharedI2I = new Set<string>([...IMAGE_I2I_PROVIDERS, ...IMAGE_EDIT_PROVIDERS])
    const i2iKeys = Object.entries(KIE_IMAGE_MODELS)
      .filter(([, cfg]) => cfg.inputType === "image-to-image")
      .map(([k]) => k)
    const orphans = i2iKeys.filter(
      (k) => !sharedI2I.has(k) && !KIE_DEAD_CODE.has(k),
    )
    expect(orphans, `KIE registers these I2I image models but they're missing from IMAGE_I2I_PROVIDERS ∪ IMAGE_EDIT_PROVIDERS: ${orphans.join(", ")}`).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2) Every shared provider entry must be reachable — either via KIE,
//    Replicate, or an explicit DIRECT_API_EXEMPTIONS entry. Otherwise the
//    route Zod accepts the request but the router throws "not supported by
//    any registered provider" at execution time.
// ---------------------------------------------------------------------------

function checkReverseSync(
  label: string,
  shared: readonly string[],
  registeredKeys: string[],
  registeredVia: string,
) {
  it(`every entry in ${label} is registered via ${registeredVia} or in DIRECT_API_EXEMPTIONS`, () => {
    const registered = new Set(registeredKeys)
    const unreachable = shared.filter(
      (s) => !registered.has(s) && !DIRECT_API_EXEMPTIONS.has(s),
    )
    expect(
      unreachable,
      `These ${label} entries pass route Zod but no provider implementation exists — routeAndExecute would throw "Model not supported by any registered provider". Either register them in ${registeredVia}, add an explicit case in the worker, or document them in DIRECT_API_EXEMPTIONS: ${unreachable.join(", ")}`,
    ).toEqual([])
  })
}

describe("shared provider arrays ⊆ KIE registered (with documented exemptions)", () => {
  checkReverseSync(
    "IMAGE_TO_VIDEO_PROVIDERS",
    IMAGE_TO_VIDEO_PROVIDERS,
    Object.keys(KIE_VIDEO_MODELS),
    "KIE_VIDEO_MODELS",
  )

  checkReverseSync(
    "TEXT_TO_VIDEO_PROVIDERS",
    TEXT_TO_VIDEO_PROVIDERS,
    Object.keys(KIE_TEXT_TO_VIDEO_MODELS),
    "KIE_TEXT_TO_VIDEO_MODELS",
  )

  checkReverseSync(
    "VIDEO_TO_VIDEO_PROVIDERS",
    VIDEO_TO_VIDEO_PROVIDERS,
    Object.keys(KIE_VIDEO_TO_VIDEO_MODELS),
    "KIE_VIDEO_TO_VIDEO_MODELS",
  )

  checkReverseSync(
    "MOTION_TRANSFER_PROVIDERS",
    MOTION_TRANSFER_PROVIDERS,
    Object.keys(KIE_MOTION_TRANSFER_MODELS),
    "KIE_MOTION_TRANSFER_MODELS",
  )

  checkReverseSync(
    "VIDEO_UPSCALE_PROVIDERS",
    VIDEO_UPSCALE_PROVIDERS,
    Object.keys(KIE_VIDEO_UPSCALE_MODELS),
    "KIE_VIDEO_UPSCALE_MODELS",
  )

  checkReverseSync(
    "LIP_SYNC_PROVIDERS",
    LIP_SYNC_PROVIDERS,
    Object.keys(KIE_LIP_SYNC_MODELS),
    "KIE_LIP_SYNC_MODELS",
  )

  checkReverseSync(
    "TTS_PROVIDERS",
    TTS_PROVIDERS,
    Object.keys(KIE_TTS_MODELS),
    "KIE_TTS_MODELS",
  )

  checkReverseSync(
    "TRANSCRIBE_PROVIDERS",
    TRANSCRIBE_PROVIDERS,
    Object.keys(KIE_STT_MODELS),
    "KIE_STT_MODELS",
  )
})

// ---------------------------------------------------------------------------
// 3) DIRECT_API_EXEMPTIONS integrity — every exempted entry should still be
//    in some shared list. Otherwise the exemption is dead code and obscures
//    what's actually load-bearing.
// ---------------------------------------------------------------------------

describe("DIRECT_API_EXEMPTIONS integrity", () => {
  it("every exempted provider is still referenced in at least one shared list", () => {
    const allShared = new Set<string>([
      ...IMAGE_GEN_PROVIDERS,
      ...IMAGE_I2I_PROVIDERS,
      ...IMAGE_EDIT_PROVIDERS,
      ...IMAGE_TO_VIDEO_PROVIDERS,
      ...TEXT_TO_VIDEO_PROVIDERS,
      ...VIDEO_TO_VIDEO_PROVIDERS,
      ...MOTION_TRANSFER_PROVIDERS,
      ...VIDEO_UPSCALE_PROVIDERS,
      ...LIP_SYNC_PROVIDERS,
      ...TTS_PROVIDERS,
      ...TRANSCRIBE_PROVIDERS,
    ])
    const dead = [...DIRECT_API_EXEMPTIONS].filter((p) => !allShared.has(p))
    expect(
      dead,
      `These DIRECT_API_EXEMPTIONS entries are no longer referenced in any shared list — remove them: ${dead.join(", ")}`,
    ).toEqual([])
  })
})

describe("KIE_DEAD_CODE integrity", () => {
  it("every dead-code entry is still actually registered in KIE", () => {
    const allKie = new Set<string>([
      ...Object.keys(KIE_IMAGE_MODELS),
      ...Object.keys(KIE_VIDEO_MODELS),
      ...Object.keys(KIE_TEXT_TO_VIDEO_MODELS),
      ...Object.keys(KIE_VIDEO_TO_VIDEO_MODELS),
      ...Object.keys(KIE_MOTION_TRANSFER_MODELS),
      ...Object.keys(KIE_VIDEO_UPSCALE_MODELS),
      ...Object.keys(KIE_LIP_SYNC_MODELS),
      ...Object.keys(KIE_TTS_MODELS),
      ...Object.keys(KIE_STT_MODELS),
    ])
    const removed = [...KIE_DEAD_CODE].filter((p) => !allKie.has(p))
    expect(
      removed,
      `These KIE_DEAD_CODE entries are no longer in KIE config — remove the exemption: ${removed.join(", ")}`,
    ).toEqual([])
  })
})
