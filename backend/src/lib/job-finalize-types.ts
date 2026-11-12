/**
 * The job types `finalizeJobWithMedia` (lib/job-finalize.ts) dispatches, by
 * the medium it stores: one declaration per medium, and the compile-time union
 * and the runtime sets derived from it — and the provider result it is handed.
 * job-finalize.ts re-exports the public names, so every caller keeps importing
 * them from there.
 */

/**
 * Provider-side input to `finalizeJobWithMedia`. Mirrors the relevant fields
 * of `ProviderResult` (`backend/src/providers/provider.interface.ts`) but
 * pared down to the keys that function actually reads.
 *
 * `extraUrls` carries additional image variants when the provider returned
 * multiple outputs (e.g., GPT-Image n=4). Audio/video providers return a
 * single `url`.
 */
export interface ProviderFinalizeResult {
  url: string
  extraUrls?: readonly string[]
  /** See ProviderResult.autoQualityKieCredits — GPT Image 2.6 at quality Auto. */
  autoQualityKieCredits?: number
  cost: number | null
  /** See ProviderResult.meteredCost — true only for genuine GPU-time providers
   *  (commit trues-up from cost); fixed/composite providers commit reserved. */
  meteredCost?: boolean
  displayCost?: number | null
  providerUsed?: string | null
  kieTaskId?: string
  seed?: number
  fallbackFlag?: boolean
  providerMs?: number
  /** See ProviderResult.relayJobId/relayCredits (provider.interface.ts) — set
   *  ONLY by the NodaroCloud* providers, which relay the work to another
   *  instance. Mirrored here because finalize is where a router-lane result
   *  becomes a row: `relayFieldsFrom` turns the pair into migration 383's two
   *  columns in its completion UPDATE (lib/job-finalize.ts). Absent on every
   *  vendor-direct result, so the mainline write is byte-identical to before. */
  relayJobId?: string
  relayCredits?: number | null
}

/**
 * The three `as const` arrays below are the SINGLE declaration each finalize
 * job-type category derives from: `FinalizeJobType` is `typeof` their union,
 * and the runtime `IMAGE_TYPES`/`VIDEO_TYPES`/`AUDIO_TYPES` sets are built
 * from the same arrays — so a job type added here updates the compile-time
 * union and the runtime set together, and cannot drift between them.
 * Exported so `job-finalize-types.test.ts` can assert the three arrays are
 * pairwise disjoint and jointly cover `FINALIZE_JOB_TYPES`.
 */
export const IMAGE_JOB_TYPES = [
  "generate-image", "image-to-image", "edit-image",
  // `reference-board` is handleGenerateImage under another name
  // (image-ai.ts:372) and finalizes as "generate-image" (:135); the reconcile
  // crons read the ROW's job_type, which is the alias.
  "reference-board",
] as const

export const VIDEO_JOB_TYPES = [
  "image-to-video", "text-to-video", "video-to-video",
  "motion-transfer", "video-upscale", "video-depth", "lip-sync", "extend-video",
  "video-retake", "video-sfx", "ai-avatar", "cinematic-avatar", "switchx",
  // Handlers whose job_type differs from the jobType they pass to finalize:
  // speech-to-video → "image-to-video" (video-ai.ts:891);
  // face-swap → "video-to-video" (video-ai.ts:1404);
  // voiced-video → "image-to-video" (video-ai.ts:1679) — handleVoicedVideo
  // (character-voice orchestration) has exactly ONE completion path, always
  // through finalizeJobWithMedia with this hardcoded jobType (no branch calls
  // its own markJobCompleted), so the alias is safe (Task 5 coverage guard).
  // Sync today: none of its imageToVideo calls registers a reconcile task
  // (video-ai.ts:1462-1469 — the 30-min pre-task sweep is the backstop), so
  // no reconcile tick reaches it. If it ever gains async wiring, settle the
  // voicedAudioAddon refund question (loop-trim P0.3 precedent) at that point:
  // a generic recovery would deliver the raw pre-mux clip.
  "speech-to-video", "face-swap", "voiced-video",
] as const

export const AUDIO_JOB_TYPES = [
  "text-to-speech", "text-to-audio", "generate-music", "voice-clone",
  // NB: "speech-to-text" has no producer today — `transcribe` is the job_type
  // the route and handler map use (routes/transcribe.ts:71,
  // audio-ai.ts:800). Kept for the union's shape; the coverage guard in
  // reconcile/__tests__/finalize-job-type-coverage.test.ts asserts the
  // producer→set direction ONLY, never the reverse.
  "audio-isolation", "speech-to-text", "generate-dialogue",
  // `text-to-dialogue` is handleTextToDialogue under another name
  // (audio-ai.ts:804) and finalizes as "generate-dialogue" (:405). Sync today
  // (no makeOnTaskCreated → no provider_kind), so no reconcile tick reaches
  // it — but it is an ALIAS, not a denial, and listing it here rather than in
  // NOT_GENERIC_RECOVERABLE keeps that honest (M-3a).
  "text-to-dialogue",
  // voice-remix (audio-ai.ts:684) and voice-design (audio-ai.ts:713) are each
  // a single unconditional completion path through finalizeJobWithMedia with
  // jobType "voice-clone" hardcoded — no branch writes its own
  // markJobCompleted, so both are safe aliases (same M-3a shape; found by the
  // Task 5 coverage guard). Contrast with voice-changer and dubbing below,
  // which branch into an OWN markJobCompleted for video-mode output and so
  // are NOT safe generic-finalize aliases. Both are sync today: voice-remix
  // stamps no provider_kind at all; voice-design stamps "elevenlabs-sync"
  // (audio-ai.ts:701), a SYNC kind — so no reconcile tick reaches either.
  "voice-remix", "voice-design",
] as const

/**
 * The set of job types `finalizeJobWithMedia` knows how to finalize. Anything outside
 * this union throws — by design, since the dispatch table has to know whether
 * to upload as image / video / audio. Derived from the three `as const`
 * arrays above via `typeof … [number]` so it cannot drift from them.
 */
export type FinalizeJobType =
  | (typeof IMAGE_JOB_TYPES)[number]
  | (typeof VIDEO_JOB_TYPES)[number]
  | (typeof AUDIO_JOB_TYPES)[number]

/** Each medium's job types as a runtime set: what finalize's dispatch tests a job type against. */
export const IMAGE_TYPES: ReadonlySet<FinalizeJobType> = new Set(IMAGE_JOB_TYPES)

export const VIDEO_TYPES: ReadonlySet<FinalizeJobType> = new Set(VIDEO_JOB_TYPES)

export const AUDIO_TYPES: ReadonlySet<FinalizeJobType> = new Set(AUDIO_JOB_TYPES)

/** Every job type `finalizeJobWithMedia` can dispatch — the runtime twin of
 *  `FinalizeJobType`. Reconcile writers narrow through `isFinalizeJobType`
 *  instead of casting `row.job_type`. */
export const FINALIZE_JOB_TYPES: ReadonlySet<string> = new Set<string>([
  ...IMAGE_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES,
])

export function isFinalizeJobType(v: string | null | undefined): v is FinalizeJobType {
  return typeof v === "string" && FINALIZE_JOB_TYPES.has(v)
}
