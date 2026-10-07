/**
 * Original audition (TA19 a, R6 a, decided 2026-10-06): what the inspector's
 * Original player plays, straight from the original files (range requests,
 * `preload="metadata"`), for free.
 *
 * ONE ELEMENT (R6 a). For video output it plays the `video` source of the look
 * the time takes, with that file's own sound: exact in single-camera Tighten;
 * in multicam it is the camera's scratch audio, and `cameraAudio` says so
 * whenever the render's sound for that time is another file. For audio output
 * it plays the segment's sound: its `audio` source, else the unique
 * `role: "master-audio"` source, else its own video file (the EDL's default).
 *
 * THE LOOK is buildEdited's owner rule: the plan segment holding the instant;
 * between two segments, the one before (restored time carries its look);
 * before the first, the first. So a cut span plays the camera it would take if
 * restored.
 *
 * TIMES. A span plays from AUDITION_PAD_MS before it to AUDITION_PAD_MS after
 * it, on the file's own clock (source = master − the source's `offsetMs`),
 * never before the file starts. A word plays on from its start. The render's
 * wired Sources media replace a source's file positionally, as the render's
 * effective EDL does (`buildEffectiveEdl`).
 */
import type { Edl, EdlSegment, EdlSource } from "@nodaro/shared"
import type { Interval } from "./intervals"
import type { ReviewRenderContext } from "./restore"

/** Played either side of a span (TA19 a: 1.5 s). */
export const AUDITION_PAD_MS = 1500

export interface Audition {
  readonly sourceId: string
  readonly url: string
  /** The element that plays it: a `<video>` for video output, else an `<audio>`. */
  readonly medium: "video" | "audio"
  /** The file's origin on the master clock: master = source + this. */
  readonly sourceOffsetMs: number
  /** Where it starts, on the file's clock. */
  readonly fromMs: number
  /** Where it stops, on the file's clock; null plays on. */
  readonly toMs: number | null
  /** The span auditioned, on the file's clock; null at a word. */
  readonly span: Interval | null
  /** The file's sound is not the render's sound for this time (a camera's scratch audio). */
  readonly cameraAudio: boolean
}

/** The plan segment whose look master instant `ms` takes (buildEdited's owner rule). */
export function lookOwnerAt(edl: Edl, ms: number): EdlSegment | undefined {
  const segments = edl.segments
  let before: EdlSegment | undefined
  for (const seg of segments) {
    if (seg.inMs <= ms && ms < seg.outMs) return seg
    if (seg.outMs <= ms) before = seg
  }
  return before ?? segments[0]
}

/** The segment's sound: its own `audio`, else the unique master audio, else its video. */
function soundOf(edl: Edl, seg: EdlSegment): string | undefined {
  if (seg.audio) return seg.audio
  const masters = edl.sources.filter((s) => s.role === "master-audio")
  return masters.length === 1 ? masters[0]!.id : seg.video
}

interface Played {
  readonly source: EdlSource
  readonly url: string
  readonly medium: "video" | "audio"
  readonly cameraAudio: boolean
}

function playedAt(edl: Edl, render: ReviewRenderContext, ms: number): Played | null {
  const seg = lookOwnerAt(edl, ms)
  if (!seg) return null
  const sound = soundOf(edl, seg)
  const pictured = render.output !== "audio" && !!seg.video
  const id = pictured ? seg.video : sound
  const index = edl.sources.findIndex((s) => s.id === id)
  const source = edl.sources[index]
  if (!source) return null
  const wired = render.sources[index]
  const url = typeof wired === "string" && wired.trim() ? wired.trim() : source.url
  if (!url) return null
  return { source, url, medium: pictured ? "video" : "audio", cameraAudio: pictured && sound !== source.id }
}

function auditionOf(played: Played, fromMasterMs: number, toMasterMs: number | null, span: Interval | null): Audition {
  const off = played.source.offsetMs ?? 0
  return {
    sourceId: played.source.id,
    url: played.url,
    medium: played.medium,
    sourceOffsetMs: off,
    fromMs: Math.max(0, fromMasterMs - off),
    toMs: toMasterMs === null ? null : Math.max(0, toMasterMs - off),
    span: span ? { inMs: span.inMs - off, outMs: span.outMs - off } : null,
    cameraAudio: played.cameraAudio,
  }
}

/** Hear it: span `span` (master clock) ± AUDITION_PAD_MS; null when its look has no file. */
export function auditionOfSpan(edl: Edl, render: ReviewRenderContext, span: Interval): Audition | null {
  const played = playedAt(edl, render, span.inMs)
  return played ? auditionOf(played, span.inMs - AUDITION_PAD_MS, span.outMs + AUDITION_PAD_MS, span) : null
}

/** The original from master instant `ms` on, with no end. */
export function auditionAt(edl: Edl, render: ReviewRenderContext, ms: number): Audition | null {
  const played = playedAt(edl, render, ms)
  return played ? auditionOf(played, ms, null, null) : null
}
