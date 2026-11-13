/**
 * The measured walk (`measuredWireLengthSec` / `plannedVideoLengthSec`,
 * @nodaro/render-rules): what a step whose run measures the file it is given
 * (Mask Composite, Video Overlay) will be given, the one reading the editor's
 * quote and the server's workflow estimate share. Held here rule by rule; the
 * two estimates are held to each other by the planned-length parity fixture.
 *
 * - a render and a recording read as before; a node that will not run hands
 *   on its take; one that runs, or holds no take, is read at its planned
 *   length, never at a stored take; frozen nodes never run;
 * - the slack lands once on every clip a node makes in the run (generations,
 *   ceilings, steps whose length follows their input), never on a step that
 *   only carries its inputs' lengths, and a Loop or a Combine Videos counts
 *   each clip's;
 * - unknown stays unknown (the step's cap), a Combine Videos with a clip of
 *   unknown length included;
 * - the listing's own reading of the same rows (no context) is unchanged.
 */
import { describe, expect, it } from "vitest"
import {
  CLIP_REMAKING_KEPT_LENGTH_TYPES,
  ENGINE_SKIPPED_NODE_TYPES,
  GENERATE_VIDEO_PRO_DEFAULT_MAX_DURATION_SEC,
  LENGTH_DECIDING_MAPPABLE_FIELDS,
  PASS_THROUGH_VIDEO_TYPES,
  longestModelClipSec,
  videoProviderRenderedSec,
  MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC,
  MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC,
  VIDEO_LENGTH_RULES,
  LOSSLESS_TRIM_OVERSHOOT_SEC,
  VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC,
  generateVideoProLengthSec,
  measuredWireLengthSec,
  plannedVideoLengthSec,
  recordedTakeSec,
  recordingLengthSec,
  nodaroVideoUpscaleRefusesLength,
  type EstimateGraphEdge,
  type EstimateGraphNode,
} from "@nodaro/render-rules"
import { getLipSyncMaxAudioSeconds, ltxExtendDurationSec } from "@nodaro/shared/credits"
import { pricedOutputDurationSec, resolveVideoProviderForMode } from "@nodaro/shared/models"
import { NODE_MAPPABLE_FIELDS, settingsProviderModels } from "@nodaro/shared/nodes"
import { VIDEO_OUTPUT_LENGTH_RULES, videoOutputLength } from "../video-output-length.js"

type N = EstimateGraphNode & { readonly type: string; readonly data?: Record<string, unknown> }
const upload = (id: string, sec: number): N => ({ id, type: "upload-video", data: { url: `https://cdn.example/${id}.mp4`, generatedResults: [{ url: `https://cdn.example/${id}.mp4`, duration: sec }], activeResultIndex: 0 } })
const take = (sec: number | undefined, url = "https://cdn.example/take.mp4") => ({ generatedResults: [{ url, ...(sec === undefined ? {} : { duration: sec }) }], activeResultIndex: 0 })
const wire = (source: string, target: string, targetHandle = "video"): EstimateGraphEdge => ({ source, target, targetHandle })
const gen = (id: string, data: Record<string, unknown>): N => ({ id, type: "generate-video", data })
const MC = MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC
const LIP = MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC["lip-sync"]
const VO = VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC

/** The walk from `id` over `nodes` / `edges`, with every node running (or `run`), at `slack`. */
const read = (id: string, nodes: N[], edges: EstimateGraphEdge[], slack = 0, run: Iterable<string> = nodes.map((n) => n.id)) =>
  measuredWireLengthSec(id, nodes, edges, new Set(run), { plannedClipSlackSec: slack })

describe("the slack constants: one per measuring step", () => {
  it("Mask Composite charges the container (a frame plus an audio tail); Video Overlay the stream (one 24 fps frame)", () => {
    expect(MC).toBe(0.1)
    expect(VO).toBeCloseTo(1 / 24, 12)
  })
})

describe("recordings and takes", () => {
  it("an upload is read at its recorded length, with no slack", () => {
    const u = upload("u", 23)
    expect(read("u", [u], [], MC)).toBe(23)
    expect(recordingLengthSec(u)).toBe(23)
  })

  it("a node that will not run hands on its take — its recorded length, no slack; a video generation's take with none recorded at its planned length, any other unknown", () => {
    const g = gen("g", { provider: "kling-4", duration: 10, ...take(5.042) })
    expect(read("g", [g], [], MC, [])).toBe(5.042)
    // A run that follows its own length records it, so a generation's take with none was made at its settings: its Duration plus the slack.
    expect(read("g", [gen("g", { provider: "kling-4", duration: 10, ...take(undefined) })], [], MC, [])).toBeCloseTo(10 + MC, 9)
    expect(read("g", [{ id: "g", type: "image-to-video", data: { provider: "kling-4", duration: 5, ...take(undefined) } }], [], MC, [])).toBeCloseTo(5 + MC, 9)
    // Any other node's take with none recorded: unknown.
    const resize: N = { id: "r", type: "resize-video", data: { ...take(undefined) } }
    expect(read("r", [upload("u", 10), resize], [wire("u", "r")], MC, [])).toBeUndefined()
  })

  it("a node that will run is read at its planned length, never at its stored take (longer or shorter)", () => {
    expect(read("g", [gen("g", { provider: "kling-4", duration: 10, ...take(5.042) })], [])).toBe(10)
    // A 15 s take with the setting now 5 s: the run renders 5 s, never the take's 15 s.
    expect(read("g", [gen("g", { provider: "kling-4", duration: 5, ...take(15) })], [])).toBe(5)
  })

  it("a node that holds no take is read at its planned length even when it does not run (what reaches the step is a fresh run)", () => {
    expect(read("g", [gen("g", { provider: "kling-4", duration: 5 })], [], MC, [])).toBeCloseTo(5 + MC, 9)
  })

  it("a frozen node never runs: in the run set or not, it hands on its take", () => {
    const g = gen("g", { provider: "kling-4", duration: 10, skipped: true, ...take(5.042) })
    expect(read("g", [g], [], MC, ["g"])).toBe(5.042)
    expect(read("g", [g], [], MC, [])).toBe(5.042)
  })

  it("a step that keeps its input's length: re-run, its input; not run, its own take", () => {
    const nodes = [upload("u", 20), { id: "r", type: "resize-video", data: take(5, "https://cdn.example/r.mp4") }]
    const edges = [wire("u", "r")]
    expect(read("r", nodes, edges)).toBe(20)
    expect(read("r", nodes, edges, 0, [])).toBe(5)
  })
})

describe("generations: the length the model renders for the settings", () => {
  it("a length the model does not offer snaps to the one it renders", () => {
    expect(read("g", [{ id: "g", type: "image-to-video", data: { provider: "kling", duration: 7 } }], [])).toBe(5)
  })

  it("no model and no duration: the run's own default (its model at its short default), not that model's own default", () => {
    expect(read("g", [gen("g", {})], [])).toBe(4)
    // The listing's reading of the same row is unchanged: the default model at its own default.
    expect(VIDEO_LENGTH_RULES["generate-video"]!.run!({ id: "g", type: "generate-video", data: {} }, [])).toEqual({ fixedSec: pricedOutputDurationSec("seedance-2-fast", undefined), perEpisodeSec: 0 })
  })

  it("Auto: the model's longest clip", () => {
    expect(read("g", [gen("g", { provider: "seedance-2-5", duration: -1 })], [])).toBe(30)
  })

  it("a reference clip a Seedance edit follows: up to the clip; Kling 4.0 renders exactly its length", () => {
    const u = upload("u", 12)
    expect(read("g", [u, gen("g", { provider: "seedance-2-5", duration: 5 })], [wire("u", "g", "videoReferences")])).toBe(12)
    expect(read("g", [u, gen("g", { provider: "kling-4", duration: 5 })], [wire("u", "g", "videoReferences")])).toBe(5)
    // A clip of unknown length: the most the model takes.
    const unknown: N = { id: "u", type: "upload-video", data: { url: "https://cdn.example/u.mp4" } }
    expect(read("g", [unknown, gen("g", { provider: "seedance-2-5", duration: 5 })], [wire("u", "g", "videoReferences")])).toBe(30)
  })

  it("the listing's reading of a generation with a reference clip is unchanged: the configured length", () => {
    const inputs = [{ sourceId: "u", handle: "videoReferences", kind: "video" as const, length: { fixedSec: 12, perEpisodeSec: 0 } }]
    expect(VIDEO_LENGTH_RULES["generate-video"]!.run!({ id: "g", type: "generate-video", data: { provider: "seedance-2-5", duration: 5 } }, inputs)).toEqual({ fixedSec: 5, perEpisodeSec: 0 })
  })

  it("Generate Video Pro reads the cap it is given (the server's env; the editor's default)", () => {
    const pro: N = { id: "p", type: "generate-video-pro", data: { provider: "seedance-2", duration: 200 } }
    const at = (cap: number) => measuredWireLengthSec("p", [pro], [], new Set(["p"]), { generateVideoProCapSec: cap })
    expect(at(60)).toBe(generateVideoProLengthSec("seedance-2", 200, 60))
    expect(at(GENERATE_VIDEO_PRO_DEFAULT_MAX_DURATION_SEC)).toBe(generateVideoProLengthSec("seedance-2", 200, GENERATE_VIDEO_PRO_DEFAULT_MAX_DURATION_SEC))
    expect(measuredWireLengthSec("p", [pro], [], new Set(["p"]))).toBe(at(GENERATE_VIDEO_PRO_DEFAULT_MAX_DURATION_SEC))
  })
})

describe("the slack: once on each clip a node makes in the run, carried on by the length rules", () => {
  const g5 = gen("g", { provider: "kling-4", duration: 5 })

  it("a generation gets its step's slack", () => {
    expect(read("g", [g5], [], MC)).toBeCloseTo(5.1, 9)
    expect(read("g", [g5], [], VO)).toBeCloseTo(5 + 1 / 24, 9)
  })

  it("a Loop of a planned clip carries it on each copy; a Combine Videos on each clip", () => {
    const loop: N = { id: "l", type: "loop-video", data: { mode: "repeat", repeatCount: 2 } }
    expect(read("l", [g5, loop], [wire("g", "l")], VO)).toBeCloseTo(2 * (5 + 1 / 24), 9)
    const g2 = gen("h", { provider: "kling-4", duration: 5 })
    const combine: N = { id: "m", type: "combine-videos", data: {} }
    expect(read("m", [g5, g2, combine], [wire("g", "m", "in"), wire("h", "m", "in")], MC)).toBeCloseTo(10.2, 9)
  })

  it("an Extend Video adds it on the seconds it adds, over its source's own", () => {
    const tail: N = { id: "x", type: "extend-video", data: { provider: "seedance-2-5-extend", duration: 5 } }
    expect(read("x", [upload("u", 10), tail], [wire("u", "x")], MC)).toBeCloseTo(15.1, 9)
    expect(read("x", [g5, tail], [wire("g", "x")], MC)).toBeCloseTo(5.1 + 5.1, 9)
    const ltx: N = { id: "x", type: "extend-video", data: { provider: "ltx-2.3-pro", duration: 6 } }
    expect(read("x", [upload("u", 10), ltx], [wire("u", "x")], MC)).toBeCloseTo(10 + ltxExtendDurationSec(6) + MC, 9)
  })

  it("a fixed Trim window, an upload and a take get none", () => {
    const trim: N = { id: "t", type: "trim-video", data: { trimMode: "time", startTime: 0, endTime: 10 } }
    expect(read("t", [g5, trim], [wire("g", "t")], MC)).toBe(10)
    expect(read("u", [upload("u", 10)], [], MC)).toBe(10)
    expect(read("g", [gen("g", { provider: "kling-4", duration: 5, ...take(5.4) })], [], MC, [])).toBe(5.4)
  })

  it("knownOnly: only a length the graph knows — a recording, a take's record; nothing planned", () => {
    const known = (id: string, nodes: N[], edges: EstimateGraphEdge[], run: Iterable<string>) => measuredWireLengthSec(id, nodes, edges, new Set(run), { knownOnly: true })
    expect(known("u", [upload("u", 75)], [], [])).toBe(75)
    expect(known("g", [gen("g", { provider: "kling-4", duration: 10, ...take(5.042) })], [], [])).toBe(5.042)
    // A generation that runs, or one whose take recorded no length (read at its planned length otherwise): not known.
    expect(known("g", [gen("g", { provider: "kling-4", duration: 10, ...take(5.042) })], [], ["g"])).toBeUndefined()
    expect(known("g", [gen("g", { provider: "kling-4", duration: 10, ...take(undefined) })], [], [])).toBeUndefined()
    // A step that runs on a known upload is planned, so not known either.
    const loop: N = { id: "l", type: "loop-video", data: { mode: "repeat", repeatCount: 2 } }
    expect(known("l", [upload("u", 40), loop], [wire("u", "l", "in")], ["l"])).toBeUndefined()
    // A render that does not run again hands on its cut: the length recorded with it is known; one that runs is estimated.
    const render: N = { id: "r", type: "apply-edl", data: { ...take(75) } }
    expect(known("r", [render], [], [])).toBe(75)
    expect(known("r", [render], [], ["r"])).toBeUndefined()
    expect(known("r", [{ id: "r", type: "apply-edl", data: { ...take(undefined) } }], [], [])).toBeUndefined()
    // A cut recorded just under the 60 s limit is known and under it: Nodaro Video Upscale prices it, never refuses it.
    expect(known("r", [{ id: "r", type: "apply-edl", data: { ...take(59.5) } }], [], [])).toBe(59.5)
    expect(nodaroVideoUpscaleRefusesLength(known("r", [{ id: "r", type: "apply-edl", data: { ...take(59.5) } }], [], []))).toBe(false)
    expect(nodaroVideoUpscaleRefusesLength(known("r", [render], [], []))).toBe(true)
  })

  it("a Trim with Lossless on passes on at most the end of its cut plus the copy's overshoot, never past its input; the smart loop cut never snaps", () => {
    const trim = (data: Record<string, unknown>): N => ({ id: "t", type: "trim-video", data: { ...data, losslessKeyframe: true } })
    const O = LOSSLESS_TRIM_OVERSHOOT_SEC
    // A 3–8 s stream copy of a 10 s clip whose keyframes sit at 0 and 10 s measures 8.083 s, not the 5 s window.
    expect(read("t", [upload("u", 10), trim({ trimMode: "time", startTime: 3, endTime: 8 })], [wire("u", "t")], MC)).toBeCloseTo(8 + O, 9)
    expect(read("t", [upload("u", 10), { id: "t", type: "trim-video", data: { trimMode: "time", startTime: 3, endTime: 8 } }], [wire("u", "t")], MC)).toBe(5)
    // Never past its input.
    expect(read("t", [upload("u", 10), trim({ trimMode: "time", startTime: 0, endTime: 60 })], [wire("u", "t")], MC)).toBe(10)
    expect(read("t", [upload("u", 10), trim({ trimMode: "keep-first-seconds", keepFirstSeconds: 4 })], [wire("u", "t")], MC)).toBeCloseTo(4 + O, 9)
    // Seconds mode: the input less what it trims off the end, plus the overshoot.
    expect(read("t", [upload("u", 20), trim({ trimMode: "seconds", trimStartSeconds: 2, trimEndSeconds: 5 })], [wire("u", "t")], MC)).toBeCloseTo(15 + O, 9)
    // A cut that runs to the clip's end, or whose tail is in frames: the input.
    expect(read("t", [upload("u", 20), trim({ trimMode: "keep-last-seconds", keepLastSeconds: 4 })], [wire("u", "t")], MC)).toBe(20)
    expect(read("t", [upload("u", 20), trim({ trimMode: "frames", trimStartFrames: 24, trimEndFrames: 48 })], [wire("u", "t")], MC)).toBe(20)
    // The smart loop cut never snaps: read as it always was, its input's length.
    expect(read("t", [upload("u", 20), trim({ trimMode: "smart-loop-cut" })], [wire("u", "t")], MC)).toBe(20)
  })

  it("a lossless Trim of an input of unknown length: the end of its cut plus the overshoot when the cut has an end; the last N seconds at N, a minimum; else unknown", () => {
    const unknown: N = { id: "u", type: "upload-video", data: { url: "https://cdn.example/nolen.mp4" } }
    const trim = (data: Record<string, unknown>): N => ({ id: "t", type: "trim-video", data: { ...data, losslessKeyframe: true } })
    expect(read("t", [unknown, trim({ trimMode: "time", startTime: 0, endTime: 60 })], [wire("u", "t")], MC)).toBeCloseTo(60 + LOSSLESS_TRIM_OVERSHOOT_SEC, 9)
    expect(read("t", [unknown, trim({ trimMode: "keep-first-seconds", keepFirstSeconds: 12 })], [wire("u", "t")], MC)).toBeCloseTo(12 + LOSSLESS_TRIM_OVERSHOOT_SEC, 9)
    expect(read("t", [unknown, trim({ trimMode: "time", startTime: 5 })], [wire("u", "t")], MC)).toBeUndefined()
    // The last N seconds: at least N (an earlier keyframe can only add) — a minimum, as with Lossless off, never unknown.
    expect(read("t", [unknown, trim({ trimMode: "keep-last-seconds", keepLastSeconds: 4 })], [wire("u", "t")], MC)).toBe(4)
  })

  it("a Trim that does not run again hands on its take at the length its run recorded: exact, with no allowance", () => {
    const recorded: N = { id: "t", type: "trim-video", data: { trimMode: "time", startTime: 3, endTime: 8, losslessKeyframe: true, ...take(8.083) } }
    expect(read("t", [upload("u", 10), recorded], [wire("u", "t")], MC, [])).toBe(8.083)
    const whole: N = { id: "t", type: "trim-video", data: { trimMode: "time", startTime: 0, endTime: 5, ...take(5) } }
    expect(read("t", [upload("u", 10), whole], [wire("u", "t")], MC, [])).toBe(5)
  })

  it("a generation's take: the length its run recorded, a whole-second record with the quarter second it may leave off", () => {
    // A record is the file less a container overhang of at most a quarter second past a whole second, so a
    // whole-second record may sit up to that under the file the step measures; any other record is the file's own.
    expect(recordedTakeSec("generate-video", 5)).toBe(5.25)
    expect(recordedTakeSec("generate-video", 5.4)).toBe(5.4)
    expect(recordedTakeSec("upload-video", 5)).toBe(5)
    expect(read("g", [gen("g", { provider: "seedance-2-5", duration: -1, ...take(5) })], [], MC, [])).toBe(5.25)
    expect(read("g", [gen("g", { provider: "seedance-2-5", duration: -1, ...take(undefined) })], [], MC, [])).toBeCloseTo(pricedOutputDurationSec("seedance-2-5", -1) + MC, 9)
  })

  it("a step whose length follows its input makes a clip: it adds the slack (Lip Sync of a known audio, Video to Video of an upload)", () => {
    const audio: N = { id: "a", type: "upload-audio", data: { url: "https://cdn.example/a.mp3", metadata: { durationSeconds: 9 } } }
    const lip: N = { id: "s", type: "lip-sync", data: { provider: "kling-avatar" } }
    expect(read("s", [audio, lip], [wire("a", "s", "audio")], MC)).toBeCloseTo(9 + MC, 9)
    const v2v: N = { id: "v", type: "video-to-video", data: { provider: "wan" } }
    expect(read("v", [upload("u", 12), v2v], [wire("u", "v")], VO)).toBeCloseTo(12 + VO, 9)
  })

  it("a ceiling that reads no setting is a planned clip too (3D Render Pro, UGC Clip)", () => {
    expect(read("p", [{ id: "p", type: "pro-3d-render", data: {} }], [], MC)).toBeCloseTo(60 + MC, 9)
    expect(read("k", [{ id: "k", type: "ugc-clip", data: {} }], [], VO)).toBeCloseTo(30 + VO, 9)
  })

  it("once per clip made, never again at a step that only carries its input (Lip Sync → Motion Transfer adds two; → Resize → Fade adds one)", () => {
    const audio: N = { id: "a", type: "upload-audio", data: { url: "https://cdn.example/a.mp3", metadata: { durationSeconds: 10 } } }
    const lip: N = { id: "s", type: "lip-sync", data: { provider: "kling-avatar" } }
    const motion: N = { id: "m", type: "motion-transfer", data: {} }
    expect(read("m", [audio, lip, motion], [wire("a", "s", "audio"), wire("s", "m")], MC)).toBeCloseTo(10 + 2 * MC, 9)
    const resize: N = { id: "r", type: "resize-video", data: {} }
    const fade: N = { id: "f", type: "fade-video", data: {} }
    expect(read("f", [audio, lip, resize, fade], [wire("a", "s", "audio"), wire("s", "r"), wire("r", "f")], MC)).toBeCloseTo(10 + MC, 9)
  })

  it("every row that only carries its inputs says so; every producer that makes a clip does not", () => {
    const carriers = Object.entries(VIDEO_LENGTH_RULES).filter(([, rule]) => rule.carries).map(([type]) => type)
    for (const type of ["trim-video", "loop-video", "combine-videos", "video-sfx", "pitch-tempo", "resize-video", "fade-video", "add-captions", "merge-video-audio", "split-media"]) expect(carriers, type).toContain(type)
    // A provider's voice or dub (Voice Changer, Voice Changer Pro, Dubbing) and Adjust Volume's ffmpeg re-render make a new file.
    for (const type of ["generate-video", "generate-video-pro", "cinematic-avatar", "extend-video", "lip-sync", "ai-avatar", "motion-transfer", "video-to-video", "pro-3d-render", "ugc-clip", "ugc-finish-clips", "speed-ramp", "slideshow", "edit-video-pro", "face-swap", "video-retake", "video-upscale", "switchx", "video-mask", "video-depth", "voice-changer", "voice-changer-pro", "dubbing", "adjust-volume"]) expect(carriers, type).not.toContain(type)
  })

  it("Voice Changer, Voice Changer Pro, Dubbing and Adjust Volume make a new file of what they are given: its length plus the slack", () => {
    const audio: N = { id: "a", type: "upload-audio", data: { url: "https://cdn.example/a.mp3", metadata: { durationSeconds: 8 } } }
    for (const type of ["voice-changer", "voice-changer-pro", "dubbing", "adjust-volume"]) {
      expect(read("n", [audio, { id: "n", type, data: {} }], [wire("a", "n", "audio")], MC), type).toBeCloseTo(8 + MC, 9)
      expect(read("n", [upload("u", 10), { id: "n", type, data: {} }], [wire("u", "n")], MC), type).toBeCloseTo(10 + MC, 9)
    }
  })

  it("a generated voice made again in the run: unknown, unless the caller asks for its take as a minimum (Lip Sync)", () => {
    const tts = (sec: number | undefined): N => ({ id: "t", type: "text-to-speech", data: { text: "hi", ...(sec === undefined ? {} : take(sec)) } })
    expect(read("t", [tts(40)], [], LIP)).toBeUndefined()
    const asLipSync = (nodes: N[]) => measuredWireLengthSec("t", nodes, [], new Set(nodes.map((n) => n.id)), { plannedClipSlackSec: LIP, voiceTakeAsMinimum: true })
    expect(asLipSync([tts(40)])).toBe(40)
    expect(asLipSync([tts(undefined)])).toBeUndefined()
    expect(asLipSync([{ id: "t", type: "text-to-dialogue", data: { ...take(33) } }])).toBe(33)
    // A known length the caller reads (the listing's script) comes first.
    expect(measuredWireLengthSec("t", [tts(40)], [], new Set(["t"]), { voiceTakeAsMinimum: true, knownLengthSec: () => 12 })).toBe(12)
    // Not a voice: unchanged.
    expect(measuredWireLengthSec("m", [{ id: "m", type: "generate-music", data: { ...take(120) } }], [], new Set(["m"]), { voiceTakeAsMinimum: true })).toBeUndefined()
  })

  it("a provider step that keeps its input's length re-renders the clip: it adds the slack once; a local one adds none", () => {
    expect([...CLIP_REMAKING_KEPT_LENGTH_TYPES].sort()).toEqual(["face-swap", "switchx", "video-depth", "video-mask", "video-retake", "video-upscale"])
    for (const type of CLIP_REMAKING_KEPT_LENGTH_TYPES) {
      expect(read("n", [upload("u", 10), { id: "n", type, data: {} }], [wire("u", "n")], MC), type).toBeCloseTo(10 + MC, 9)
    }
    expect(read("n", [upload("u", 10), { id: "n", type: "resize-video", data: {} }], [wire("u", "n")], MC)).toBe(10)
    // The listing's pass-through set is unchanged: the same length rule.
    for (const type of CLIP_REMAKING_KEPT_LENGTH_TYPES) expect(PASS_THROUGH_VIDEO_TYPES).toContain(type)
  })
})

describe("unknown stays unknown: the step's cap", () => {
  it("VEO and Runway extend add a length the catalog does not declare", () => {
    const veo: N = { id: "x", type: "extend-video", data: { duration: 5 } }
    expect(read("x", [upload("u", 10), veo], [wire("u", "x")])).toBeUndefined()
  })

  it("a Combine Videos with one clip of unknown length is unknown — never the 8 s stand-in the forwarded charge reads", () => {
    const veo: N = { id: "x", type: "extend-video", data: { provider: "veo-extend", duration: 5 } }
    const combine: N = { id: "m", type: "combine-videos", data: {} }
    expect(read("m", [upload("u", 10), veo, combine], [wire("u", "x"), wire("u", "m", "in"), wire("x", "m", "in")])).toBeUndefined()
  })

  it("a re-running Lip Sync with no audio wired: its provider's audio cap", () => {
    const lip: N = { id: "s", type: "lip-sync", data: take(7.5, "https://cdn.example/s.mp4") }
    expect(read("s", [lip], [])).toBe(getLipSyncMaxAudioSeconds("kling-avatar"))
    expect(read("s", [lip], [], 0, [])).toBe(7.5)
  })

  it("a node no rule bounds, a missing source and a cycle", () => {
    expect(read("r", [{ id: "r", type: "render-video", data: {} }], [])).toBeUndefined()
    expect(read("nope", [], [])).toBeUndefined()
    const a: N = { id: "a", type: "resize-video", data: {} }
    const b: N = { id: "b", type: "fade-video", data: {} }
    expect(read("a", [a, b], [wire("b", "a"), wire("a", "b")])).toBeUndefined()
  })
})

describe("a length-deciding field a run maps (duration, provider): read as the run resolves it", () => {
  const g = (data: Record<string, unknown>): N => gen("g", { provider: "kling-4", duration: 5, ...data })

  it("a Duration node on the field-duration wire, or named by a field mapping: its value", () => {
    const d: N = { id: "d", type: "duration", data: { seconds: 15 } }
    expect(read("g", [d, g({})], [wire("d", "g", "field-duration")])).toBe(15)
    expect(read("g", [d, g({ fieldMappings: { duration: { sourceNodeId: "d" } } })], [])).toBe(15)
  })

  it("a Provider node: its model", () => {
    const p: N = { id: "p", type: "provider", data: { provider: "ltx-2.3-pro" } }
    expect(read("g", [p, g({ fieldMappings: { provider: { sourceNodeId: "p" } } })], [])).toBe(6)
  })

  it("a Text node (a parameter node): its value, set before the run", () => {
    const x: N = { id: "x", type: "text-prompt", data: { text: "15" } }
    expect(read("g", [x, g({ fieldMappings: { duration: { sourceNodeId: "x" } } })], [])).toBe(15)
    expect(read("g", [x, g({})], [wire("x", "g", "field-duration")])).toBe(15)
  })

  it("a value another node produces at run time (an LLM's answer) is open: the model's longest clip; every model the node may run", () => {
    const t: N = { id: "t", type: "llm-chat", data: {} }
    expect(read("g", [t, g({ fieldMappings: { duration: { sourceNodeId: "t" } } })], [])).toBe(longestModelClipSec("kling-4"))
    expect(read("g", [t, g({})], [wire("t", "g", "field-duration")])).toBe(longestModelClipSec("kling-4"))
    const open = read("g", [t, g({ fieldMappings: { provider: { sourceNodeId: "t" } } })], [])!
    for (const model of settingsProviderModels("generate-video")) expect(open, model).toBeGreaterThanOrEqual(videoProviderRenderedSec(model, { duration: 5 }))
    // Both open: each model at its longest clip — unknown (the cap) while any model it may run declares no lengths.
    const both = read("g", [t, g({ fieldMappings: { provider: { sourceNodeId: "t" }, duration: { sourceNodeId: "t" } } })], [])
    const twins = settingsProviderModels("generate-video").flatMap((m) => [resolveVideoProviderForMode(m, "image-to-video"), resolveVideoProviderForMode(m, "text-to-video")])
    const longest = twins.map((m) => longestModelClipSec(m))
    expect(both).toBe(longest.some((l) => l === undefined) ? undefined : Math.max(...(longest as number[])))
  })

  it("Generate Video Pro: an open duration is the most a run may ask for; a Duration node its value", () => {
    const t: N = { id: "t", type: "llm-chat", data: {} }
    const pro = (data: Record<string, unknown>): N => ({ id: "p", type: "generate-video-pro", data: { provider: "seedance-2", duration: 10, ...data } })
    expect(read("p", [t, pro({ fieldMappings: { duration: { sourceNodeId: "t" } } })], [])).toBe(generateVideoProLengthSec("seedance-2", GENERATE_VIDEO_PRO_DEFAULT_MAX_DURATION_SEC, GENERATE_VIDEO_PRO_DEFAULT_MAX_DURATION_SEC))
    const d: N = { id: "d", type: "duration", data: { seconds: 20 } }
    expect(read("p", [d, pro({})], [wire("d", "p", "field-duration")])).toBe(generateVideoProLengthSec("seedance-2", 20, GENERATE_VIDEO_PRO_DEFAULT_MAX_DURATION_SEC))
  })

  it("a Settings input sets the field over a field mapping; a field wire over both; a mapping to a missing node leaves the stored value", () => {
    const d: N = { id: "d", type: "duration", data: { seconds: 10 } }
    const t: N = { id: "t", type: "llm-chat", data: {} }
    expect(read("g", [d, t, g({ fieldMappings: { duration: { sourceNodeId: "t" } } })], [wire("d", "g", "settings")])).toBe(10)
    const d15: N = { id: "e", type: "duration", data: { seconds: 15 } }
    expect(read("g", [d, d15, g({})], [wire("d", "g", "settings"), wire("e", "g", "field-duration")])).toBe(15)
    expect(read("g", [g({ fieldMappings: { duration: { sourceNodeId: "gone" } } })], [])).toBe(5)
  })

  it("only Generate Video and Generate Video Pro map a length-deciding field; every other mappable field of a video producer is content", () => {
    const CONTENT = new Set(["prompt", "negativePrompt", "scenePrompt", "aspectRatio"])
    const producers = Object.keys(VIDEO_LENGTH_RULES)
    const deciding = producers.filter((t) => (NODE_MAPPABLE_FIELDS[t] ?? []).some((f) => LENGTH_DECIDING_MAPPABLE_FIELDS.includes(f)))
    expect(deciding.sort()).toEqual(["generate-video", "generate-video-pro"])
    for (const t of producers) {
      for (const f of NODE_MAPPABLE_FIELDS[t] ?? []) expect(CONTENT.has(f) || LENGTH_DECIDING_MAPPABLE_FIELDS.includes(f), `${t}.${f}: a new mappable field on a video producer — does it decide the length?`).toBe(true)
    }
  })
})

describe("a value the run's user types with no bound (openSourceIds, a listing's free-text app input)", () => {
  it("makes a mapping from a parameter node open; without it, the saved value stands", () => {
    const x: N = { id: "x", type: "text-prompt", data: { text: "5" } }
    const g: N = gen("g", { provider: "kling-4", duration: 5, fieldMappings: { duration: { sourceNodeId: "x" } } })
    expect(read("g", [x, g], [])).toBe(5)
    expect(measuredWireLengthSec("g", [x, g], [], new Set(["g"]), { openSourceIds: new Set(["x"]) })).toBe(longestModelClipSec("kling-4"))
  })
})

describe("the run engine's skipped types never run", () => {
  it("a Manual Edit in the run set hands on its take (the engine never executes it)", () => {
    const edit: N = { id: "e", type: "manual-edit", data: take(7.5, "https://cdn.example/e.mp4") }
    expect(read("e", [edit], [], MC, ["e"])).toBe(7.5)
    expect(ENGINE_SKIPPED_NODE_TYPES.has("manual-edit")).toBe(true)
  })
})

describe("Video to Video on a Seedance edit model: the Auto edit's bound", () => {
  it("the source rounded up plus a second, at most the model's longest clip; an unknown source at the most it takes", () => {
    const v: N = { id: "v", type: "video-to-video", data: { provider: "seedance-2-5" } }
    expect(read("v", [upload("u", 9.2), v], [wire("u", "v")])).toBe(11)
    expect(read("v", [upload("u", 29.5), v], [wire("u", "v")])).toBe(30)
    expect(read("v", [{ id: "u", type: "upload-video", data: { url: "https://cdn.example/u.mp4" } }, v], [wire("u", "v")])).toBe(30)
    // Another model keeps its own rule: its input, or its set length when longer.
    expect(read("v", [upload("u", 9.2), { id: "v", type: "video-to-video", data: { provider: "wan" } }], [wire("u", "v")])).toBe(9.2)
  })
})

describe("plannedVideoLengthSec: one node from its inputs' lengths", () => {
  it("a Mix Audio that ends with its voice keeps the voice's length (outside the table)", () => {
    const mix: N = { id: "m", type: "mix-audio", data: { endAt: "voice", duckUnder: "v" } }
    expect(plannedVideoLengthSec(mix, (id) => (id === "v" ? 42 : 90), [mix], [wire("v", "m", "in"), wire("b", "m", "in")])).toBe(42)
  })

  it("Mask Composite with a pixelate fill follows its background", () => {
    const mc: N = { id: "c", type: "mask-composite", data: { fill: "pixelate" } }
    const lengths: Record<string, number> = { f: 12, b: 41 }
    expect(plannedVideoLengthSec(mc, (id) => lengths[id], [mc], [wire("f", "c"), wire("b", "c", "background-video")])).toBe(41)
  })
})

describe("the listing composes the same rows", () => {
  it("every render-rules row is the backend table's, and the backend adds only the node units' unbounded rows", () => {
    for (const [type, rule] of Object.entries(VIDEO_LENGTH_RULES)) expect(VIDEO_OUTPUT_LENGTH_RULES[type], type).toBe(rule)
    for (const type of Object.keys(VIDEO_OUTPUT_LENGTH_RULES).filter((t) => !(t in VIDEO_LENGTH_RULES))) {
      expect(videoOutputLength({ id: "n", type, data: {} }, []), type).toBe("unknown")
    }
  })
})
