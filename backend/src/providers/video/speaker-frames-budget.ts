/**
 * Speaker Frames' job budget (P3.3b) — a PURE leaf, like `speaker-view-budget.ts`:
 * the video worker's dispatch site reads it through
 * `declaredJobBudgetMs("speaker-frames", job.data)` (`lib/job-budget.ts`), and
 * so will the orchestrator's node ceilings and the relay's poll budget once the
 * node exists (P3.6).
 *
 * WHY THE APP HOLDS IT. The handler lives in the private plugin (P3.4), and a
 * plugin handler cannot declare `livenessBudgetMs` (core-only). Without a
 * registered budget its heartbeat would stop at the 90-minute default and a
 * three-hour source would be swept while it is still being detected.
 *
 * AN UPPER BOUND, NOT AN ESTIMATE. It is the sum of the kill ceilings of every
 * bounded step the handler runs, at the worst case the payload allows — the
 * rule every declared budget follows (backend/CLAUDE.md, the `pre-task`
 * sentinel). The steps, per video source (§3 steps 2–3 and 7 of the Speaker
 * Frames design):
 *
 *  - THE DETECTION PROXY on a cache miss (`ensureMediaProxy(url, "video",
 *    { fps: 2, height: 540, spans })`): the original's big-media download
 *    (`DOWNLOAD_MAX_MS`), a probe of it, one encode per span with a frame-time
 *    probe of the segment it wrote — each at the SPAN'S OWN ceiling, sized by
 *    its length (`proxySpanEncodeTimeoutMs`, `proxySpanProbeTimeoutMs`), so 270
 *    short spans are not charged 270 whole-proxy ceilings — the stream-copy
 *    join at the proxy's ceiling (`MEDIA_PROXY_FFMPEG_TIMEOUT_MS`), and the
 *    join's frame-time and size probes (`services/video-proxy-encode.ts`).
 *  - DETECTION, one call per window of at most `FACE_DETECT_MAX_FRAMES_PER_CALL`
 *    proxy frames (`tk.media.detectFaces`): a probe of the proxy, then ONE
 *    admission hold whose limit is the detector's own (`faceDetectTimeoutMs`,
 *    from the measured 13–16 CPU-ms per frame of inference plus the proxy
 *    decode — P3.3's figures, re-pinned there by the pricing measurement).
 *  - THE IN-PROCESS TAIL: linking, subject selection, identity, the window's
 *    checkpoint body and the artifact's normalize/validate. No kill ceiling
 *    bounds JS, so its INPUT does: a window hands back at most
 *    `SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE` boxes or fails
 *    (`faceDetectCaps`), and each is charged `SPEAKER_FRAMES_TAIL_MS_PER_BOX`.
 *
 * Every slot-gated step (each encode, the join, each detection hold) is charged
 * its limit plus `SPEAKER_FRAMES_HOLD_OVERRUN_MS`: past that its slot releases
 * itself and the call rejects, whatever the work is doing (`holdSlot`). Not
 * counted, as for every budget: time WAITING for a slot or its memory (the
 * heartbeat's clock pauses for it), and storage I/O (the proxy's cache check
 * and upload, its span map, each window's checkpoint, the artifact — every call
 * bounded on its own, decided 2026-10-04).
 *
 * THE PAYLOAD it reads (the contract P3.4's route queues; P3.6 re-pins the
 * fixture to the plugin's exported type):
 *  - `edl`: the edit — one `Edl`, or the clip pack's `Edl[]` (P3-24: one job
 *    over the union of the clips' spans). The object; its JSON string is read
 *    too. Every source of kind `video`, or that a segment shows, samples the
 *    master spans its EDL keeps plus `DETECTION_SPAN_MARGIN_MS` each side
 *    (P3-5), at the detection proxy's 2 fps.
 *  - `videoUrl`: a bare video (P3-5 (c)), whose length is not in the payload:
 *    it is charged at `SPEAKER_FRAMES_MAX_SOURCE_MS`, one whole-source span.
 *    THE ROUTE MUST REFUSE a longer source before the reserve (§3 step 1);
 *    that refusal is what makes this bound hold.
 *  Everything else rides along unread. Never narrowed: a tick list leaves a
 *  subset of the sources (the budget over all of them covers it), and the
 *  margins are applied unclamped (a span clamped at a source's zero is shorter,
 *  never longer). Sources are told apart by id AND url, so a pack is charged at
 *  least once per proxy the handler can build, however it groups them.
 *
 * WHAT THE HANDLER MUST KEEP (copy these into the plugin's budget test with
 * the payload, the `speaker-view` arrangement):
 *  - windows of `FACE_DETECT_MAX_FRAMES_PER_CALL` consecutive proxy frames
 *    (the last one partial), one `detectFaces` call each;
 *  - one detection proxy per source (ONE `ensureMediaProxy` call per source
 *    until the bursts' term below exists), with no `timeoutMs` override (each
 *    span then runs at its own ceiling), over the padded kept spans;
 *  - the 180-minute refusal for a bare video.
 *
 * NOT IN IT YET: the attribution bursts (P3.5: a second, 15 fps proxy per
 * source over up to 20 turns per speaker, plan rung 3). They are unbuilt and
 * their pixel read is still an implementation choice; P3.5 adds their term
 * here before its plugin pin bump, as every toolkit change rides the app
 * release first. Nothing in this repo can see the plugin spawn them, so the
 * guard is the plugin's copied budget test: one `ensureMediaProxy` per source
 * (above) fails the moment a burst proxy is added without its term.
 *
 * HOW TIGHT. Per-span ceilings keep a Tighten edit's many short spans to
 * minutes each, but a span is still charged the encoder's floor (minutes,
 * `PROXY_SPAN_TIMEOUT_FLOOR_MS`) twice — its encode and its probe — so a
 * 90-minute single-camera Tighten edit of 270 spans is charged about 55 h
 * (it was about 254 h at the flat 45-minute ceiling). That is the window a
 * live-but-hung handler keeps its heartbeat (and, once the node exists, the
 * orchestrator's ceilings) going before the sweep sees it. The floor is the
 * lever that tightens it further.
 */
import type { Edl, EdlSegment } from "@nodaro/shared"
import { SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE } from "@nodaro/shared"
import {
  DETECTION_PROXY,
  DETECTION_SPAN_MARGIN_MS,
  normalizeProxySpans,
  padSpans,
  type ProxySpan,
} from "../../services/media-proxy-span-map.js"
import { FACE_DETECT_MAX_FRAMES_PER_CALL, faceDetectTimeoutMs } from "../../services/face-detect/face-detect-budget.js"
import {
  DEFAULT_FFMPEG_TIMEOUT_MS,
  DOWNLOAD_MAX_MS,
  FFMPEG_KILL_GRACE_MS,
  FFMPEG_SLOT_BACKSTOP_MS,
  FFPROBE_TIMEOUT_MS,
  MEDIA_PROXY_FFMPEG_TIMEOUT_MS,
  proxySpanEncodeTimeoutMs,
  proxySpanProbeTimeoutMs,
} from "./ffmpeg-timeouts.js"

/** The longest source Speaker Frames samples (§3 step 1's refusal), and what a
 *  bare video — whose length the payload does not carry — is charged at. */
export const SPEAKER_FRAMES_MAX_SOURCE_MS = 180 * 60_000

/** The most a slot-gated step outlasts its own limit: the kill grace, then the
 *  slot's own backstop (`holdSlot` rejects past both). */
export const SPEAKER_FRAMES_HOLD_OVERRUN_MS = FFMPEG_KILL_GRACE_MS + FFMPEG_SLOT_BACKSTOP_MS

/** A detection proxy's steps that do not depend on its span count: the
 *  original's download, its probe, the join (slot-gated, at the encode's
 *  ceiling), the join's frame-time probe and its size probe. */
export const SPEAKER_FRAMES_PROXY_FIXED_MS =
  DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS
  + MEDIA_PROXY_FFMPEG_TIMEOUT_MS + SPEAKER_FRAMES_HOLD_OVERRUN_MS
  + DEFAULT_FFMPEG_TIMEOUT_MS + FFPROBE_TIMEOUT_MS

/** One frame period of the detection proxy: what a span is charged past its
 *  normalized length — the handler's own whole-ms rounding of a span shifted
 *  onto a source's clock, and the sub-period gap a merge takes in. */
const SPAN_SLACK_MS = 1000 / DETECTION_PROXY.fps

/**
 * Each span of a detection proxy: its encode (slot-gated) and the frame-time
 * probe of the segment it wrote, at the encoder's own ceilings for a span of
 * `lengthMs` (plus one frame period), or — for the whole source, whose length
 * the encoder does not know (`undefined`) — at the proxy's and the default
 * probe's. Both ceilings are monotone and subadditive, so charging the spans
 * the leaf plans also covers a handler that clamps one at zero or merges two.
 */
export function speakerFramesProxySpanBudgetMs(lengthMs: number | undefined): number {
  if (lengthMs === undefined) return MEDIA_PROXY_FFMPEG_TIMEOUT_MS + SPEAKER_FRAMES_HOLD_OVERRUN_MS + DEFAULT_FFMPEG_TIMEOUT_MS
  const charged = lengthMs + SPAN_SLACK_MS
  return proxySpanEncodeTimeoutMs(charged) + SPEAKER_FRAMES_HOLD_OVERRUN_MS + proxySpanProbeTimeoutMs(charged)
}

/**
 * In-process time charged per box a window hands back. Measured on the
 * plugin's linker and subject filter (P3.4L, P3.4S): linking 75 ms for a
 * 170-minute source, the person-chain pass under 0.1 s for 129,600 boxes, the
 * filter 0.1–2.8 ms per clip — microseconds per box. 1 ms is a placeholder
 * hundreds of times that, until the pricing measurement times the built
 * handler (identity included) and re-pins it.
 */
export const SPEAKER_FRAMES_TAIL_MS_PER_BOX = 1

/** Slack for the run itself (the detector session's load, the handler's own
 *  bookkeeping): one default ffmpeg ceiling, as audio-sync's budget carries. */
export const SPEAKER_FRAMES_RUN_SLACK_MS = DEFAULT_FFMPEG_TIMEOUT_MS

/** One detection window of `frames` proxy frames: the proxy probe, the hold at
 *  the detector's own limit and its overrun, and its boxes in process. */
export function speakerFramesWindowBudgetMs(frames: number): number {
  return FFPROBE_TIMEOUT_MS + faceDetectTimeoutMs(frames) + SPEAKER_FRAMES_HOLD_OVERRUN_MS
    + SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE * SPEAKER_FRAMES_TAIL_MS_PER_BOX
}

/** What one source's proxy holds, at most: its spans, their lengths
 *  (`null`: the whole source, length unknown), and its frames. */
export interface SpeakerFramesSourcePlan {
  readonly spans: number
  readonly frames: number
  readonly spanLengthsMs: readonly number[] | null
}

export interface SpeakerFramesBudgetBreakdown {
  readonly sources: readonly SpeakerFramesSourcePlan[]
  readonly windows: number
  readonly proxyMs: number
  readonly detectMs: number
  readonly slackMs: number
  readonly totalMs: number
}

/** The most frames a span of `lengthMs` can give at `fps`: the samples on its
 *  grid, plus one for the edge (the encoder's `round=up` grid and its trim). */
const spanFrames = (lengthMs: number, fps: number) => Math.ceil((lengthMs * fps) / 1000) + 1

/** Per source: its proxy's spans and frames, and the detection windows over them. */
function sourceMs(plan: SpeakerFramesSourcePlan): { proxyMs: number; detectMs: number; windows: number } {
  const full = Math.floor(plan.frames / FACE_DETECT_MAX_FRAMES_PER_CALL)
  const rest = plan.frames - full * FACE_DETECT_MAX_FRAMES_PER_CALL
  let spansMs = 0
  if (plan.spanLengthsMs === null) spansMs = plan.spans * speakerFramesProxySpanBudgetMs(undefined)
  else for (const len of plan.spanLengthsMs) spansMs += speakerFramesProxySpanBudgetMs(len)
  return {
    proxyMs: SPEAKER_FRAMES_PROXY_FIXED_MS + spansMs,
    detectMs: full * speakerFramesWindowBudgetMs(FACE_DETECT_MAX_FRAMES_PER_CALL) + (rest > 0 ? speakerFramesWindowBudgetMs(rest) : 0),
    windows: full + (rest > 0 ? 1 : 0),
  }
}

function breakdownOf(sources: readonly SpeakerFramesSourcePlan[]): SpeakerFramesBudgetBreakdown {
  let proxyMs = 0
  let detectMs = 0
  let windows = 0
  for (const plan of sources) {
    const s = sourceMs(plan)
    proxyMs += s.proxyMs
    detectMs += s.detectMs
    windows += s.windows
  }
  const slackMs = SPEAKER_FRAMES_RUN_SLACK_MS
  return { sources, windows, proxyMs, detectMs, slackMs, totalMs: proxyMs + detectMs + slackMs }
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** The edits the payload's `edl` holds: one, a pack, or its JSON string. */
function editsOf(raw: unknown): unknown[] {
  let value = raw
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (Array.isArray(value)) return value
  return value && typeof value === "object" ? [value] : []
}

/** The ids of the sources an edit samples: every `video` source, and every
 *  source a segment shows (its `video`, its layout's slots). */
function sampledSourceIds(edl: Edl, segments: readonly EdlSegment[]): Set<string> {
  const ids = new Set<string>()
  for (const s of edl.sources) if (s && s.kind === "video") ids.add(s.id)
  for (const seg of segments) {
    if (typeof seg.video === "string") ids.add(seg.video)
    const slots = Array.isArray(seg.layout?.slots) ? seg.layout!.slots! : []
    for (const slot of slots) if (slot && typeof slot.source === "string") ids.add(slot.source)
  }
  return ids
}

/** Per (source id, url): the master spans every edit naming it keeps. */
function keptSpansBySource(edits: readonly unknown[]): Map<string, ProxySpan[]> {
  const bySource = new Map<string, ProxySpan[]>()
  for (const raw of edits) {
    if (!raw || typeof raw !== "object") continue
    const edl = raw as Edl
    if (!Array.isArray(edl.sources) || !Array.isArray(edl.segments)) continue
    const segments = (edl.segments as readonly unknown[]).filter((seg): seg is EdlSegment =>
      !!seg && typeof seg === "object" && isFiniteNumber((seg as EdlSegment).inMs) && isFiniteNumber((seg as EdlSegment).outMs)
      && (seg as EdlSegment).outMs > (seg as EdlSegment).inMs)
    if (segments.length === 0) continue
    const spans = segments.map((seg) => ({ startMs: seg.inMs, endMs: seg.outMs }))
    const ids = sampledSourceIds(edl, segments)
    for (const s of edl.sources) {
      if (!s || typeof s !== "object" || typeof s.id !== "string" || !ids.has(s.id)) continue
      const key = `${s.id}\u0000${typeof s.url === "string" ? s.url : ""}`
      bySource.set(key, [...(bySource.get(key) ?? []), ...spans])
    }
  }
  return bySource
}

/** A source's proxy: the kept spans padded by the margins and merged as the
 *  proxy merges them. Shifted first so no span starts before zero — the merge
 *  depends only on the gaps, and the clamp at zero only ever shortens. */
function planOf(kept: readonly ProxySpan[]): SpeakerFramesSourcePlan {
  let earliest = Number.POSITIVE_INFINITY
  for (const s of kept) if (s.startMs < earliest) earliest = s.startMs
  const shift = DETECTION_SPAN_MARGIN_MS + Math.max(0, -earliest)
  const shifted = kept.map((s) => ({ startMs: s.startMs + shift, endMs: s.endMs + shift }))
  const spans = normalizeProxySpans(padSpans(shifted, DETECTION_SPAN_MARGIN_MS), DETECTION_PROXY.fps)
  let frames = 0
  for (const s of spans) frames += spanFrames(s.endMs - s.startMs, DETECTION_PROXY.fps)
  return { spans: spans.length, frames, spanLengthsMs: spans.map((s) => s.endMs - s.startMs) }
}

function edlBreakdown(raw: unknown): SpeakerFramesBudgetBreakdown | undefined {
  const bySource = keptSpansBySource(editsOf(raw))
  if (bySource.size === 0) return undefined
  return breakdownOf([...bySource.values()].map(planOf))
}

function videoBreakdown(url: unknown): SpeakerFramesBudgetBreakdown | undefined {
  if (typeof url !== "string" || url.length === 0) return undefined
  return breakdownOf([{ spans: 1, frames: spanFrames(SPEAKER_FRAMES_MAX_SOURCE_MS, DETECTION_PROXY.fps), spanLengthsMs: null }])
}

/** The budget's terms for one speaker-frames payload, or `undefined` when it
 *  names nothing to sample. With both an edit and a video, the larger. */
export function speakerFramesBudgetBreakdown(data: unknown): SpeakerFramesBudgetBreakdown | undefined {
  if (!data || typeof data !== "object") return undefined
  const { edl, videoUrl } = data as { edl?: unknown; videoUrl?: unknown }
  let fromEdl: SpeakerFramesBudgetBreakdown | undefined
  try {
    fromEdl = edl === undefined || edl === null ? undefined : edlBreakdown(edl)
  } catch {
    fromEdl = undefined
  }
  const fromVideo = videoBreakdown(videoUrl)
  if (!fromEdl) return fromVideo
  if (!fromVideo) return fromEdl
  return fromEdl.totalMs >= fromVideo.totalMs ? fromEdl : fromVideo
}

/** The budget (ms) of ONE speaker-frames job, read off its queue payload. */
export function speakerFramesJobBudgetMs(data: unknown): number | undefined {
  return speakerFramesBudgetBreakdown(data)?.totalMs
}
