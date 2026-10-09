// Speaker Frames' registered job budget (P3.3b). Its handler is a PRIVATE
// PLUGIN handler, which cannot declare `livenessBudgetMs`, so without a
// registry entry the worker's heartbeat stops at the 90-minute default and a
// three-hour source is swept while it is still being detected.
//
// The budget is an UPPER BOUND, not an estimate: the sum of the kill ceilings
// of every bounded step the handler runs (the proxy build, the detection
// windows), plus the in-process work after them, bounded by the box cap. The
// last block re-derives that sum from a step-by-step model of the handler and
// checks the leaf is never below it.
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE, type Edl, type EdlSegment } from "@nodaro/shared"
import { BUDGETED_JOB_NAMES, declaredJobBudgetMs } from "../../../lib/job-budget.js"
import { NODE_TIMEOUT_MS } from "../../../services/workflow-engine/types.js"
import {
  DETECTION_PROXY,
  DETECTION_SPAN_MARGIN_MS,
  normalizeProxySpans,
  padSpans,
  type ProxySpan,
} from "../../../services/media-proxy-span-map.js"
import {
  FACE_DETECT_DESCRIPTOR_MS_PER_FRAME,
  FACE_DETECT_MAX_FRAMES_PER_CALL,
  faceDetectTimeoutMs,
} from "../../../services/face-detect/face-detect-budget.js"
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
} from "../ffmpeg-timeouts.js"
import {
  SPEAKER_FRAMES_BURST_CAPTURE_TIMEOUT_MS,
  SPEAKER_FRAMES_BURST_FPS,
  SPEAKER_FRAMES_BURST_MS,
  SPEAKER_FRAMES_BURSTS_PER_SPEAKER,
  SPEAKER_FRAMES_DESCRIBED_EDGE_SAMPLES,
  SPEAKER_FRAMES_HOLD_OVERRUN_MS,
  SPEAKER_FRAMES_MAX_SOURCE_MS,
  SPEAKER_FRAMES_PROXY_FIXED_MS,
  SPEAKER_FRAMES_RUN_SLACK_MS,
  SPEAKER_FRAMES_TAIL_MS_PER_BOX,
  speakerFramesBudgetBreakdown,
  speakerFramesBurstBudgetMs,
  speakerFramesTranscriptSpeakers,
  speakerFramesDescriptorSpanBudgetMs,
  speakerFramesJobBudgetMs,
  speakerFramesProxySpanBudgetMs,
  speakerFramesWindowBudgetMs,
} from "../speaker-frames-budget.js"

const MIN = 60_000
const H = 60 * MIN

const SOURCES = [
  { id: "mic", url: "https://f.test/mic.m4a", kind: "audio", role: "master-audio" },
  { id: "wide", url: "https://f.test/wide.mp4", kind: "video" },
  { id: "camA", url: "https://f.test/a.mp4", kind: "video", offsetMs: 4_000, speakers: ["Host"] },
] as const

/** An edit keeping `spans` (master ms), on `sources`. */
function edl(spans: ReadonlyArray<readonly [number, number]>, sources: readonly object[] = SOURCES): Edl {
  const segments = spans.map(([inMs, outMs], i) => ({ id: `s${i}`, inMs, outMs, video: "wide" })) as EdlSegment[]
  return { version: 1, clock: "master", sources, segments } as unknown as Edl
}

/** A Tighten-shaped edit: `minutes` of speech kept in `keepMs` runs with `gapMs` cut between them. */
function tighten(minutes: number, keepMs: number, gapMs: number, sources: readonly object[] = SOURCES): Edl {
  const spans: Array<[number, number]> = []
  for (let t = 0, kept = 0; kept < minutes * MIN; t += keepMs + gapMs, kept += keepMs) spans.push([t, t + keepMs])
  return edl(spans, sources)
}

/** An 8-clip pack: one EDL per clip, 60 s each, spread over 90 minutes. */
function clipPack(sources: readonly object[] = SOURCES): Edl[] {
  return Array.from({ length: 8 }, (_, i) => edl([[i * 11 * MIN, i * 11 * MIN + MIN]], sources))
}

const ONE_CAM = [{ id: "wide", url: "https://f.test/wide.mp4", kind: "video" }] as const

describe("speaker-frames' budget is registered and read the same way by every reader", () => {
  it("is a registered budgeted job, so the dispatch site's fallback finds it", () => {
    expect(BUDGETED_JOB_NAMES).toContain("speaker-frames")
    const payload = { edl: tighten(90, 20_000, 6_000) }
    expect(declaredJobBudgetMs("speaker-frames", payload)).toBe(speakerFramesJobBudgetMs(payload))
  })

  it("outlives the 90-minute default for the plan's worked examples — the failure it exists to stop", () => {
    for (const payload of [
      { videoUrl: "https://f.test/episode.mp4" }, // bare 180-min source
      { edl: tighten(90, 20_000, 6_000, ONE_CAM) }, // 90-min single wide scoped to Tighten
      { edl: clipPack(ONE_CAM) }, // the 8-clip pack, one job over the union
    ]) {
      expect(speakerFramesJobBudgetMs(payload)!, JSON.stringify(Object.keys(payload))).toBeGreaterThan(NODE_TIMEOUT_MS)
    }
  })
})

describe("the terms — each one a kill ceiling the handler's steps run under", () => {
  it("a slot-gated step can overrun its own limit only by the kill grace and the slot's backstop", () => {
    expect(SPEAKER_FRAMES_HOLD_OVERRUN_MS).toBe(FFMPEG_KILL_GRACE_MS + FFMPEG_SLOT_BACKSTOP_MS)
  })

  it("a proxy build is a big-media download, a probe, an encode and a frame-time probe per span, a join, and two probes of the join", () => {
    // A span is charged at ITS OWN ceilings (the encoder's), at its length plus
    // one frame period (the whole-ms rounding and a merged sub-period gap)...
    const period = 1000 / DETECTION_PROXY.fps
    for (const len of [500, 24_000, 30 * MIN, 180 * MIN]) {
      expect(speakerFramesProxySpanBudgetMs(len)).toBe(
        proxySpanEncodeTimeoutMs(len + period) + SPEAKER_FRAMES_HOLD_OVERRUN_MS + proxySpanProbeTimeoutMs(len + period),
      )
    }
    // ...and the whole source, whose length the encoder does not know, at the proxy's.
    expect(speakerFramesProxySpanBudgetMs(undefined)).toBe(MEDIA_PROXY_FFMPEG_TIMEOUT_MS + SPEAKER_FRAMES_HOLD_OVERRUN_MS + DEFAULT_FFMPEG_TIMEOUT_MS)
    // A 24-second span is charged minutes, not the 45-minute whole-proxy ceiling.
    expect(speakerFramesProxySpanBudgetMs(24_000)).toBeLessThan(12 * MIN)
    expect(SPEAKER_FRAMES_PROXY_FIXED_MS).toBe(
      DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS
      + MEDIA_PROXY_FFMPEG_TIMEOUT_MS + SPEAKER_FRAMES_HOLD_OVERRUN_MS
      + DEFAULT_FFMPEG_TIMEOUT_MS + FFPROBE_TIMEOUT_MS,
    )
  })

  it("a detection window is the proxy probe, the detector's own hold limit, its overrun, and the in-process work its boxes can cost", () => {
    for (const frames of [1, 600, FACE_DETECT_MAX_FRAMES_PER_CALL]) {
      expect(speakerFramesWindowBudgetMs(frames)).toBe(
        FFPROBE_TIMEOUT_MS + faceDetectTimeoutMs(frames) + SPEAKER_FRAMES_HOLD_OVERRUN_MS
        + SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE * SPEAKER_FRAMES_TAIL_MS_PER_BOX,
      )
    }
  })

  it("each span's edge samples carry face descriptors (P3.2b round 3): the first and last 4, at the detector's per-frame term", () => {
    expect(SPEAKER_FRAMES_DESCRIBED_EDGE_SAMPLES).toBe(4)
    // A span long enough to have both edges: 8 described frames.
    expect(speakerFramesDescriptorSpanBudgetMs(24_000)).toBe(8 * FACE_DETECT_DESCRIPTOR_MS_PER_FRAME)
    // A span of at most 8 samples is described whole: its frames, never more.
    expect(speakerFramesDescriptorSpanBudgetMs(1_000)).toBe(3 * FACE_DETECT_DESCRIPTOR_MS_PER_FRAME)
    // The whole source (length unknown) is one span: its two edges.
    expect(speakerFramesDescriptorSpanBudgetMs(undefined)).toBe(8 * FACE_DETECT_DESCRIPTOR_MS_PER_FRAME)
    // Small: 80 ms a span.
    expect(speakerFramesDescriptorSpanBudgetMs(undefined)).toBe(80)
  })

  it("the in-process tail is bounded by the box cap: a window hands back at most the per-source cap", () => {
    // Measured (P3.4L/P3.4S): linking 75 ms over 170 min, the chain pass < 0.1 s
    // for 129,600 boxes — microseconds per box. 1 ms per box is the placeholder
    // the pricing measurement re-pins.
    expect(SPEAKER_FRAMES_TAIL_MS_PER_BOX).toBe(1)
    expect(SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE * SPEAKER_FRAMES_TAIL_MS_PER_BOX).toBe(100_000)
  })

  it("the run itself gets one default ffmpeg ceiling of slack (the session load, the bookkeeping)", () => {
    expect(SPEAKER_FRAMES_RUN_SLACK_MS).toBe(DEFAULT_FFMPEG_TIMEOUT_MS)
  })

  it("the attribution bursts (P3.5): a burst proxy, its download, and per burst a span at its own ceilings plus one capture", () => {
    // Plan rung 3: 1.5 s at 15 fps around a turn's middle, at most 20 turns per speaker.
    expect(SPEAKER_FRAMES_BURST_FPS).toBe(15)
    expect(SPEAKER_FRAMES_BURST_MS).toBe(1500)
    expect(SPEAKER_FRAMES_BURSTS_PER_SPEAKER).toBe(20)
    expect(SPEAKER_FRAMES_BURST_CAPTURE_TIMEOUT_MS).toBe(120_000)
    expect(speakerFramesBurstBudgetMs(0)).toBe(0)
    for (const n of [1, 40, 120]) {
      expect(speakerFramesBurstBudgetMs(n)).toBe(
        SPEAKER_FRAMES_PROXY_FIXED_MS + DOWNLOAD_TIMEOUT_MS
        + n * (speakerFramesProxySpanBudgetMs(SPEAKER_FRAMES_BURST_MS) + SPEAKER_FRAMES_BURST_CAPTURE_TIMEOUT_MS + SPEAKER_FRAMES_HOLD_OVERRUN_MS),
      )
    }
    // A burst span is charged the encoder's floor twice, like any short span: minutes each.
    expect(speakerFramesProxySpanBudgetMs(SPEAKER_FRAMES_BURST_MS)).toBeLessThan(12 * MIN)
  })
})

describe("the bursts read off the payload (P3.5)", () => {
  const words = (speakers: string[], n = 50) => Array.from({ length: n }, (_, i) => ({ text: "w", startMs: i * 3000, endMs: i * 3000 + 2500, speaker: speakers[i % speakers.length] }))
  const long = edl([[0, 60 * MIN]], ONE_CAM)

  it("counts the transcript's distinct speaker labels (object or JSON string); a slimmed row reads its counts", () => {
    expect(speakerFramesTranscriptSpeakers({ transcript: { words: words(["Host", "Guest", "Host"]) } })).toBe(2)
    expect(speakerFramesTranscriptSpeakers({ transcript: JSON.stringify({ words: words(["A", "B", "C"]) }) })).toBe(3)
    expect(speakerFramesTranscriptSpeakers({ transcript: { words: [{ text: "x", startMs: 0, endMs: 1 }] } })).toBe(0)
    expect(speakerFramesTranscriptSpeakers({ transcriptSpeakerCount: 4, transcriptWordCount: 9000 })).toBe(4)
    expect(speakerFramesTranscriptSpeakers({ transcriptWordCount: 3 })).toBe(3)
    // a recorded 0 (a transcript without speaker labels) is a count, not "not recorded"
    expect(speakerFramesTranscriptSpeakers({ transcriptSpeakerCount: 0, transcriptWordCount: 9000 })).toBe(0)
    expect(speakerFramesTranscriptSpeakers({})).toBe(0)
    expect(speakerFramesTranscriptSpeakers({ transcript: "{not json" })).toBe(0)
  })

  it("no bursts without a transcript of two or more speakers (rung 3 needs someone to tell apart)", () => {
    expect(speakerFramesBudgetBreakdown({ edl: long })!.burstMs).toBe(0)
    expect(speakerFramesBudgetBreakdown({ edl: long, transcript: { words: words(["Host"]) } })!.burstMs).toBe(0)
  })

  it("20 per speaker per source, every video source, a bare video included", () => {
    const two = speakerFramesBudgetBreakdown({ edl: edl([[0, 60 * MIN]]), transcript: { words: words(["Host", "Guest"]) } })!
    expect(two.sources.map((s) => s.bursts)).toEqual([40, 40])
    expect(two.burstMs).toBe(2 * speakerFramesBurstBudgetMs(40))
    const bare = speakerFramesBudgetBreakdown({ videoUrl: "https://f.test/v.mp4", transcript: { words: words(["A", "B", "C"]) } })!
    expect(bare.sources[0]!.bursts).toBe(60)
  })

  it("never more bursts than disjoint 1.5 s windows fit in the source's spans", () => {
    // 3 s kept, padded to 7 s: at most 5 windows, whatever the speaker count.
    const short = speakerFramesBudgetBreakdown({ edl: edl([[10_000, 13_000]], ONE_CAM), transcript: { words: words(["A", "B", "C", "D"]) } })!
    expect(short.sources[0]!.bursts).toBe(Math.floor((7_000 + 1_000) / 1500))
  })

  it("a jobs row whose transcript was slimmed is charged the same as the queue payload it came from", () => {
    const queued = { edl: long, transcript: { words: words(["Host", "Guest"]) } }
    const row = { edl: long, transcriptWordCount: 50, transcriptSpeakerCount: 2, type: "speaker-frames" }
    expect(speakerFramesJobBudgetMs(row)).toBe(speakerFramesJobBudgetMs(queued))
    // A row from before the count was recorded: its word count bounds its speakers.
    expect(speakerFramesJobBudgetMs({ edl: long, transcriptWordCount: 50 })!).toBeGreaterThanOrEqual(speakerFramesJobBudgetMs(queued)!)
  })

  it("a row whose transcript had no speaker labels is charged no burst, like its queued payload", () => {
    const unlabelled = Array.from({ length: 20_000 }, (_, i) => ({ text: "w", startMs: i * 150, endMs: i * 150 + 100 }))
    const queued = { edl: long, transcript: { words: unlabelled } }
    const row = { edl: long, transcriptWordCount: 20_000, transcriptSpeakerCount: 0, type: "speaker-frames" }
    expect(speakerFramesBudgetBreakdown(row)!.burstMs).toBe(0)
    expect(speakerFramesJobBudgetMs(row)).toBe(speakerFramesJobBudgetMs(queued))
  })
})

describe("what the leaf reads off the payload", () => {
  it("a bare video is charged at the 180-minute source cap, one whole-source span", () => {
    expect(SPEAKER_FRAMES_MAX_SOURCE_MS).toBe(180 * MIN)
    const b = speakerFramesBudgetBreakdown({ videoUrl: "https://f.test/episode.mp4" })!
    expect(b.sources).toEqual([{ spans: 1, frames: 180 * 60 * 2 + 1, spanLengthsMs: null, bursts: 0 }])
    expect(b.windows).toBe(Math.ceil((180 * 60 * 2 + 1) / FACE_DETECT_MAX_FRAMES_PER_CALL))
    expect(b.descriptorMs).toBe(speakerFramesDescriptorSpanBudgetMs(undefined))
  })

  it("an EDL: every video source samples the kept spans plus the margins; spans closer than the margins merge", () => {
    // 20 s kept, 6 s cut: padded by 2 s each side the gaps close to 2 s, so they stay apart.
    const apart = speakerFramesBudgetBreakdown({ edl: edl([[0, 20_000], [26_000, 46_000]], ONE_CAM) })!
    expect(apart.sources).toEqual([{ spans: 2, frames: 2 * (Math.ceil((24_000 * 2) / 1000) + 1), spanLengthsMs: [24_000, 24_000], bursts: 0 }])
    // 20 s kept, 4 s cut: padded, they touch, and the proxy encodes them as one.
    const merged = speakerFramesBudgetBreakdown({ edl: edl([[10_000, 30_000], [34_000, 54_000]], ONE_CAM) })!
    expect(merged.sources).toEqual([{ spans: 1, frames: Math.ceil((48_000 * 2) / 1000) + 1, spanLengthsMs: [48_000], bursts: 0 }])
  })

  it("two video sources are two proxies; an audio-only source is none", () => {
    const b = speakerFramesBudgetBreakdown({ edl: edl([[0, 60_000]]) })!
    expect(b.sources).toHaveLength(2)
  })

  it("a clip pack (Edl[]) runs once over the union of the clips' spans (P3-24): one proxy per source", () => {
    const pack = clipPack(ONE_CAM)
    const b = speakerFramesBudgetBreakdown({ edl: pack })!
    expect(b.sources).toHaveLength(1)
    expect(b.sources[0]!.spans).toBe(8)
    expect(b.sources[0]!.frames).toBe(8 * (Math.ceil((64_000 * 2) / 1000) + 1))
    expect(b.windows).toBe(1)
  })

  it("never narrows by a tick list or the job's other fields: a budget over every shown source covers any subset", () => {
    const e = edl([[0, 60_000]])
    const all = speakerFramesJobBudgetMs({ edl: e })
    for (const extra of [{ sources: ["wide"] }, { transcript: { words: [] } }, { jobId: "j", usageLogId: "u", type: "speaker-frames", node_id: "n" }]) {
      expect(speakerFramesJobBudgetMs({ edl: e, ...extra })).toBe(all)
    }
  })

  it("an EDL sent as its JSON string reads the same as the object", () => {
    const e = edl([[0, 60_000]])
    expect(speakerFramesJobBudgetMs({ edl: JSON.stringify(e) })).toBe(speakerFramesJobBudgetMs({ edl: e }))
  })

  it("an EDL and a video together: the larger of the two (the handler runs one of them)", () => {
    const e = edl([[0, 60_000]], ONE_CAM)
    expect(speakerFramesJobBudgetMs({ edl: e, videoUrl: "https://f.test/v.mp4" }))
      .toBe(Math.max(speakerFramesJobBudgetMs({ edl: e })!, speakerFramesJobBudgetMs({ videoUrl: "https://f.test/v.mp4" })!))
  })

  it("grows with sources, with kept time, and with span count", () => {
    const one = speakerFramesJobBudgetMs({ edl: edl([[0, 10 * MIN]], ONE_CAM) })!
    expect(speakerFramesJobBudgetMs({ edl: edl([[0, 10 * MIN]]) })!).toBeGreaterThan(one)
    expect(speakerFramesJobBudgetMs({ edl: edl([[0, 30 * MIN]], ONE_CAM) })!).toBeGreaterThan(one)
    expect(speakerFramesJobBudgetMs({ edl: edl([[0, 5 * MIN], [6 * MIN, 11 * MIN]], ONE_CAM) })!).toBeGreaterThan(one)
  })

  it("declares a budget for every valid payload shape the route can queue", () => {
    // The payload is the private plugin route's `job.data`; until the plugin
    // exports it (P3.4, re-pinned in P3.6), these stand in for it. Every one
    // must declare a budget — `undefined` is the 90-minute sweep again.
    const e = tighten(30, 20_000, 6_000)
    const payloads = [
      { edl: e },
      { edl: [e, edl([[0, 30_000]])] },
      { videoUrl: "https://f.test/v.mp4" },
      { edl: e, transcript: { words: [{ text: "hi", startMs: 0, endMs: 300, speaker: "Host" }] } },
      { edl: e, transcriptWordCount: 1200 }, // a jobs row with the transcript slimmed away
      { edl: e, trackAssignments: [{ trackId: "wide/t1", speaker: "Host" }] },
      { edl: e, type: "speaker-frames", node_id: "n1" }, // a jobs row's input_data
    ]
    for (const p of payloads) expect(speakerFramesJobBudgetMs(p), JSON.stringify(Object.keys(p))).toBeGreaterThan(NODE_TIMEOUT_MS)
  })

  it("declares nothing for a payload it cannot read, or one with no video to sample", () => {
    for (const p of [
      undefined, null, "edl", {}, { edl: {} }, { edl: "not json" }, { edl: [] }, { videoUrl: "" }, { videoUrl: 3 },
      { edl: { sources: [], segments: [] } },
      { edl: { sources: SOURCES, segments: "x" } },
      { edl: edl([[0, 60_000]], [{ id: "mic", url: "https://f.test/mic.m4a", kind: "audio" }]) }, // audio only
      { edl: edl([[5_000, 5_000], [9_000, 2_000]]) }, // no span with length
    ]) {
      expect(speakerFramesJobBudgetMs(p), JSON.stringify(p)).toBeUndefined()
    }
  })

  it("skips a malformed segment or a malformed clip instead of declaring nothing", () => {
    const e = edl([[0, 60_000]], ONE_CAM)
    const holed = { ...e, segments: [...e.segments, null, { id: "x", inMs: "a", outMs: 3 }] } as unknown as Edl
    expect(speakerFramesJobBudgetMs({ edl: holed })).toBe(speakerFramesJobBudgetMs({ edl: e }))
    expect(speakerFramesJobBudgetMs({ edl: [e, null, "x"] })).toBe(speakerFramesJobBudgetMs({ edl: [e] }))
  })
})

// The worked numbers the PR states: pinned so a change to any ceiling shows
// up here as a number, not only as a term.
describe("worked examples", () => {
  it("the bare 180-minute source, the 90-minute Tighten edit, the 8-clip pack, and the 6-source ceiling", () => {
    const hours = (p: unknown) => Math.round((speakerFramesJobBudgetMs(p)! / H) * 100) / 100
    // Bare, 180 min: 1 span, 21,601 frames → 19 windows.
    expect(hours({ videoUrl: "https://f.test/v.mp4" })).toBe(6.25)
    // 90 min kept in 60 s runs with 3 s cuts: the margins close every cut → 1 span, 11,343 frames, 10 windows.
    expect(hours({ edl: tighten(90, 60_000, 3_000, ONE_CAM) })).toBe(4.75)
    // The same 90 min in 20 s runs with 6 s cuts: no cut closes → 270 spans of 24 s,
    // each a spawn and a probe at the span's own ceilings (was 254.25 h at the flat 45-min one).
    expect(hours({ edl: tighten(90, 20_000, 6_000, ONE_CAM) })).toBe(55.43)
    // Its descriptor term: 270 spans × 8 edge samples × 10 ms = 21.6 s of the 55.43 h.
    expect(speakerFramesBudgetBreakdown({ edl: tighten(90, 20_000, 6_000, ONE_CAM) })!.descriptorMs).toBe(270 * 8 * 10)
    // 8 clips of 60 s, 11 min apart: 8 spans of 64 s, 1,032 frames, 1 window (was 9.73 h).
    expect(hours({ edl: clipPack(ONE_CAM) })).toBe(4.02)
    // 6 cameras × 180 min: 6 × (1 span, 21,609 frames, 19 windows).
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, url: `https://f.test/c${i}.mp4`, kind: "video" }))
    expect(hours({ edl: edl([[0, 180 * MIN]], six) })).toBe(36.66)
    // P3.5's bursts with a two-speaker transcript: 40 per source, each a 1.5 s span (two encoder floors) and a 2-min capture.
    const two = { transcript: { words: [{ text: "a", startMs: 0, endMs: 3000, speaker: "Host" }, { text: "b", startMs: 3000, endMs: 6000, speaker: "Guest" }] } }
    expect(Math.round((speakerFramesBurstBudgetMs(40) / H) * 100) / 100).toBe(10.85)
    expect(hours({ edl: tighten(90, 20_000, 6_000, ONE_CAM), ...two })).toBe(Math.round((speakerFramesJobBudgetMs({ edl: tighten(90, 20_000, 6_000, ONE_CAM) })! / H + speakerFramesBurstBudgetMs(40) / H) * 100) / 100)
  })
})

// THE PROOF OBLIGATION. A step-by-step model of the handler P3.4 builds —
// per source, on that source's OWN clock (offsets and the clamp at its zero
// applied, as the handler maps master spans), the proxy the encoder would cut,
// windows of `FACE_DETECT_MAX_FRAMES_PER_CALL` frames over it — summed at each
// step's kill ceiling. The leaf must never be below it, whatever the edit.
describe("the leaf is an upper bound on the handler's step ceilings", () => {
  const overrun = FFMPEG_KILL_GRACE_MS + FFMPEG_SLOT_BACKSTOP_MS
  function modelMs(edls: readonly Edl[], speakers = 0): number {
    // Group as the handler may: by source URL (P3-5 resolves sources by url).
    const byUrl = new Map<string, ProxySpan[]>()
    for (const e of edls) {
      for (const s of e.sources) {
        if (s.kind !== "video") continue
        const off = s.offsetMs ?? 0
        const spans = e.segments
          .map((g) => ({ startMs: g.inMs - off, endMs: g.outMs - off }))
          .filter((sp) => sp.endMs > 0)
        byUrl.set(s.url, [...(byUrl.get(s.url) ?? []), ...spans])
      }
    }
    let ms = 0
    for (const kept of byUrl.values()) {
      if (kept.length === 0) continue
      const spans = normalizeProxySpans(padSpans(kept, DETECTION_SPAN_MARGIN_MS), DETECTION_PROXY.fps)
      const frames = spans.reduce((n, sp) => n + Math.ceil(((sp.endMs - sp.startMs) * DETECTION_PROXY.fps) / 1000), 0)
      ms += sourceStepsMs(spans.map((sp) => sp.endMs - sp.startMs), frames)
      // The bursts: each a disjoint 1.5 s window inside one span-map row (a row holds its span's frames).
      const rowsMs = spans.map((sp) => Math.ceil(((sp.endMs - sp.startMs) * DETECTION_PROXY.fps) / 1000) * (1000 / DETECTION_PROXY.fps))
      const fit = rowsMs.reduce((n, len) => n + Math.floor(len / SPEAKER_FRAMES_BURST_MS), 0)
      ms += burstStepsMs(speakers >= 2 ? Math.min(20 * speakers, fit) : 0)
    }
    return ms
  }

  /** One source's bursts at their ceilings: the burst proxy (fetch the original, probe it, per window an
   *  encode and its frame times, the join and its two probes), its download, one capture per window. */
  function burstStepsMs(bursts: number): number {
    if (bursts === 0) return 0
    let ms = DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS
    ms += bursts * (proxySpanEncodeTimeoutMs(SPEAKER_FRAMES_BURST_MS) + overrun + proxySpanProbeTimeoutMs(SPEAKER_FRAMES_BURST_MS))
    ms += MEDIA_PROXY_FFMPEG_TIMEOUT_MS + overrun + DEFAULT_FFMPEG_TIMEOUT_MS + FFPROBE_TIMEOUT_MS
    ms += DOWNLOAD_TIMEOUT_MS
    ms += bursts * (SPEAKER_FRAMES_BURST_CAPTURE_TIMEOUT_MS + overrun)
    return ms
  }

  /** One source's steps at their ceilings: its proxy of spans of these lengths
   *  (`undefined` = the whole source, length unknown), then windows over `frames`. */
  function sourceStepsMs(spanLengthsMs: ReadonlyArray<number | undefined>, frames: number): number {
    let ms = DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS // fetch the original, probe it
    for (const len of spanLengthsMs) { // encode + frame times, per span, at the encoder's own ceilings
      ms += len === undefined
        ? MEDIA_PROXY_FFMPEG_TIMEOUT_MS + overrun + DEFAULT_FFMPEG_TIMEOUT_MS
        : proxySpanEncodeTimeoutMs(len) + overrun + proxySpanProbeTimeoutMs(len)
    }
    ms += MEDIA_PROXY_FFMPEG_TIMEOUT_MS + overrun + DEFAULT_FFMPEG_TIMEOUT_MS + FFPROBE_TIMEOUT_MS // join, its frame times, its size
    // The descriptor frames: each span's first and last 4 samples (all of a span of 8 or fewer), wherever they fall.
    const spanFramesOf = (len: number | undefined) => (len === undefined ? Number.POSITIVE_INFINITY : Math.ceil((len * DETECTION_PROXY.fps) / 1000))
    let described = 0
    for (const len of spanLengthsMs) described += Math.min(2 * 4, spanFramesOf(len))
    for (let at = 0; at < frames; at += FACE_DETECT_MAX_FRAMES_PER_CALL) {
      const f = Math.min(FACE_DETECT_MAX_FRAMES_PER_CALL, frames - at)
      // Charged where they fall: at most `f` of them in this window, the rest in later ones.
      const here = Math.min(f, described)
      described -= here
      ms += FFPROBE_TIMEOUT_MS + faceDetectTimeoutMs(f, here) + overrun // probe, detect
      ms += SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE * SPEAKER_FRAMES_TAIL_MS_PER_BOX // its boxes, in process
    }
    return ms
  }

  // A small seeded generator: the same edits every run.
  function rng(seed: number) {
    let s = seed >>> 0
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  }

  it("on 300 random edits and packs: shared sources, offsets either side of zero, spans that merge and spans that do not", () => {
    const r = rng(20261008)
    for (let trial = 0; trial < 300; trial++) {
      const nSources = 1 + Math.floor(r() * 4)
      const sources = [
        { id: "mic", url: "https://f.test/mic.m4a", kind: "audio" },
        ...Array.from({ length: nSources }, (_, i) => ({
          id: `c${i}`,
          url: `https://f.test/c${Math.floor(r() * nSources)}.mp4`, // two ids may share a file
          kind: "video",
          offsetMs: Math.round((r() - 0.5) * 20_000),
        })),
      ]
      const clips = 1 + Math.floor(r() * 4)
      const edls: Edl[] = []
      for (let c = 0; c < clips; c++) {
        const spans: Array<[number, number]> = []
        let t = Math.floor(r() * 30_000)
        for (let k = 0, n = 1 + Math.floor(r() * 25); k < n; k++) {
          const len = 200 + Math.floor(r() * 90_000)
          spans.push([t, t + len])
          t += len + Math.floor(r() * 8_000)
        }
        edls.push(edl(spans, sources))
      }
      const speakers = Math.floor(r() * 4)
      const words = Array.from({ length: 60 }, (_, i) => ({ text: "w", startMs: i * 2500, endMs: i * 2500 + 2400, speaker: `S${i % Math.max(1, speakers)}` }))
      const payload = { ...(clips === 1 ? { edl: edls[0] } : { edl: edls }), ...(speakers > 0 ? { transcript: { words } } : {}) }
      expect(speakerFramesJobBudgetMs(payload)!, `trial ${trial}`).toBeGreaterThanOrEqual(modelMs(edls, speakers))
    }
  })

  it("for a bare video, at the cap the route enforces: one whole-source encode, no margins", () => {
    const frames = Math.ceil((SPEAKER_FRAMES_MAX_SOURCE_MS * DETECTION_PROXY.fps) / 1000)
    expect(speakerFramesJobBudgetMs({ videoUrl: "https://f.test/wide.mp4" })!).toBeGreaterThanOrEqual(sourceStepsMs([undefined], frames))
  })
})

// THE STEP INVENTORY. The bound above holds only while the proxy build and the
// detector run exactly these steps at these ceilings. A new pass (a scene-cut
// decode, a second probe) must fail here, so the leaf is updated with it.
describe("the step inventory the leaf charges", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  const count = (src: string, re: RegExp) => src.match(re)?.length ?? 0

  it("the video proxy: one big-media download, then the encode's probes, per-span spawns and join", () => {
    const proxy = read("../../../services/media-proxy.ts")
    const video = proxy.slice(proxy.indexOf("async function ensureVideoProxy"))
    expect(count(video, /\bdownloadFile\(/g)).toBe(1)
    expect(video).toMatch(/downloadFile\(sourceUrl, src, \{ limits: BIG_MEDIA_DOWNLOAD_LIMITS \}\)/)
    expect(count(video, /\brunFfmpeg\(/g)).toBe(0)
    const encode = read("../../../services/video-proxy-encode.ts")
    expect(count(encode, /\brunFfmpeg\(/g)).toBe(2) // per span, and the join
    expect(count(encode, /\brunFfprobe\(/g)).toBe(2) // the source's size, the join's size
    expect(count(encode, /\bframePtsMs\(/g)).toBe(3) // per span (with or without one), and the join
    // A span's encode and probe at its own ceilings; the whole source and the join at the proxy's.
    expect(encode).toMatch(/const timeoutMs = opts\.timeoutMs \?\? MEDIA_PROXY_FFMPEG_TIMEOUT_MS/)
    expect(encode).toMatch(/opts\.timeoutMs \?\? \(spanMs === undefined \? timeoutMs : proxySpanEncodeTimeoutMs\(spanMs\)\)/)
    expect(encode).toMatch(/framePtsMs\(path, proxySpanProbeTimeoutMs\(spanMs\)\)/)
  })

  it("a detection window: one proxy probe and one slot hold at the detector's own limit", () => {
    const detect = read("../../../services/face-detect/detect-faces.ts")
    expect(count(detect, /\brunFfprobe\(/g)).toBe(1)
    expect(count(detect, /\bwithFfmpegSlot\(/g)).toBe(1)
    expect(count(detect, /\bspawnFfmpeg\(/g)).toBe(1)
    expect(detect).toMatch(/const timeoutMs = faceDetectTimeoutMs\(frames, described\.size\)/)
    expect(detect).toMatch(/\{ timeoutMs, peakMemoryMiB, label: "face-detect" \}/)
  })
})
