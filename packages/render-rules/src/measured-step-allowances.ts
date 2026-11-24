/**
 * Every step whose run measures the file it is given, with what its quote and
 * its charge allow past a planned length — declared together, so one guard
 * (`backend/src/lib/__tests__/measured-overshoot-guard.test.ts`) can hold every
 * step to the same bound and a new step cannot reopen a window:
 *
 *   slack + charge grace − quote grace ≥ MADE_CLIP_OVERSHOOT_SEC[reading]
 *
 * on the reading its run measures, and again on the reading it falls back to
 * when that one cannot be read (Video Upscale's container). A clip made in
 * the run is quoted at its planned length plus the slack; a run measures the
 * file, which can run up to the overshoot past that length, and charges it
 * less its grace: the bound keeps the quote at or above the charge.
 *
 * The fields name the constants each step's own code reads, never a copy:
 * the slack its quote passes the measured walk (`MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC`
 * and its siblings), and the graces its price rules take off a measured or
 * quoted length (`CLIP_PRICE_GRACE_SEC`, `VIDEO_UTILITY_PRICE_GRACE_SEC`,
 * `NEMOTRON_UPWARD_GRACE_SEC`, `NODARO_VIDEO_UPSCALE_CONTAINER_GRACE_SEC`,
 * `TOPAZ_VIDEO_CONTAINER_GRACE_SEC`). The
 * guard pairs the table with sweeps of the steps' real quote and charge rules.
 */
import { CLIP_PRICE_GRACE_SEC } from "@nodaro/shared/media"
import { NEMOTRON_UPWARD_GRACE_SEC } from "@nodaro/shared/credits"
import {
  MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC,
  MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC,
  MEASURED_INPUT_READING,
  NEMOTRON_WIRE_READ_OPTIONS,
  VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC,
  VIDEO_OVERLAY_READING,
  VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC,
  VIDEO_UTILITY_PRICE_GRACE_SEC,
  VIDEO_UTILITY_READING,
  type MeasuredInputStepType,
  type VideoUtilityStepType,
} from "./measured-wire-length"
import { NODARO_VIDEO_UPSCALE_CONTAINER_GRACE_SEC } from "./nodaro-video-upscale-pricing"
import { CONTAINER_FALLBACK_GRACE_SEC } from "./made-clip-overshoot"
import { NODARO_VIDEO_UPSCALE_PROVIDER, TOPAZ_RHEA_VIDEO_UPSCALE_PROVIDER } from "@nodaro/shared/models"
import { TOPAZ_VIDEO_CONTAINER_GRACE_SEC } from "./topaz-pricing"
import { AI_AVATAR_PLANNED_CLIP_SLACK_SEC } from "./ai-avatar-audio"
import type { MeasuredFileReading } from "./video-output-length"

/** One measuring step's allowances past a planned length. */
export interface MeasuringStepAllowance {
  /** The slack its quote adds to each clip a node makes in the run (the measured walk's `plannedClipSlackSec`). */
  readonly plannedClipSlackSec: number
  /** What its run measures of the file (the reading its quote passes the walk). */
  readonly reading: MeasuredFileReading
  /** How far past a price mark its QUOTE still prices the mark (0: it reads the length exactly). */
  readonly quoteGraceSec: number
  /** How far past a price mark its HOLD and CHARGE still price the mark. */
  readonly chargeGraceSec: number
  /** What its run measures, and forgives, when its own reading cannot be read (absent: it refuses the file instead). */
  readonly fallback?: { readonly reading: MeasuredFileReading; readonly chargeGraceSec: number }
}

/**
 * The measuring steps: every step of `MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC`
 * (Video Upscale once per measuring model, each charging by its own rule),
 * Mask Composite, Video Overlay, Trim / Loop / Combine Videos, Transcribe
 * and Add Captions on Nemotron 3.5 (one reading, `NEMOTRON_WIRE_READ_OPTIONS`),
 * and AI Avatar in audio mode.
 */
export type MeasuringStepId =
  | Exclude<MeasuredInputStepType, "video-upscale" | "video-to-video">
  | "video-upscale:topaz"
  | "video-upscale:nodaro"
  | "video-upscale:rhea"
  | "video-to-video:happyhorse-edit"
  | "video-to-video:wan-videoedit"
  | "mask-composite"
  | "video-overlay"
  | VideoUtilityStepType
  | "nemotron"
  | "ai-avatar"

const measuredInput = (step: MeasuredInputStepType, quoteGraceSec: number, chargeGraceSec: number): MeasuringStepAllowance => ({
  plannedClipSlackSec: MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC[step],
  reading: MEASURED_INPUT_READING[step],
  quoteGraceSec,
  chargeGraceSec,
})

const videoUtility = (step: VideoUtilityStepType): MeasuringStepAllowance => ({
  plannedClipSlackSec: VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC,
  reading: VIDEO_UTILITY_READING[step],
  quoteGraceSec: VIDEO_UTILITY_PRICE_GRACE_SEC,
  chargeGraceSec: VIDEO_UTILITY_PRICE_GRACE_SEC,
  // Combine Videos reads each clip's video stream; a clip whose stream length, tag and packets all fail, its container less the fallback's allowance.
  ...(VIDEO_UTILITY_READING[step] === "video-stream"
    ? { fallback: { reading: "container" as const, chargeGraceSec: VIDEO_UTILITY_PRICE_GRACE_SEC + CONTAINER_FALLBACK_GRACE_SEC } }
    : {}),
})

export const MEASURING_STEP_ALLOWANCES: Readonly<Record<MeasuringStepId, MeasuringStepAllowance>> = {
  // Video SFX's rows, Pitch & Tempo's and Dubbing's minutes, Lip Sync's tiers and OmniHuman 2.0's seconds: the quote
  // reads the length exactly, the hold and the charge forgive a hair past a mark (`gracedMeasuredSec`, the tiers' edge).
  "video-sfx": measuredInput("video-sfx", 0, CLIP_PRICE_GRACE_SEC),
  "pitch-tempo": measuredInput("pitch-tempo", 0, CLIP_PRICE_GRACE_SEC),
  "dubbing": measuredInput("dubbing", 0, CLIP_PRICE_GRACE_SEC),
  "lip-sync": measuredInput("lip-sync", 0, CLIP_PRICE_GRACE_SEC),
  // Video Mask and Video Depth: `pricedClipSeconds` on the quote and the charge alike.
  "video-mask": measuredInput("video-mask", CLIP_PRICE_GRACE_SEC, CLIP_PRICE_GRACE_SEC),
  "video-depth": measuredInput("video-depth", CLIP_PRICE_GRACE_SEC, CLIP_PRICE_GRACE_SEC),
  // Motion Transfer's driving video: its billed seconds (`motionTransferBilledSeconds`) on the quote and the charge alike.
  "motion-transfer": measuredInput("motion-transfer", CLIP_PRICE_GRACE_SEC, CLIP_PRICE_GRACE_SEC),
  // Video to Video, its clip's billed seconds (`videoToVideoBilledSeconds`) on the quote and the charge alike:
  // HappyHorse Edit's started half-seconds forgive nothing; Wan 2.7 VideoEdit's whole seconds forgive 0.05 s.
  "video-to-video:happyhorse-edit": measuredInput("video-to-video", 0, 0),
  "video-to-video:wan-videoedit": measuredInput("video-to-video", CLIP_PRICE_GRACE_SEC, CLIP_PRICE_GRACE_SEC),
  // Audio Isolation's audio: its started ten seconds (`audioIsolationUnits`) on the quote and the charge alike.
  "audio-isolation": measuredInput("audio-isolation", CLIP_PRICE_GRACE_SEC, CLIP_PRICE_GRACE_SEC),
  // Voice Changer's audio (a video's when it is given one): its started ten seconds (`voiceChangerUnits`), as Audio Isolation's.
  "voice-changer": measuredInput("voice-changer", CLIP_PRICE_GRACE_SEC, CLIP_PRICE_GRACE_SEC),
  // Topaz: frames of the video stream on the quote and the hold, none forgiven; a stream with no length, the container's frames less its allowance.
  "video-upscale:topaz": { ...measuredInput("video-upscale", 0, 0), fallback: { reading: "container", chargeGraceSec: TOPAZ_VIDEO_CONTAINER_GRACE_SEC } },
  // Nodaro Video Upscale: the stream's seconds rounded up; a stream with no length, the container's less its allowance.
  "video-upscale:nodaro": { ...measuredInput("video-upscale", 0, 0), fallback: { reading: "container", chargeGraceSec: NODARO_VIDEO_UPSCALE_CONTAINER_GRACE_SEC } },
  // Topaz Rhea: the stream's seconds rounded up (`topazRheaBilledSec`); a stream with no length, the container's less its allowance.
  "video-upscale:rhea": { ...measuredInput("video-upscale", 0, 0), fallback: { reading: "container", chargeGraceSec: CONTAINER_FALLBACK_GRACE_SEC } },
  "mask-composite": { plannedClipSlackSec: MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC, reading: "container", quoteGraceSec: CLIP_PRICE_GRACE_SEC, chargeGraceSec: CLIP_PRICE_GRACE_SEC },
  // Video Overlay: its base's video stream; a base whose stream length, tag and packets all fail, its container less the fallback's allowance.
  "video-overlay": {
    plannedClipSlackSec: VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC,
    reading: VIDEO_OVERLAY_READING,
    quoteGraceSec: CLIP_PRICE_GRACE_SEC,
    chargeGraceSec: CLIP_PRICE_GRACE_SEC,
    fallback: { reading: "container", chargeGraceSec: CLIP_PRICE_GRACE_SEC + CONTAINER_FALLBACK_GRACE_SEC },
  },
  "trim-video": videoUtility("trim-video"),
  "loop-video": videoUtility("loop-video"),
  "combine-videos": videoUtility("combine-videos"),
  // No slack: the hold and the charge forgive a second past a minute (`nemotronHeldMinutes`).
  "nemotron": { plannedClipSlackSec: NEMOTRON_WIRE_READ_OPTIONS.plannedClipSlackSec ?? 0, reading: "container", quoteGraceSec: 0, chargeGraceSec: NEMOTRON_UPWARD_GRACE_SEC },
  // AI Avatar: every started second of the sound, its duration bucket, none forgiven on either side.
  "ai-avatar": { plannedClipSlackSec: AI_AVATAR_PLANNED_CLIP_SLACK_SEC, reading: "container", quoteGraceSec: 0, chargeGraceSec: 0 },
}

/**
 * What a measuring step reads the measured walk with — its slack and its
 * reading, from its row: the ONE way any estimate reads the walk with a slack
 * (the server's run estimate and listing, the editor's quote). A new step
 * reads the walk only by naming its `MeasuringStepId`, which a row must exist
 * for, so it is held by the overshoot guard from its first line.
 */
export function measuringStepReadOptions(step: MeasuringStepId): { readonly plannedClipSlackSec: number; readonly reading: MeasuredFileReading } {
  const { plannedClipSlackSec, reading } = MEASURING_STEP_ALLOWANCES[step]
  return { plannedClipSlackSec, reading }
}

/**
 * The row of a step of `MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC`: Video Upscale's
 * by its model (Nodaro Video Upscale, Topaz Rhea, else Topaz); Video to Video's by its
 * model (HappyHorse Edit, else Wan 2.7 VideoEdit — the only two that read
 * their clip).
 */
export function measuredInputStepId(type: MeasuredInputStepType, provider?: unknown): MeasuringStepId {
  if (type === "video-to-video") return provider === "happyhorse-edit" ? "video-to-video:happyhorse-edit" : "video-to-video:wan-videoedit"
  if (type !== "video-upscale") return type
  if (provider === TOPAZ_RHEA_VIDEO_UPSCALE_PROVIDER) return "video-upscale:rhea"
  return provider === NODARO_VIDEO_UPSCALE_PROVIDER ? "video-upscale:nodaro" : "video-upscale:topaz"
}
