/**
 * Speaker Frames' job budget (P3.3b) — a PURE leaf, like `speaker-view-budget.ts`:
 * the video worker's dispatch site reads it through
 * `declaredJobBudgetMs("speaker-frames", job.data)` (`lib/job-budget.ts`), and
 * so do the orchestrator's node ceilings and the relay's poll budget (P3.6).
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
 *  - THE FACE DESCRIPTORS (P3.2b round 3): the handler asks `detectFaces` for
 *    job-only descriptors on the samples at the EDGES of each kept span (the
 *    first and last `SPEAKER_FRAMES_DESCRIBED_EDGE_SAMPLES`), so the linker can
 *    relink a face across the gap by how it looks. Each described frame lengthens
 *    its window's hold by `FACE_DETECT_DESCRIPTOR_MS_PER_FRAME`, wherever it
 *    falls, so the term is per SPAN: `speakerFramesDescriptorSpanBudgetMs`.
 *  - THE ATTRIBUTION BURSTS (P3.5, plan rung 3 of the P3-4 ladder): per source,
 *    when the transcript names two or more speakers, ONE second proxy of the
 *    original at 15 fps over the bursts' windows (`ensureMediaProxy(url,
 *    "video", { fps: 15, height: 540, spans })`, a proxy build like the
 *    detection one: download, probe, an encode and a probe per span at the span's
 *    own ceilings, the join and its probes), its download into the handler's
 *    work dir, then ONE `runFfmpegCapture` per burst (the pixel read: crop →
 *    tblend → signalstats for every face on screen) at the plugin's own limit,
 *    `SPEAKER_FRAMES_BURST_CAPTURE_TIMEOUT_MS`. A burst is a
 *    `SPEAKER_FRAMES_BURST_MS` window at the middle of a turn of at least 2 s
 *    with no crosstalk, at most `SPEAKER_FRAMES_BURSTS_PER_SPEAKER` per speaker:
 *    `speakerFramesBurstBudgetMs`.
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
 * THE PAYLOAD it reads (the contract P3.4's route queues; its test pins the
 * plugin's exported example, `SPEAKER_FRAMES_JOB_PAYLOAD_EXAMPLE`, P3.6):
 *  - `edl`: the edit — one `Edl`, or the clip pack's `Edl[]` (P3-24: one job
 *    over the union of the clips' spans). The object; its JSON string is read
 *    too. Every source of kind `video`, or that a segment shows, samples the
 *    master spans its EDL keeps plus `DETECTION_SPAN_MARGIN_MS` each side
 *    (P3-5), at the detection proxy's 2 fps.
 *  - `videoUrl`: a bare video (P3-5 (c)), whose length is not in the payload:
 *    it is charged at `SPEAKER_FRAMES_MAX_SOURCE_MS`, one whole-source span.
 *    THE ROUTE MUST REFUSE a longer source before the reserve (§3 step 1);
 *    that refusal is what makes this bound hold.
 *  - `transcript` (an object or its JSON string): only its distinct `speaker`
 *    labels are counted, for the bursts. A jobs row whose transcript was slimmed
 *    reads `transcriptSpeakerCount` (the route records it; a recorded 0 is 0),
 *    else — a row from before that — `transcriptWordCount` as the bound on its
 *    speakers (no more speakers than words). Whatever the count, a source never gets more bursts
 *    than disjoint `SPEAKER_FRAMES_BURST_MS` windows fit in its proxy's spans
 *    (eligible turns never overlap, so neither do their windows).
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
 *  - one detection proxy per source, with no `timeoutMs` override (each span
 *    then runs at its own ceiling), over the padded kept spans;
 *  - at most one burst proxy per source (15 fps, `SPEAKER_FRAMES_BURST_MS`
 *    windows, no `timeoutMs`), only with a transcript of two or more speakers,
 *    at most `SPEAKER_FRAMES_BURSTS_PER_SPEAKER` windows per speaker, each inside
 *    one span of the detection proxy; one capture per window, at
 *    `SPEAKER_FRAMES_BURST_CAPTURE_TIMEOUT_MS`;
 *  - the 180-minute refusal for a bare video;
 *  - descriptors on at most the first and last `SPEAKER_FRAMES_DESCRIBED_EDGE_SAMPLES`
 *    samples of each span of the proxy (every sample of a span shorter than both).
 *
 * Nothing in this repo can see the plugin spawn the bursts, so the guard is the
 * plugin's copied budget test: it pins the burst constants below and fails when
 * the handler decodes more bursts, or reads them at another limit, than this
 * leaf charges. The plugin's pin bump waits on an app release carrying this term.
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
import {
  FACE_DETECT_DESCRIPTOR_MS_PER_FRAME,
  FACE_DETECT_MAX_FRAMES_PER_CALL,
  faceDetectTimeoutMs,
} from "../../services/face-detect/face-detect-budget.js"
import {
  DEFAULT_FFMPEG_TIMEOUT_MS,
  DOWNLOAD_MAX_MS,
  DOWNLOAD_TIMEOUT_MS,
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

/** Samples at each edge of a kept span whose faces carry descriptors (P3.2b round 3). */
export const SPEAKER_FRAMES_DESCRIBED_EDGE_SAMPLES = 4

/**
 * The descriptor term of one proxy span of `lengthMs` (`undefined`: the whole
 * source, length unknown): its described frames — both edges, or every frame
 * of a span with fewer — at the detector's per-frame descriptor term. Small:
 * 80 ms a span at most (measured 14–17 µs per box, `face-detect-budget.ts`).
 */
export function speakerFramesDescriptorSpanBudgetMs(lengthMs: number | undefined): number {
  const edges = 2 * SPEAKER_FRAMES_DESCRIBED_EDGE_SAMPLES
  const frames = lengthMs === undefined ? edges : Math.min(edges, spanFrames(lengthMs, DETECTION_PROXY.fps))
  return frames * FACE_DETECT_DESCRIPTOR_MS_PER_FRAME
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

/** Rung 3's burst proxy rate (P3-4 (a), P3-5 (a)): 15 fps. Carried for the plugin's copy; the per-span
 *  ceilings do not depend on it, and its frame period is under the detection proxy's slack. */
export const SPEAKER_FRAMES_BURST_FPS = 15
/** One burst: 1.5 s around a turn's middle (P3-4 (a) rung 3). */
export const SPEAKER_FRAMES_BURST_MS = 1500
/** At most this many bursts per speaker, per source (P3-4 (a) rung 3). */
export const SPEAKER_FRAMES_BURSTS_PER_SPEAKER = 20
/** The plugin's limit on one burst's pixel read (one `runFfmpegCapture`). */
export const SPEAKER_FRAMES_BURST_CAPTURE_TIMEOUT_MS = 120_000

/**
 * One source's attribution bursts, `bursts` of them (0: none): the burst proxy
 * (its fixed steps, then each window as a span at its own ceilings), its
 * download into the work dir, and one slot-gated capture per burst at the
 * plugin's limit plus its overrun.
 */
export function speakerFramesBurstBudgetMs(bursts: number): number {
  if (!(bursts > 0)) return 0
  return SPEAKER_FRAMES_PROXY_FIXED_MS + DOWNLOAD_TIMEOUT_MS
    + bursts * (speakerFramesProxySpanBudgetMs(SPEAKER_FRAMES_BURST_MS)
      + SPEAKER_FRAMES_BURST_CAPTURE_TIMEOUT_MS + SPEAKER_FRAMES_HOLD_OVERRUN_MS)
}

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
  /** Attribution bursts charged to this source (P3.5). */
  readonly bursts: number
}

export interface SpeakerFramesBudgetBreakdown {
  readonly sources: readonly SpeakerFramesSourcePlan[]
  readonly windows: number
  readonly proxyMs: number
  readonly detectMs: number
  /** The face descriptors' share of the detection holds: one term per span. */
  readonly descriptorMs: number
  /** The attribution bursts (P3.5): a burst proxy and one capture per burst, per source. */
  readonly burstMs: number
  readonly slackMs: number
  readonly totalMs: number
}

/** The most frames a span of `lengthMs` can give at `fps`: the samples on its
 *  grid, plus one for the edge (the encoder's `round=up` grid and its trim). */
function spanFrames(lengthMs: number, fps: number): number {
  return Math.ceil((lengthMs * fps) / 1000) + 1
}

/** Per source: its proxy's spans and frames, and the detection windows over them. */
function sourceMs(plan: SpeakerFramesSourcePlan): { proxyMs: number; detectMs: number; descriptorMs: number; burstMs: number; windows: number } {
  const full = Math.floor(plan.frames / FACE_DETECT_MAX_FRAMES_PER_CALL)
  const rest = plan.frames - full * FACE_DETECT_MAX_FRAMES_PER_CALL
  let spansMs = 0
  let descriptorMs = 0
  if (plan.spanLengthsMs === null) {
    spansMs = plan.spans * speakerFramesProxySpanBudgetMs(undefined)
    descriptorMs = plan.spans * speakerFramesDescriptorSpanBudgetMs(undefined)
  } else {
    for (const len of plan.spanLengthsMs) {
      spansMs += speakerFramesProxySpanBudgetMs(len)
      descriptorMs += speakerFramesDescriptorSpanBudgetMs(len)
    }
  }
  return {
    descriptorMs,
    burstMs: speakerFramesBurstBudgetMs(plan.bursts),
    proxyMs: SPEAKER_FRAMES_PROXY_FIXED_MS + spansMs,
    detectMs: full * speakerFramesWindowBudgetMs(FACE_DETECT_MAX_FRAMES_PER_CALL) + (rest > 0 ? speakerFramesWindowBudgetMs(rest) : 0),
    windows: full + (rest > 0 ? 1 : 0),
  }
}

function breakdownOf(sources: readonly SpeakerFramesSourcePlan[]): SpeakerFramesBudgetBreakdown {
  let proxyMs = 0
  let detectMs = 0
  let descriptorMs = 0
  let burstMs = 0
  let windows = 0
  for (const plan of sources) {
    const s = sourceMs(plan)
    proxyMs += s.proxyMs
    detectMs += s.detectMs
    descriptorMs += s.descriptorMs
    burstMs += s.burstMs
    windows += s.windows
  }
  const slackMs = SPEAKER_FRAMES_RUN_SLACK_MS
  return { sources, windows, proxyMs, detectMs, descriptorMs, burstMs, slackMs, totalMs: proxyMs + detectMs + descriptorMs + burstMs + slackMs }
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
function planOf(kept: readonly ProxySpan[], speakers: number): SpeakerFramesSourcePlan {
  let earliest = Number.POSITIVE_INFINITY
  for (const s of kept) if (s.startMs < earliest) earliest = s.startMs
  const shift = DETECTION_SPAN_MARGIN_MS + Math.max(0, -earliest)
  const shifted = kept.map((s) => ({ startMs: s.startMs + shift, endMs: s.endMs + shift }))
  const spans = normalizeProxySpans(padSpans(shifted, DETECTION_SPAN_MARGIN_MS), DETECTION_PROXY.fps)
  let frames = 0
  for (const s of spans) frames += spanFrames(s.endMs - s.startMs, DETECTION_PROXY.fps)
  const spanLengthsMs = spans.map((s) => s.endMs - s.startMs)
  return { spans: spans.length, frames, spanLengthsMs, bursts: burstsFor(speakers, spanLengthsMs) }
}

/**
 * The most speakers the payload's transcript can name (rung 3 runs with two or
 * more): its distinct `speaker` labels, else a slimmed row's
 * `transcriptSpeakerCount` when recorded (0 included), else its `transcriptWordCount` (no more speakers
 * than words), else none.
 */
export function speakerFramesTranscriptSpeakers(data: { transcript?: unknown; transcriptSpeakerCount?: unknown; transcriptWordCount?: unknown }): number {
  let transcript = data.transcript
  if (typeof transcript === "string") {
    try {
      transcript = JSON.parse(transcript)
    } catch {
      transcript = undefined
    }
  }
  const words = transcript && typeof transcript === "object" ? (transcript as { words?: unknown }).words : undefined
  if (Array.isArray(words)) {
    const seen = new Set<string>()
    for (const w of words) {
      const sp = w && typeof w === "object" ? (w as { speaker?: unknown }).speaker : undefined
      if (typeof sp === "string" && sp.length > 0) seen.add(sp)
    }
    return seen.size
  }
  const count = (v: unknown) => (isFiniteNumber(v) && v > 0 ? Math.ceil(v) : 0)
  // Presence, not truthiness: a recorded 0 (a transcript without speaker labels) is a count, and reading
  // it as "not recorded" would charge a row min(20 x its words, fit) bursts its payload never had.
  return isFiniteNumber(data.transcriptSpeakerCount) ? count(data.transcriptSpeakerCount) : count(data.transcriptWordCount)
}

/** A source's bursts: `SPEAKER_FRAMES_BURSTS_PER_SPEAKER` per speaker with two
 *  or more speakers, never more than disjoint burst windows fit in its spans
 *  (`null`: the whole source, at the 180-minute cap). Each span is read at its
 *  length plus two detection frame periods: the handler checks a window against
 *  the span-map row the encoder wrote, which holds up to that much more. */
function burstsFor(speakers: number, spanLengthsMs: readonly number[] | null): number {
  if (speakers < 2) return 0
  const lengths = spanLengthsMs ?? [SPEAKER_FRAMES_MAX_SOURCE_MS]
  let fit = 0
  for (const len of lengths) fit += Math.floor((len + 2 * SPAN_SLACK_MS) / SPEAKER_FRAMES_BURST_MS)
  return Math.min(SPEAKER_FRAMES_BURSTS_PER_SPEAKER * speakers, fit)
}

function edlBreakdown(raw: unknown, speakers: number): SpeakerFramesBudgetBreakdown | undefined {
  const bySource = keptSpansBySource(editsOf(raw))
  if (bySource.size === 0) return undefined
  return breakdownOf([...bySource.values()].map((kept) => planOf(kept, speakers)))
}

function videoBreakdown(url: unknown, speakers: number): SpeakerFramesBudgetBreakdown | undefined {
  if (typeof url !== "string" || url.length === 0) return undefined
  return breakdownOf([{ spans: 1, frames: spanFrames(SPEAKER_FRAMES_MAX_SOURCE_MS, DETECTION_PROXY.fps), spanLengthsMs: null, bursts: burstsFor(speakers, null) }])
}

/** The budget's terms for one speaker-frames payload, or `undefined` when it
 *  names nothing to sample. With both an edit and a video, the larger. */
export function speakerFramesBudgetBreakdown(data: unknown): SpeakerFramesBudgetBreakdown | undefined {
  if (!data || typeof data !== "object") return undefined
  const { edl, videoUrl } = data as { edl?: unknown; videoUrl?: unknown }
  let speakers = 0
  try {
    speakers = speakerFramesTranscriptSpeakers(data as Record<string, unknown>)
  } catch {
    speakers = 0
  }
  let fromEdl: SpeakerFramesBudgetBreakdown | undefined
  try {
    fromEdl = edl === undefined || edl === null ? undefined : edlBreakdown(edl, speakers)
  } catch {
    fromEdl = undefined
  }
  const fromVideo = videoBreakdown(videoUrl, speakers)
  if (!fromEdl) return fromVideo
  if (!fromVideo) return fromEdl
  return fromEdl.totalMs >= fromVideo.totalMs ? fromEdl : fromVideo
}

/** The budget (ms) of ONE speaker-frames job, read off its queue payload. */
export function speakerFramesJobBudgetMs(data: unknown): number | undefined {
  return speakerFramesBudgetBreakdown(data)?.totalMs
}
