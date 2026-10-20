/**
 * A use-case run's request (decided 2026-10-13): the continue body (the run
 * bodies are bodies.ts, one per type) and the preparation every route shares
 * — probe every recording (what streams it really carries, how long it is)
 * and the optional inputs, refuse what the chain cannot run, resolve the
 * settings, build the type's graph from its descriptor. No row, no hold.
 */
import { z } from "zod"
import {
  TRAILER_INTRO_CARD_MAX_SEC,
  speakerViewClipRefusal,
  usecaseDescriptor,
  usecaseDistinctMaster,
  usecaseIsMulticam,
  usecaseRecordingsKind,
  usecaseRecordingsProblem,
  speakerViewVideoModeLive,
  usecaseRenderNodeId,
  type UseCaseDescriptor,
  type UseCaseGraph,
  type UseCaseMediaKind,
  type UseCaseMediaSource,
  type UseCaseNodeType,
  type UseCaseSettings,
  type UseCaseSources,
} from "@nodaro/render-rules"
import { probeMediaDuration, probeMediaStreams } from "../../providers/video/ffmpeg-utils.js"
import { ClipMeasureError, type MeasuredClip } from "../clip-measure.js"
import type { UseCaseBody } from "./bodies.js"
import { usecaseSourcesOf } from "./sources.js"
import { camerasShape } from "./body-shapes.js"

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

/**
 * How a preparation measures the one recording a whole-clip render frames
 * (decided 2026-10-20). The caller decides, and must: an estimate passes the
 * cache only (`peekClip`, never a download), a run the measurement the
 * dispatch reads (`measureClip(url)`, the same cache key, so one download per
 * recording per hour), behind the start limit. Null is "not measured": no
 * shape refusal here — the estimate quotes, the run's Speaker View refuses.
 * A `ClipMeasureError` is the recording's refusal (`media_unreadable`).
 */
export interface PrepareUseCaseOptions {
  readonly measureWholeClip: (url: string) => Promise<MeasuredClip | null>
}

/**
 * The one recording a preparation measures, or null when it measures none:
 * a render that frames one recording whole (`wholeClipRender`) on exactly one
 * recording with no Master audio, while Speaker View's video mode may run (as
 * its dispatch, `speakerViewClipOfRun`, gates it — a run that will be refused
 * anyway downloads nothing). The route asks it before the start limit and
 * `prepareUseCase` before measuring, so the two never disagree.
 */
export function usecaseWholeClipUrl(
  type: UseCaseNodeType,
  body: Pick<UseCaseBody, "mediaUrls" | "masterAudioUrl">,
  videoModeLive: boolean = speakerViewVideoModeLive(),
): string | null {
  if (!usecaseDescriptor(type).wholeClipRender || !videoModeLive) return null
  if (body.mediaUrls.length !== 1 || usecaseDistinctMaster(body.masterAudioUrl, body.mediaUrls)) return null
  return body.mediaUrls[0]!
}

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

/** A recording's place in a refusal: its 1-based position when the run has several, else none (one recording is refused exactly as it always was). */
const recordingName = (position: number | null): string => (position === null ? "The recording" : `Recording ${position}`)

/** What one recording carries, or its refusal. */
async function probeRecordingStreams(url: string, position: number | null): Promise<{ hasVideo: boolean } | PreparedUseCase> {
  let streams: { hasVideo: boolean; hasAudio: boolean }
  try {
    streams = await probeMediaStreams(url)
  } catch {
    return refuse("media_unreadable", `${recordingName(position)} could not be read. Check that the link opens and is a video or audio file.`)
  }
  if (!streams.hasAudio) return refuse("media_has_no_audio", `${recordingName(position)} has no sound to transcribe.`)
  return { hasVideo: streams.hasVideo }
}

/** A probed length in seconds; undefined when the probe gives none. */
const lengthOf = (url: string): Promise<number | undefined> =>
  probeMediaDuration(url)
    .then((s) => (Number.isFinite(s) && s > 0 ? s : undefined))
    .catch(() => undefined)

const tooLong = (d: UseCaseDescriptor, what: string | null): PreparedUseCase => {
  const limit = `${d.label} takes recordings up to ${Math.round(d.maxSourceSec / 3600)} hours.`
  return refuse("media_too_long", what === null ? limit : `${what} is too long. ${limit}`)
}

const isRefusal = (r: object): r is PreparedUseCase => "ok" in r

/**
 * Probe every recording (and any optional input), refuse what the chain cannot
 * run, build the type's graph. No row, no hold. A render that frames one
 * recording whole (`wholeClipRender`) is held to Speaker View's source-shape
 * rule here, once the graph is built. Several recordings (decided
 * 2026-10-17): what each carries is probed first, then the set is refused if
 * the chain cannot run it (`usecaseRecordingsProblem`), before any length is
 * probed; the run's kind is every recording's (`usecaseRecordingsKind`). A
 * Master audio that is one of the recordings is none (`usecaseDistinctMaster`).
 */
export async function prepareUseCase(type: UseCaseNodeType, body: UseCaseBody, opts: PrepareUseCaseOptions): Promise<PreparedUseCase> {
  const d = usecaseDescriptor(type)
  const several = body.mediaUrls.length > 1
  const masterAudioUrl = usecaseDistinctMaster(body.masterAudioUrl, body.mediaUrls)
  // The Cameras settings are read only by a run on several recordings or a Master audio: only then are they checked.
  if (several || masterAudioUrl) {
    // None (absent or null) is the defaults.
    const cameras = body.cameras === undefined || body.cameras === null ? null : camerasShape.safeParse(body.cameras)
    if (cameras && !cameras.success) {
      return refuse("invalid_cameras", `The Cameras settings are not valid: ${cameras.error.issues.map((i) => `${["cameras", ...i.path].join(".")}: ${i.message}`).join("; ")}`)
    }
  }
  const kinds: UseCaseMediaKind[] = []
  for (const [i, url] of body.mediaUrls.entries()) {
    const probed = await probeRecordingStreams(url, several ? i + 1 : null)
    if (isRefusal(probed)) return probed
    kinds.push(probed.hasVideo ? "video" : "audio")
  }
  const problem = usecaseRecordingsProblem({ kinds, masterAudio: !!masterAudioUrl, cameras: body.cameras })
  if (problem) return refuse(problem.code, problem.message)
  // The run's kind is every recording's: a sound-only recording beside cameras makes a video run.
  const kind = usecaseRecordingsKind(kinds) ?? "audio"
  if (d.needsVideo && kind !== "video") return refuse("media_needs_video", `${d.label} needs a video recording.`)
  const recordings: UseCaseMediaSource[] = []
  for (const [i, url] of body.mediaUrls.entries()) {
    const durationSec = await lengthOf(url)
    if (durationSec !== undefined && durationSec > d.maxSourceSec) return tooLong(d, several ? recordingName(i + 1) : null)
    recordings.push({ url, kind: kinds[i]!, ...(durationSec !== undefined ? { durationSec } : {}) })
  }
  let masterAudio: UseCaseMediaSource | undefined
  if (masterAudioUrl) {
    const master = await probeMediaStreams(masterAudioUrl).catch(() => null)
    if (!master?.hasAudio) return refuse("master_audio_unreadable", "The master audio could not be read as audio.")
    // Its length is the plan's clock: Edit Plan is quoted and held on it.
    const durationSec = await lengthOf(masterAudioUrl)
    if (durationSec !== undefined && durationSec > d.maxSourceSec) return tooLong(d, "The master audio")
    masterAudio = { url: masterAudioUrl, kind: "audio", ...(durationSec !== undefined ? { durationSec } : {}) }
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
  const { sources, shape } = usecaseSourcesOf({
    recordings: recordings as [UseCaseMediaSource, ...UseCaseMediaSource[]],
    ...(masterAudio ? { masterAudio } : {}),
    ...(body.musicUrl ? { musicUrl: body.musicUrl } : {}),
    // Its probed length rides on the built card, so a quote prices Combine Videos on it.
    ...(body.introCardUrl ? { introCard: { url: body.introCardUrl, ...(introCardSec !== undefined ? { durationSec: introCardSec } : {}) } } : {}),
  })
  const settings = d.resolveSettings(body, kind, shape)
  const graph = d.build(settings, sources)
  // A render that frames one recording whole (Speaker Layout on one recording): Speaker View's own
  // source-shape rule, up front. Several recordings or a Master audio render Speaker Map's edit, each
  // camera held to that rule by Speaker View at run time.
  const wholeClipUrl = usecaseWholeClipUrl(type, body)
  if (wholeClipUrl !== null) {
    // The one recording `usecaseWholeClipUrl` names is the run's only one: its graph frames it whole.
    if (recordings.length !== 1 || usecaseIsMulticam(sources) || recordings[0]!.url !== wholeClipUrl) {
      throw new Error(`prepareUseCase: a whole-clip render measures exactly one recording (${recordings.length} given)`)
    }
    const shapeRefusal = await wholeClipRefusal(wholeClipUrl, graph, opts.measureWholeClip)
    if (shapeRefusal) return shapeRefusal
  }
  return { ok: true, settings, sources, graph }
}

/**
 * Speaker View's source-shape rule for the one recording a whole-clip render
 * frames (`speakerViewClipRefusal`, the same rule its dispatch applies): the
 * recording measured (by the caller's `measureWholeClip`), then refused when
 * it is no wider than the render's aspect, in Speaker View's own words. A
 * recording that cannot be measured is refused with the measurement's
 * sentence; one not measured is not refused here; any other error is thrown.
 */
async function wholeClipRefusal(
  url: string,
  graph: UseCaseGraph,
  measure: PrepareUseCaseOptions["measureWholeClip"],
): Promise<PreparedUseCase | null> {
  const renderId = usecaseRenderNodeId(graph.outputMap)
  const render = renderId === null ? undefined : graph.nodes.find((n) => n.id === renderId)
  let clip: MeasuredClip | null
  try {
    clip = await measure(url)
  } catch (err) {
    if (err instanceof ClipMeasureError) return refuse("media_unreadable", err.message)
    throw err
  }
  // Not measured (an estimate on an address not yet measured): the run refuses it.
  if (clip === null) return null
  const refusal = speakerViewClipRefusal({ clip, targetAspect: render?.data.targetAspect, requireFaces: false })
  return refusal ? refuse("media_shape", refusal.message) : null
}
