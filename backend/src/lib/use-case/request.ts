/**
 * A use-case run's request (decided 2026-10-13): the continue body (the run
 * bodies are bodies.ts, one per type) and the preparation every route shares
 * — probe the recording (what streams it really carries, how long it is),
 * refuse what the chain cannot run, resolve the settings, build the type's
 * graph from its descriptor. No row, no hold.
 */
import { z } from "zod"
import {
  TRAILER_INTRO_CARD_MAX_SEC,
  usecaseDescriptor,
  type UseCaseGraph,
  type UseCaseMediaKind,
  type UseCaseNodeType,
  type UseCaseSettings,
  type UseCaseSources,
} from "@nodaro/render-rules"
import { probeMediaDuration, probeMediaStreams } from "../../providers/video/ffmpeg-utils.js"
import type { UseCaseBody } from "./bodies.js"

/**
 * POST <the type's route>/continue: continue a run of yours — from where it
 * failed, or its Render final after a review. The run is named by its wrapper
 * job; the graph is the snapshot that run stored, never one rebuilt here.
 */
export const usecaseContinueBody = z.object({
  jobId: z.string().uuid(),
  mode: z.enum(["from-failed", "render-final"]),
  /** Render final only: the reviewer's edit of the plan, applied by its basis. */
  editedEdl: z.unknown().optional(),
  // Honoured on the internal lane only (the backend engine); ignored from any other caller.
  componentDepth: z.number().int().min(0).max(5).optional(),
  executingComponentIds: z.array(z.string()).max(10).optional(),
  previewStopRule: z.boolean().optional(),
  reviewerPresent: z.boolean().optional(),
  billingContext: z.unknown().optional(),
  // The usual job stamps.
  userId: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
  nodeId: z.string().max(200).optional(),
  mcp_client: z.string().max(200).optional(),
}).refine((b) => b.mode === "render-final" || b.editedEdl === undefined || b.editedEdl === null, {
  message: "editedEdl applies to a Render final only (mode: \"render-final\")",
  path: ["editedEdl"],
})
export type UseCaseContinueBody = z.infer<typeof usecaseContinueBody>

export type PreparedUseCase =
  | { readonly ok: true; readonly settings: UseCaseSettings; readonly sources: UseCaseSources; readonly graph: UseCaseGraph }
  | { readonly ok: false; readonly status: 400 | 403 | 503; readonly code: string; readonly message: string }

const refuse = (code: string, message: string): PreparedUseCase => ({ ok: false, status: 400, code, message })

/** An intro card no longer than this (a still image's frame) is not a video. */
export const INTRO_CARD_MIN_SEC = 0.1

/**
 * Whether someone can review this run's preview (decided 2026-10-13) — the
 * one place a use-case route derives it, for any type's resolved settings. A
 * caller outside any run reviews their own run: present exactly when they
 * asked for review. Inside another run (the internal lane) only that run's
 * own answer counts, and only a literal `true`.
 */
export function usecaseReviewerPresent(
  settings: { readonly reviewBeforeRender?: unknown },
  lane: { readonly internal: boolean; readonly forwarded: unknown },
): boolean {
  if (settings.reviewBeforeRender !== true) return false
  return lane.internal ? lane.forwarded === true : true
}

/** Probe the recording (and any optional input), refuse what the chain cannot run, build the type's graph. No row, no hold. */
export async function prepareUseCase(type: UseCaseNodeType, body: UseCaseBody): Promise<PreparedUseCase> {
  const d = usecaseDescriptor(type)
  const mediaUrl = body.mediaUrls[0]!
  let streams: { hasVideo: boolean; hasAudio: boolean }
  try {
    streams = await probeMediaStreams(mediaUrl)
  } catch {
    return refuse("media_unreadable", "The recording could not be read. Check that the link opens and is a video or audio file.")
  }
  if (!streams.hasAudio) return refuse("media_has_no_audio", "The recording has no sound to transcribe.")
  if (d.needsVideo && !streams.hasVideo) return refuse("media_needs_video", `${d.label} needs a video recording.`)
  const durationSec = await probeMediaDuration(mediaUrl)
    .then((s) => (Number.isFinite(s) && s > 0 ? s : undefined))
    .catch(() => undefined)
  if (durationSec !== undefined && durationSec > d.maxSourceSec) {
    return refuse("media_too_long", `${d.label} takes recordings up to ${Math.round(d.maxSourceSec / 3600)} hours.`)
  }
  if (body.musicUrl) {
    const music = await probeMediaStreams(body.musicUrl).catch(() => null)
    if (!music?.hasAudio) return refuse("music_has_no_audio", "The music file could not be read as audio.")
  }
  let introCardSec: number | undefined
  if (body.introCardUrl) {
    // A video that plays (decided 2026-10-14: no still image). A still probes
    // as a video stream, so its length tells it apart: none, or a frame's.
    const card = await probeMediaStreams(body.introCardUrl).catch(() => null)
    const cardSec = card?.hasVideo ? await probeMediaDuration(body.introCardUrl).catch(() => undefined) : undefined
    if (!card?.hasVideo || !(typeof cardSec === "number" && Number.isFinite(cardSec) && cardSec > INTRO_CARD_MIN_SEC)) {
      return refuse("intro_card_unreadable", "The intro card could not be read as a video.")
    }
    // A short title card, never a second episode (decided 2026-10-18).
    if (cardSec > TRAILER_INTRO_CARD_MAX_SEC) {
      return refuse("intro_card_too_long", `The intro card is too long. Use a card of ${TRAILER_INTRO_CARD_MAX_SEC} seconds or less.`)
    }
    introCardSec = cardSec
  }
  const kind: UseCaseMediaKind = streams.hasVideo ? "video" : "audio"
  const settings = d.resolveSettings(body, kind)
  const sources: UseCaseSources = {
    media: { url: mediaUrl, kind, ...(durationSec !== undefined ? { durationSec } : {}) },
    ...(body.musicUrl ? { music: { url: body.musicUrl } } : {}),
    // Its probed length rides on the built card, so a quote prices Combine Videos on it.
    ...(body.introCardUrl ? { introCard: { url: body.introCardUrl, ...(introCardSec !== undefined ? { durationSec: introCardSec } : {}) } } : {}),
  }
  return { ok: true, settings, sources, graph: d.build(settings, sources) }
}
