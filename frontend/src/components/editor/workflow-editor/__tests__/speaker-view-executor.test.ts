/**
 * The canvas's own run of a Speaker View node (C3.2): the checks the server's
 * payload builder makes, before anything is sent. While Speaker View has no
 * price the answer is always "not priced yet" — in the plugin's own words — and
 * nothing is sent. With the price flag let through (as C4 will), the body is
 * the one both engines send.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { toastError, toastWarning, toastInfo, polls, flag } = vi.hoisted(() => ({ toastError: vi.fn(), toastWarning: vi.fn(), toastInfo: vi.fn(), polls: [] as Array<{ call: () => Promise<unknown>; extra?: unknown; resultFields?: unknown }>, flag: { priced: false, frames: true } }))

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn(), info: toastInfo, warning: toastWarning }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))
vi.mock("@nodaro/render-rules", async (orig) => (await import("@/test-utils/speaker-view-video-gate-mock")).withVideoGate(await orig<typeof import("@nodaro/render-rules")>(), flag))
const speakerViewApi = vi.fn(async (_p: unknown) => ({ jobId: "job-1" }))
const getJobStatus = vi.fn(async (_id: string): Promise<unknown> => null)
const measureClipLength = vi.fn(async (_p: unknown): Promise<{ durationMs: number; width?: number; height?: number; faces?: "present" | "none" | "unknown" }> => ({ durationMs: 14_600, width: 3840, height: 2160 }))
vi.mock("@/lib/api", () => ({ speakerView: (p: unknown) => speakerViewApi(p), getJobStatus: (id: string) => getJobStatus(id), measureClipLength: (p: unknown) => measureClipLength(p) }))
vi.mock("../poll-job", () => ({
  pollJobWithNodeUpdate: (_id: string, call: () => Promise<unknown>, _key: unknown, _label: string, _ctx: unknown, extra: unknown, _est: unknown, opts: { resultFields?: unknown }) => {
    polls.push({ call, extra, resultFields: opts?.resultFields })
    return Promise.resolve("done")
  },
}))
vi.mock("@/hooks/use-workflow-store", () => ({ useWorkflowStore: { getState: () => ({ nodes: [], edges: [] }) } }))

import { executeSpeakerView, runSpeakerView } from "../speaker-view-executor"
import { SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE, speakerViewVideoEdit } from "@nodaro/render-rules"
import { translate } from "@/lib/i18n"
import { ClipMeasureStopped } from "@/lib/clip-measure-poll"
import { WorkflowStaleError } from "../types"
import type { WorkflowNode } from "@/types/nodes"

const src = (id: string) => ({ id, url: `https://x/${id}.mp4`, kind: "video" })
const seg = (id: string, inS: number, video: string, speaker: string) => ({ id, inMs: inS * 1000, outMs: (inS + 5) * 1000, video, speaker })
const EDL = { version: 1, clock: "master", sources: [src("a"), src("b")], segments: [seg("s0", 0, "a", "Host"), seg("s1", 5, "b", "Guest")] }
const node = (data: Record<string, unknown> = {}) => ({ id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View", ...data } }) as unknown as WorkflowNode
const ctxBase = { userId: "user-1", isWorkflowStale: () => false }
const ctx = ctxBase as never

beforeEach(() => {
  vi.clearAllMocks()
  polls.length = 0
  flag.priced = false
  flag.frames = true
})

describe("executeSpeakerView", () => {
  it("refuses a run with no edit, naming the input", async () => {
    await expect(executeSpeakerView(node(), {}, ctx, undefined)).rejects.toThrow("speaker-view requires an EDL")
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining(translate("en", "nodeRun.speakerViewConnectEdl")))
    expect(polls).toHaveLength(0)
  })

  it("refuses an edit the plugin would refuse, in the rule's words, before anything is sent", async () => {
    const unnamed = { ...EDL, segments: EDL.segments.map(({ speaker: _s, ...rest }) => rest) }
    await expect(executeSpeakerView(node(), { edl: JSON.stringify(unnamed) }, ctx, undefined)).rejects.toThrow(/Wire Camera Switch/)
    expect(polls).toHaveLength(0)
  })

  it("says it is not priced yet — the plugin's own words — and sends nothing", async () => {
    await expect(executeSpeakerView(node(), { edl: JSON.stringify(EDL) }, ctx, undefined)).rejects.toThrow("Speaker View is not priced yet")
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining(translate("en", "nodeRun.speakerViewNotPriced")))
    expect(polls).toHaveLength(0)
    expect(speakerViewApi).not.toHaveBeenCalled()
  })

  it("with a price, sends the normalized settings, the stamps and the quality — one body for both engines", async () => {
    flag.priced = true
    await executeSpeakerView(node({ layout: "side-by-side", targetAspect: "9:16", switchType: "pan", switchDurationMs: 600, quality: "proxy" }), { edl: JSON.stringify(EDL) }, ctx, undefined)
    expect(polls).toHaveLength(1)
    await polls[0]!.call()
    const body = speakerViewApi.mock.calls[0]![0] as Record<string, unknown>
    expect(body).toMatchObject({ quality: "proxy", userId: "user-1", settings: { layout: "stacked", targetAspect: "9:16", switch: { type: "pan", durationMs: 600 } } })
    expect(body.edl).toEqual(EDL)
    expect(body.renderBasis).toMatch(/^[0-9a-f]{16}$/)
  })

  it("keeps the take's identity on the result only", async () => {
    flag.priced = true
    await executeSpeakerView(node(), { edl: JSON.stringify(EDL) }, ctx, undefined)
    const fields = (polls[0]!.resultFields as (od: Record<string, unknown>) => Record<string, unknown>)({ quality: "proxy", clipKey: "0-10000", renderBasis: "0123456789abcdef", thumbnailUrl: "t.jpg" })
    expect(fields).toMatchObject({ quality: "proxy", clipKey: "0-10000", renderBasis: "0123456789abcdef", thumbnailUrl: "t.jpg" })
  })
})

describe("runSpeakerView — what a finished render lands on the node and its take", () => {
  it("the EDL as drawn on generatedJson and the remapped transcript on generatedTranscript (decided 2026-10-08)", async () => {
    await runSpeakerView("sv", {} as never, ctx)
    const extra = polls[0]!.extra as (od: Record<string, unknown>) => Record<string, unknown>
    const transcript = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 300 }] }
    expect(extra({ videoUrl: "https://r2/sv.mp4", json: EDL, transcript })).toStrictEqual({ generatedJson: EDL, generatedTranscript: transcript })
    // none (no transcript wired, or an older plugin): cleared, never left from an earlier take
    expect(extra({ videoUrl: "https://r2/sv.mp4", json: EDL })).toStrictEqual({ generatedJson: EDL, generatedTranscript: undefined })
  })
})

// P3.9: face tracks through the funnel the server's run shares.
describe("executeSpeakerView with face tracks", () => {
  const JOB = "11111111-2222-4333-8444-555555555555"
  const TRACKS = {
    version: 1, sampleFps: 2, detector: { id: "yunet" }, url: `https://media.example/u/speaker-tracks/${JOB}.json`, sha256: "f".repeat(64), bytes: 500,
    sources: [{ sourceId: "a", clock: "source", frame: { w: 1920, h: 1080 }, sampledSpans: [{ startMs: 0, endMs: 10_000 }], tracks: [{ id: "a/t1", speaker: "S0", attribution: { method: "mouth-motion", confidence: 0.9, rawSpeaker: "S0" }, boxCount: 10 }] }],
  }
  const RENAMED = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "Host" }], speakerNames: { S0: "Host" } }

  it("sends the descriptor with the app's labels and glide, after checking the Speaker Frames job behind it", async () => {
    flag.priced = true
    getJobStatus.mockResolvedValue({ input_data: { edl: EDL }, output_data: { json: TRACKS } })
    await executeSpeakerView(node(), { edl: JSON.stringify(EDL), transcript: JSON.stringify(RENAMED), tracks: JSON.stringify(TRACKS), trackAssignments: [] }, ctx, undefined)
    expect(getJobStatus).toHaveBeenCalledWith(JOB)
    await polls[0]!.call()
    const body = speakerViewApi.mock.calls[0]![0] as { settings: { tracks: typeof TRACKS; motion: string } }
    expect(body.settings.motion).toBe("glide")
    expect(body.settings.tracks.sources[0]!.tracks[0]).toMatchObject({ id: "a/t1", speaker: "Host" })
  })

  it("refuses tracks no Speaker Frames run of this account made, before anything is sent", async () => {
    flag.priced = true
    getJobStatus.mockRejectedValue(Object.assign(new Error("gone"), { status: 404 }))
    await expect(executeSpeakerView(node(), { edl: JSON.stringify(EDL), transcript: RENAMED, tracks: JSON.stringify(TRACKS) }, ctx, undefined)).rejects.toThrow(/not from a Speaker Frames run on this account/)
    expect(speakerViewApi).not.toHaveBeenCalled()
  })

  it("refuses a camera whose file changed since Speaker Frames ran", async () => {
    flag.priced = true
    getJobStatus.mockResolvedValue({ input_data: { edl: { ...EDL, sources: [{ ...EDL.sources[0]!, url: "https://x/old.mp4" }, EDL.sources[1]] } }, output_data: { json: TRACKS } })
    await expect(executeSpeakerView(node(), { edl: JSON.stringify(EDL), transcript: RENAMED, tracks: TRACKS }, ctx, undefined)).rejects.toThrow(/Face tracks for "a" were made from a different file/)
    expect(polls).toHaveLength(0)
  })

  it("refuses a tracks wire whose Speaker Frames has no output — never a silent v1 render (§5)", async () => {
    flag.priced = true
    // The resolver records the wire with nothing on it as "".
    await expect(executeSpeakerView(node(), { edl: JSON.stringify(EDL), transcript: RENAMED, tracks: "" }, ctx, undefined)).rejects.toThrow(/Speaker Frames has no output yet/)
    expect(polls).toHaveLength(0)
    expect(getJobStatus).not.toHaveBeenCalled()
  })

  it("sends what the normalizer keeps: an unknown motion is dropped, so a tracked run glides", async () => {
    flag.priced = true
    getJobStatus.mockResolvedValue({ input_data: { edl: EDL }, output_data: { json: TRACKS } })
    await executeSpeakerView(node({ motion: "bounce" } as never), { edl: JSON.stringify(EDL), transcript: JSON.stringify(RENAMED), tracks: JSON.stringify(TRACKS) }, ctx, undefined)
    await polls[0]!.call()
    expect((speakerViewApi.mock.calls[0]![0] as { settings: { motion: string } }).settings.motion).toBe("glide")
  })

  it("reads tracks only from the wire: an inline `tracks` on the node is ignored (as a workflow run ignores it)", async () => {
    flag.priced = true
    await executeSpeakerView(node({ tracks: TRACKS } as never), { edl: JSON.stringify(EDL) }, ctx, undefined)
    await polls[0]!.call()
    expect("tracks" in (speakerViewApi.mock.calls[0]![0] as { settings: Record<string, unknown> }).settings).toBe(false)
    expect(getJobStatus).not.toHaveBeenCalled()
  })

  it("sends no motion and reads no job without tracks", async () => {
    flag.priced = true
    await executeSpeakerView(node({ motion: "static" }), { edl: JSON.stringify(EDL) }, ctx, undefined)
    await polls[0]!.call()
    const body = speakerViewApi.mock.calls[0]![0] as { settings: Record<string, unknown> }
    expect("motion" in body.settings).toBe(false)
    expect(getJobStatus).not.toHaveBeenCalled()
  })
})

// Speaker View's Video input (decided 2026-10-11): the canvas run measures the
// clip through the server (D16), then builds the SAME one-clip edit the server's
// own run builds (`speakerViewVideoEdit`) before it sends the job.
describe("executeSpeakerView with a bare video", () => {
  const VIDEO = "https://cdn.example.test/uploads/videos/clip.mp4"
  const TWO = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "Alex" }, { text: "yo", startMs: 5_000, endMs: 5_400, speaker: "Sam" }] }
  const run = (data: Record<string, unknown> = {}, inputs: Record<string, unknown> = { videoUrl: VIDEO, transcript: JSON.stringify(TWO) }) =>
    executeSpeakerView(node(data), inputs, ctx, undefined)

  it("names both inputs when neither is wired", async () => {
    await expect(run({}, {})).rejects.toThrow("speaker-view requires an EDL")
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining(translate("en", "nodeRun.speakerViewConnectEdl")))
    expect(measureClipLength).not.toHaveBeenCalled()
  })

  it("refuses an edit and a video together, before measuring", async () => {
    await expect(run({}, { edl: JSON.stringify(EDL), videoUrl: VIDEO, transcript: JSON.stringify(TWO) })).rejects.toThrow(/not both/i)
    expect(measureClipLength).not.toHaveBeenCalled()
  })

  it("requires the transcript (D3), before measuring", async () => {
    await expect(run({}, { videoUrl: VIDEO })).rejects.toThrow(/Transcribe/)
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/Transcribe/))
    expect(measureClipLength).not.toHaveBeenCalled()
  })

  it("R15: says video mode is not open while Speaker View is unpriced, before it asks the server to download anything", async () => {
    await expect(run()).rejects.toThrow(SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE)
    expect(measureClipLength).not.toHaveBeenCalled()
    expect(speakerViewApi).not.toHaveBeenCalled()
  })

  it("R15: and while Speaker Frames is unpriced, though Speaker View is priced", async () => {
    flag.priced = true
    flag.frames = false
    await expect(run()).rejects.toThrow(SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE)
    expect(measureClipLength).not.toHaveBeenCalled()
    expect(speakerViewApi).not.toHaveBeenCalled()
  })

  it("measures once and sends the very edit the server's run builds", async () => {
    flag.priced = true
    await run({ quality: "proxy" })
    expect(measureClipLength).toHaveBeenCalledTimes(1)
    expect(measureClipLength).toHaveBeenCalledWith(expect.objectContaining({ videoUrl: VIDEO }))
    await polls[0]!.call()
    const body = speakerViewApi.mock.calls[0]![0] as { edl: unknown; settings: Record<string, unknown> }
    const expected = speakerViewVideoEdit({ url: VIDEO, clip: { durationMs: 14_600, width: 3840, height: 2160 }, transcript: TWO })
    if (!expected.ok) throw new Error(expected.message)
    expect(body.edl).toEqual(expected.edl)
  })

  it("F5: the node's Stop signal rides the clip check", async () => {
    flag.priced = true
    const ctrl = new AbortController()
    await executeSpeakerView(node(), { videoUrl: VIDEO, transcript: JSON.stringify(TWO) }, { ...ctxBase, signal: ctrl.signal } as never, undefined)
    expect(measureClipLength).toHaveBeenCalledWith(expect.objectContaining({ signal: ctrl.signal }))
  })

  it("F5: a node stopped while the check was running does not go on to render", async () => {
    flag.priced = true
    const ctrl = new AbortController()
    measureClipLength.mockImplementationOnce(async () => {
      ctrl.abort()
      return { durationMs: 14_600, width: 3840, height: 2160 }
    })
    await expect(
      executeSpeakerView(node(), { videoUrl: VIDEO, transcript: JSON.stringify(TWO) }, { ...ctxBase, signal: ctrl.signal } as never, undefined),
    ).rejects.toThrow(/stopped/i)
    expect(polls).toHaveLength(0)
    expect(speakerViewApi).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it("says once that it is checking the video while the server's background check is under way (R4)", async () => {
    flag.priced = true
    await run()
    const params = measureClipLength.mock.calls[0]![0] as { onWaiting?: () => void }
    expect(toastInfo).not.toHaveBeenCalled()
    params.onWaiting?.()
    expect(toastInfo).toHaveBeenCalledWith(translate("en", "nodeRun.speakerViewChecking"))
  })

  it("R2: a node that opts in refuses a clip with no faces before sending; one that does not renders it", async () => {
    flag.priced = true
    measureClipLength.mockResolvedValueOnce({ durationMs: 14_600, width: 3840, height: 2160, faces: "none" })
    await expect(run({ requireFaces: true })).rejects.toThrow(/no faces/i)
    expect(polls).toHaveLength(0)
    measureClipLength.mockResolvedValueOnce({ durationMs: 14_600, width: 3840, height: 2160, faces: "none" })
    await run({})
    expect(polls).toHaveLength(1)
  })

  it("draws at the node's aspect, else 9:16", async () => {
    flag.priced = true
    await run({ targetAspect: "1:1" })
    await polls[0]!.call()
    expect((speakerViewApi.mock.calls[0]![0] as { edl: { meta: { targetAspect: string } } }).edl.meta.targetAspect).toBe("1:1")
  })

  it("D18: refuses a source already as narrow as the target, naming it, before sending", async () => {
    flag.priced = true
    measureClipLength.mockResolvedValueOnce({ durationMs: 5_000, width: 1080, height: 1920 })
    await expect(run()).rejects.toThrow(/1080×1920/)
    expect(polls).toHaveLength(0)
  })

  it("D10: runs a low-resolution source and warns, naming the upscale", async () => {
    flag.priced = true
    measureClipLength.mockResolvedValueOnce({ durationMs: 14_600, width: 640, height: 360 })
    await run()
    expect(polls).toHaveLength(1)
    expect(toastWarning).toHaveBeenCalledWith(expect.stringMatching(/640×360.*enlarged 5\.3×/))
  })

  it("F4: the wait for the measurement is tied to Stop and to a restarted run", async () => {
    flag.priced = true
    const ctrl = new AbortController()
    const stale = () => false
    await executeSpeakerView(node(), { videoUrl: VIDEO, transcript: JSON.stringify(TWO) }, { ...ctxBase, signal: ctrl.signal, isWorkflowStale: stale } as never, undefined)
    const params = measureClipLength.mock.calls[0]![0] as { signal?: AbortSignal; isStale?: () => boolean }
    expect(params.signal).toBe(ctrl.signal)
    expect(params.isStale).toBe(stale)
  })

  it("F4: Stop during the measurement ends the node with no error toast: no job is created, no credits reserved", async () => {
    flag.priced = true
    const ctrl = new AbortController()
    measureClipLength.mockImplementationOnce(async () => { ctrl.abort(); throw new ClipMeasureStopped("aborted") })
    await expect(executeSpeakerView(node(), { videoUrl: VIDEO, transcript: JSON.stringify(TWO) }, { ...ctxBase, signal: ctrl.signal, isWorkflowStale: () => false } as never, undefined)).rejects.toThrow(/stopped/i)
    expect(polls).toHaveLength(0)
    expect(speakerViewApi).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it("F4: a restarted run during the measurement throws the workflow-stale error, creating nothing", async () => {
    flag.priced = true
    measureClipLength.mockRejectedValueOnce(new ClipMeasureStopped("stale"))
    await expect(run()).rejects.toBeInstanceOf(WorkflowStaleError)
    expect(polls).toHaveLength(0)
    expect(toastError).not.toHaveBeenCalled()
  })

  it("F4: a Stop or restart that lands just as the measurement finishes still creates no job", async () => {
    flag.priced = true
    const ctrl = new AbortController()
    measureClipLength.mockImplementationOnce(async () => { ctrl.abort(); return { durationMs: 14_600, width: 3840, height: 2160 } })
    await expect(executeSpeakerView(node(), { videoUrl: VIDEO, transcript: JSON.stringify(TWO) }, { ...ctxBase, signal: ctrl.signal, isWorkflowStale: () => false } as never, undefined)).rejects.toThrow(/stopped/i)
    expect(polls).toHaveLength(0)
    let stale = false
    measureClipLength.mockImplementationOnce(async () => { stale = true; return { durationMs: 14_600, width: 3840, height: 2160 } })
    await expect(executeSpeakerView(node(), { videoUrl: VIDEO, transcript: JSON.stringify(TWO) }, { ...ctxBase, isWorkflowStale: () => stale } as never, undefined)).rejects.toBeInstanceOf(WorkflowStaleError)
    expect(polls).toHaveLength(0)
  })

  it("reports a clip the server cannot measure in its own words, and sends nothing", async () => {
    flag.priced = true
    measureClipLength.mockRejectedValueOnce(new Error("Could not tell exactly how long this video runs."))
    await expect(run()).rejects.toThrow("Could not tell exactly how long this video runs.")
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("Could not tell exactly how long this video runs."))
    expect(polls).toHaveLength(0)
  })
})
