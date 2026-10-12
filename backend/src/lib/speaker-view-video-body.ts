/**
 * `POST /v1/speaker-view` taking a `videoUrl` instead of an `edl` (decided
 * 2026-10-11). The plugin's contract (`edl` required) is unchanged (D8), so
 * the video becomes the one-clip edit HERE, with exactly the checks and the
 * one server-side length measurement a workflow run makes (D16): the same
 * clip builds the same edit, is priced the same and renders the same on every
 * lane.
 *
 * Pure over its two dependencies, so it is tested without a server. The
 * transport (`routes/speaker-view-video-guard.ts`) applies the verdict.
 *
 * Two phases, because the measurement downloads a file and must only run for a
 * caller the server has authenticated (auth is a `preHandler` hook, which runs
 * AFTER every `preValidation` hook):
 *  1. `speakerViewVideoPrecheck` — every check that needs no clip (inputs, the
 *     video-mode gate, the address, the transcript). Cheap, no I/O. It hands the
 *     route's schema a body whose `edl` is the idle one-clip edit.
 *  2. `speakerViewVideoFinish` — the one measurement, then the real edit and the
 *     clip's own refusals. Runs from a route `preHandler`, behind auth and
 *     before the route's own credit guard (which prices the real edit).
 * `speakerViewVideoBody` runs both back to back.
 */
import {
  SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE,
  speakerViewIdleEdit,
  speakerViewInputIssue,
  speakerViewVideoEdit,
  speakerViewVideoTranscriptIssue,
} from "@nodaro/render-rules"
import { ClipMeasureError, type MeasureClipOptions, type MeasuredClip } from "./clip-measure.js"
import { safeUrlSchema } from "./url-validator.js"

export interface SpeakerViewVideoRefusal {
  readonly kind: "refuse"
  readonly status: number
  readonly code: string
  readonly message: string
}

export type SpeakerViewVideoBodyVerdict =
  | { readonly kind: "pass" }
  | SpeakerViewVideoRefusal
  | { readonly kind: "rewrite"; readonly body: Record<string, unknown> }

/** What the cheap phase leaves for the measuring phase: everything the one-clip edit is built from. */
export interface SpeakerViewVideoPending {
  readonly url: string
  readonly transcript: unknown
  readonly targetAspect: unknown
  readonly quality: "proxy" | "final"
}

/**
 * The cheap phase's verdict. `defer` carries the body to hand the route's
 * schema (the videoUrl swapped for the idle one-clip edit, so a schema that
 * requires an `edl` passes) and the facts the measuring phase needs.
 */
export type SpeakerViewVideoPrecheckVerdict =
  | { readonly kind: "pass" }
  | SpeakerViewVideoRefusal
  | { readonly kind: "defer"; readonly body: Record<string, unknown>; readonly pending: SpeakerViewVideoPending }

export interface SpeakerViewVideoBodyDeps {
  /** Whether Speaker View's video mode may run (`speakerViewVideoModeLive`, R15: Speaker View AND
   *  Speaker Frames priced); while it may not, a `videoUrl` is refused before anything is measured. */
  readonly videoModeLive: boolean
  readonly measure: (url: string, opts?: MeasureClipOptions) => Promise<MeasuredClip>
}


const given = (v: unknown) => v !== undefined && v !== null && v !== ""

const refuse = (status: number, code: string, message: string): SpeakerViewVideoRefusal => ({ kind: "refuse", status, code, message })

const parse = (v: unknown): unknown => {
  if (typeof v !== "string") return v
  try { return JSON.parse(v) } catch { return v }
}

export function speakerViewVideoPrecheck(body: unknown, deps: Pick<SpeakerViewVideoBodyDeps, "videoModeLive">): SpeakerViewVideoPrecheckVerdict {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { kind: "pass" }
  const b = body as Record<string, unknown>
  const hasEdl = given(b.edl)
  const hasVideo = given(b.videoUrl)
  // An edl alone is the ordinary request; nothing here applies.
  if (hasEdl && !hasVideo) return { kind: "pass" }
  const input = speakerViewInputIssue({ hasEdl, hasVideo })
  if (input) return refuse(400, "invalid_input", input.message)
  if (!deps.videoModeLive) return refuse(503, "video_mode_not_live", SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE)

  const url = safeUrlSchema.safeParse(b.videoUrl)
  if (!url.success) return refuse(400, "validation_error", "videoUrl must be a public http(s) link to a video file.")

  const transcript = given(b.transcript) ? parse(b.transcript) : undefined
  const missing = speakerViewVideoTranscriptIssue(transcript)
  if (missing) return refuse(missing.code === "no-transcript" ? 400 : 422, missing.code === "no-transcript" ? "transcript_required" : "no_speakers", missing.message)

  const pending: SpeakerViewVideoPending = {
    url: url.data,
    transcript,
    targetAspect: b.targetAspect,
    quality: b.quality === "proxy" ? "proxy" : "final",
  }
  const { videoUrl: _videoUrl, ...rest } = b
  const idle = speakerViewIdleEdit({ url: pending.url, transcript, targetAspect: pending.targetAspect })
  if (!idle) return refuse(400, "validation_error", "videoUrl must be a public http(s) link to a video file.")
  return { kind: "defer", pending, body: { ...rest, edl: idle } }
}

/** The measuring phase: the real edit over the clip's real length, or the sentence that refuses it. */
export async function speakerViewVideoFinish(
  pending: SpeakerViewVideoPending,
  measure: SpeakerViewVideoBodyDeps["measure"],
  opts?: MeasureClipOptions,
): Promise<{ readonly kind: "edit"; readonly edl: unknown } | SpeakerViewVideoRefusal> {
  let clip: MeasuredClip
  try {
    clip = await (opts ? measure(pending.url, opts) : measure(pending.url))
  } catch (err) {
    if (err instanceof ClipMeasureError) return refuse(422, err.code === "too-large" ? "video_too_large" : "video_unreadable", err.message)
    throw err
  }
  const built = speakerViewVideoEdit({ url: pending.url, clip, transcript: pending.transcript, targetAspect: pending.targetAspect })
  if (!built.ok) {
    return refuse(built.code === "source-not-wider" ? 400 : 422, built.code.replaceAll("-", "_"), built.message)
  }
  return { kind: "edit", edl: built.edl }
}

export async function speakerViewVideoBody(body: unknown, deps: SpeakerViewVideoBodyDeps): Promise<SpeakerViewVideoBodyVerdict> {
  const pre = speakerViewVideoPrecheck(body, deps)
  if (pre.kind !== "defer") return pre
  const done = await speakerViewVideoFinish(pre.pending, deps.measure)
  if (done.kind === "refuse") return done
  return { kind: "rewrite", body: { ...pre.body, edl: done.edl } }
}
