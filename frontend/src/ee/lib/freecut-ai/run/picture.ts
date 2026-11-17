/**
 * Picture: a change inside the picture itself (the background, a person,
 * clothes, a car, the sky, the style), made by a video editing model on one
 * shot of the video and laid over that shot on a track above it, with the
 * original sound kept.
 *
 * Video models edit up to ten seconds at a time, so the change is made on the
 * shot under the playhead (the first one when the playhead is at the start),
 * never across a cut, so the lips stay on the voice. Which seconds is said
 * before anything is charged. The render starts as soon as the plan is clear
 * (`startPicture`) and is laid on the Picture agent's turn (`placePicture`).
 */
import { trimVideoApi, videoToVideo } from "@/lib/api"
import { keptRanges, type PictureChange, type SecondsRange, type TimelineView } from "../edit-plan"
import { readTimelineView, timelineFrameOf } from "../edit-plan"
import type { RunContext } from "./context"
import type { EditorLink } from "../editor-link"
import { JobFailed, JobTimedOut, checkStop, pause, waitForJob } from "./jobs"
import type { LatePicture } from "./types"

/** The video editing model: it keeps everything the instruction does not name, and the original sound. */
export const PICTURE_MODEL = "wan-videoedit"
/** The longest shot the model edits. */
export const PICTURE_MAX_SECONDS = 10
const PICTURE_MIN_SECONDS = 2
const TRIM_TIMEOUT_MS = 4 * 60_000
const EDIT_TIMEOUT_MS = 12 * 60_000
/** About how long the model takes: the progress shown while it works. */
export const PICTURE_MS = 150_000

/** The media second under the playhead, when the editor says where the playhead is. */
export function playheadSecond(timeline: TimelineView, mediaId: string, frame: number | undefined): number {
  if (frame === undefined) return 0
  const piece = timeline.items.find((i) => i.type === "video" && i.mediaId === mediaId && i.from <= frame && frame < i.from + i.durationInFrames)
  if (!piece) return 0
  const sourceFps = piece.sourceFps ?? timeline.fps
  return ((piece.sourceStart ?? 0) + (frame - piece.from) * (sourceFps / timeline.fps)) / sourceFps
}

/**
 * The seconds to change: inside the stretch the edit keeps around `at` (no cut
 * crosses it), up to the model's limit, and at least two seconds long. The
 * first stretch long enough when `at`'s is not.
 */
export function pictureSpan(mediaSeconds: number, cuts: readonly SecondsRange[], at: number): SecondsRange | null {
  const kept = keptRanges({ start: 0, end: mediaSeconds }, cuts).filter((r) => r.end - r.start >= PICTURE_MIN_SECONDS)
  const range = kept.find((r) => r.start <= at && at < r.end) ?? kept.find((r) => r.start >= at) ?? kept[0]
  if (!range) return null
  const start = Math.min(Math.max(range.start, at), Math.max(range.start, range.end - PICTURE_MIN_SECONDS))
  return { start, end: Math.min(range.end, start + PICTURE_MAX_SECONDS) }
}

/** The most shots one request changes: more would cost more than a person expects, and look less alike. */
export const PICTURE_MAX_SHOTS = 6

/**
 * The shots a change is made on: up to `count` spans one after the other from
 * `at`, each inside the model's limit and never across a cut.
 */
export function pictureSpans(mediaSeconds: number, cuts: readonly SecondsRange[], at: number, count: number): SecondsRange[] {
  const kept = keptRanges({ start: 0, end: mediaSeconds }, cuts).filter((r) => r.end - r.start >= PICTURE_MIN_SECONDS)
  const spans: SecondsRange[] = []
  let from = at
  // Each turn adds a span or moves on to a later stretch: the turns are bounded by the stretches.
  for (let turn = 0; spans.length < count && turn < count + kept.length + 1; turn++) {
    const last = spans[spans.length - 1]
    const span = pictureSpan(mediaSeconds, cuts, from)
    if (!span) break
    if (!last || span.start >= last.end - 0.001) {
      spans.push(span)
      from = span.end
      continue
    }
    // Too little is left of this stretch for another shot: on to the next stretch.
    const next = kept.find((r) => r.start >= last.end - 0.001)
    if (!next) break
    from = next.start
  }
  return spans
}

/**
 * The seconds a picture change would be made on now, read from the editor's
 * timeline before anything runs: the shots from the playhead on, in the video
 * under it. (A run that also cuts may move them a little.)
 */
export function pictureShotsNow(timeline: TimelineView, count: number): SecondsRange[] {
  const videos = timeline.items.filter((i) => i.type === "video" && i.mediaId).sort((a, b) => a.from - b.from)
  const frame = timeline.currentFrame ?? 0
  const piece = videos.find((i) => i.from <= frame && frame < i.from + i.durationInFrames) ?? videos[0]
  const duration = timeline.media?.find((m) => m.id === piece?.mediaId)?.duration
  if (!piece?.mediaId || !duration) return []
  return pictureSpans(duration, [], playheadSecond(timeline, piece.mediaId, timeline.currentFrame), count)
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
export const spanLabel = (span: SecondsRange) => ({ from: clock(span.start), to: clock(span.end) })

type Point = { readonly x: number; readonly y: number }
const oval = (cx: number, cy: number, rx: number, ry: number): Point[] =>
  Array.from({ length: 17 }, (_, i) => ({ x: cx + rx * Math.cos((i / 16) * Math.PI * 2), y: cy + ry * Math.sin((i / 16) * Math.PI * 2) }))

/**
 * About where in the picture the change is, from the words that name it: the
 * sky is the top, a person or their clothes the middle, a car or the floor
 * the lower part, a background or a style the whole frame. A rough region, not
 * a detection: the line shows what is meant, the model does the finding.
 */
export function regionOf(words: string): Point[] {
  const w = words.toLowerCase()
  if (/\bsky\b|clouds?|שמיים|空|하늘|c[ée]u/u.test(w)) return [{ x: 0.04, y: 0.05 }, { x: 0.96, y: 0.05 }, { x: 0.96, y: 0.36 }, { x: 0.7, y: 0.42 }, { x: 0.3, y: 0.4 }, { x: 0.04, y: 0.36 }, { x: 0.04, y: 0.05 }]
  if (/hair|\bhat\b|face|glasses|שיער|כובע|פנים|髪|顔|머리|얼굴|cabelo|rosto/u.test(w)) return oval(0.5, 0.3, 0.14, 0.2)
  if (/shirt|jacket|dress|clothes|outfit|חולצ|בגד|ז'קט|שמלה|シャツ|服|옷|셔츠|camisa|roupa/u.test(w)) return oval(0.5, 0.66, 0.24, 0.26)
  if (/\bcar\b|vehicle|floor|ground|table|רכב|מכונית|רצפה|שולחן|車|床|자동차|바닥|carro|ch[aã]o|mesa/u.test(w)) return oval(0.5, 0.74, 0.36, 0.2)
  if (/person|presenter|\bman\b|woman|\bhim\b|\bher\b|מגיש|אדם|איש|אישה|人|사람|pessoa|apresentador/u.test(w)) return oval(0.5, 0.52, 0.2, 0.42)
  // A background, a place, a style: the whole frame, around the edges.
  return [{ x: 0.06, y: 0.07 }, { x: 0.94, y: 0.07 }, { x: 0.94, y: 0.93 }, { x: 0.06, y: 0.93 }, { x: 0.06, y: 0.07 }]
}

/** The changed shot's address, once the model is done: the render starts now. */
export function startPicture(ctx: RunContext, change: PictureChange, videoUrl: string, span: SecondsRange): Promise<string> {
  return (async () => {
    const trimmed = await ctx.jobs.run(() => trimVideoApi(videoUrl, span.start, span.end, ctx.userId), TRIM_TIMEOUT_MS)
    const clipUrl = typeof trimmed.videoUrl === "string" ? trimmed.videoUrl : null
    if (!clipUrl) throw new JobFailed("no clip")
    const jobId = await ctx.jobs.start(() => videoToVideo(clipUrl, change.instruction, PICTURE_MODEL, ctx.userId, { videoEditDuration: "0", audioSetting: "origin" }))
    const edited = await ctx.jobs.finish(jobId, EDIT_TIMEOUT_MS).catch((error: unknown) => {
      if (!(error instanceof JobTimedOut)) throw error
      // The model has the shot and will be paid for its answer: the render is followed on, not dropped.
      ctx.jobs.keep(jobId)
      throw new PictureLate({ jobId, mediaId: ctx.mediaId, span })
    })
    const url = typeof edited.videoUrl === "string" ? edited.videoUrl : null
    if (!url) throw new JobFailed("no video")
    return url
  })()
}

/** The render is still going when the run stops waiting for it. */
export class PictureLate extends Error {
  constructor(readonly picture: LatePicture) {
    super("picture late")
    this.name = "PictureLate"
  }
}

/** How long a late render is followed before it is given up on. */
export const LATE_PICTURE_MS = 2 * 60 * 60_000

/**
 * Follows a late render to its end and lays it over its shot, where the shot
 * is on the edit by then. Answers whether it was laid; throws what a job
 * throws (failed, stopped) and `JobTimedOut` when it never finished.
 */
export async function placeLatePicture(editor: EditorLink, late: LatePicture, label: string, signal: AbortSignal): Promise<{ readonly placed: boolean; readonly recorded: boolean; readonly refused?: string }> {
  const output = await waitForJob(late.jobId, signal, LATE_PICTURE_MS)
  const url = typeof output.videoUrl === "string" ? output.videoUrl : null
  if (!url) throw new JobFailed("no video")
  const response = await fetch(url, { signal })
  if (!response.ok) throw new JobFailed(`download ${response.status}`)
  const buffer = await response.arrayBuffer()
  checkStop(signal)
  const timeline = readTimelineView(await editor.getTimeline())
  const from = timeline ? timelineFrameOf(timeline, late.mediaId, late.span.start) : null
  // The shot was cut away since: nothing to lay it over.
  if (!timeline || !from) return { placed: false, recorded: false }
  const ref = `ai-picture-${Date.now().toString(36)}`
  editor.importFile(ref, "ai-picture.mp4", "video/mp4", buffer)
  const duration = Math.max(1, Math.round((late.span.end - late.span.start) * timeline.fps))
  const applied = await editor.applyOps(label, [{ op: "placeMedia", ref, from: from.frame, durationInFrames: duration, fit: "cover" }])
  if (!applied.ok) return { placed: false, recorded: false, refused: applied.error?.message }
  editor.playback("seek", from.frame)
  return { placed: true, recorded: applied.recorded !== false }
}

export interface PictureOutcome {
  readonly placed: boolean
  readonly refused?: string
}

/** The Picture agent's turn: the shot selected, the render waited for in plain sight, then laid over its shot and played. */
export async function placePicture(ctx: RunContext, change: PictureChange, span: SecondsRange, render: Promise<string>, startedAt: number): Promise<PictureOutcome> {
  ctx.working("picture", true)
  const label = spanLabel(span)
  const at = timelineFrameOf(ctx.timeline, ctx.mediaId, span.start)
  if (at) ctx.link.playback("seek", at.frame)
  await ctx.show.lasso(
    "picture",
    regionOf(`${change.what ?? ""} ${change.instruction}`),
    1400,
    change.what ? ctx.say("freecutAi.note.selecting", { what: change.what }) : undefined,
  )
  const state = { settled: false }
  render.then(
    () => (state.settled = true),
    () => (state.settled = true),
  )
  while (!state.settled) {
    const progress = Math.min(0.95, (Date.now() - startedAt) / PICTURE_MS)
    ctx.show.progress("picture", "preview", progress, ctx.say("freecutAi.note.rendering", { p: Math.round(progress * 100) }))
    ctx.step("picture", "working", "freecutAi.pictureRendering", label, 0.1 + progress * 0.75)
    // Real time, whatever the show's pace: this waits on a job, not on the show.
    await Promise.race([render.catch(() => undefined), pause(1500, ctx.signal)])
    checkStop(ctx.signal)
  }
  let url: string
  try {
    url = await render
  } catch (error) {
    ctx.working("picture", false)
    throw error
  }
  const response = await fetch(url, { signal: ctx.signal })
  if (!response.ok) throw new JobFailed(`download ${response.status}`)
  const buffer = await response.arrayBuffer()
  checkStop(ctx.signal)
  const ref = `ai-picture-${Date.now().toString(36)}`
  ctx.link.importFile(ref, "ai-picture.mp4", "video/mp4", buffer)

  // Laid over its shot, where the shot is on the edit now.
  const from = timelineFrameOf(ctx.timeline, ctx.mediaId, span.start)
  if (!from) {
    ctx.working("picture", false)
    return { placed: false }
  }
  const duration = Math.max(1, Math.round((span.end - span.start) * ctx.fps))
  await ctx.show.drag("picture", { target: "panel.media" }, { frame: from.frame, trackId: from.trackId }, "ai-picture.mp4", 800)
  // The editor lays a picture right above the video and under the captions, and a placed video is silent.
  const applied = await ctx.apply("picture", [{ op: "placeMedia", ref, from: from.frame, durationInFrames: duration, fit: "cover" }])
  if (!applied.ok) {
    ctx.working("picture", false)
    return { placed: false, refused: applied.reason }
  }
  await ctx.preview(from.frame, 2600)
  ctx.feed("picture", "freecutAi.pictureDone", label)
  ctx.working("picture", false)
  return { placed: true }
}
