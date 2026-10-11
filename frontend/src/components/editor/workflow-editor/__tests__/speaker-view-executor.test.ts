/**
 * The canvas's own run of a Speaker View node (C3.2): the checks the server's
 * payload builder makes, before anything is sent. While Speaker View has no
 * price the answer is always "not priced yet" — in the plugin's own words — and
 * nothing is sent. With the price flag let through (as C4 will), the body is
 * the one both engines send.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { toastError, polls, flag } = vi.hoisted(() => ({ toastError: vi.fn(), polls: [] as Array<{ call: () => Promise<unknown>; extra?: unknown; resultFields?: unknown }>, flag: { priced: false } }))

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn(), info: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))
vi.mock("@nodaro/render-rules", async (orig) => {
  const actual = await orig<typeof import("@nodaro/render-rules")>()
  return { ...actual, get SPEAKER_VIEW_PRICED() { return flag.priced } }
})
const speakerViewApi = vi.fn(async (_p: unknown) => ({ jobId: "job-1" }))
const getJobStatus = vi.fn(async (_id: string): Promise<unknown> => null)
vi.mock("@/lib/api", () => ({ speakerView: (p: unknown) => speakerViewApi(p), getJobStatus: (id: string) => getJobStatus(id) }))
vi.mock("../poll-job", () => ({
  pollJobWithNodeUpdate: (_id: string, call: () => Promise<unknown>, _key: unknown, _label: string, _ctx: unknown, extra: unknown, _est: unknown, opts: { resultFields?: unknown }) => {
    polls.push({ call, extra, resultFields: opts?.resultFields })
    return Promise.resolve("done")
  },
}))
vi.mock("@/hooks/use-workflow-store", () => ({ useWorkflowStore: { getState: () => ({ nodes: [], edges: [] }) } }))

import { executeSpeakerView, runSpeakerView } from "../speaker-view-executor"
import { translate } from "@/lib/i18n"
import type { WorkflowNode } from "@/types/nodes"

const src = (id: string) => ({ id, url: `https://x/${id}.mp4`, kind: "video" })
const seg = (id: string, inS: number, video: string, speaker: string) => ({ id, inMs: inS * 1000, outMs: (inS + 5) * 1000, video, speaker })
const EDL = { version: 1, clock: "master", sources: [src("a"), src("b")], segments: [seg("s0", 0, "a", "Host"), seg("s1", 5, "b", "Guest")] }
const node = (data: Record<string, unknown> = {}) => ({ id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View", ...data } }) as unknown as WorkflowNode
const ctx = { userId: "user-1" } as never

beforeEach(() => {
  vi.clearAllMocks()
  polls.length = 0
  flag.priced = false
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
