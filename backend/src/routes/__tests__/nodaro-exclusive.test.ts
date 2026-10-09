/**
 * The self-hosted routes for the Nodaro-exclusive nodes (4b). What they must
 * guarantee:
 *   - every path refuses with a structured 503 nodaro_connection_required
 *     when the install has no nodaro.ai connection (the frontend renders the
 *     Connect CTA from it) — and creates nothing;
 *   - connected requests enqueue a local job whose payload the relay worker
 *     replays on the cloud;
 *   - gvp stop forwards to the CLOUD job when it exists, and stamps the local
 *     row when it doesn't yet;
 *   - gvp continue maps the LOCAL parent id to its cloud id (provider_task_id)
 *     and refuses when there is nothing to resume from;
 *   - the video-analysis probe is a synchronous passthrough.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  isNodaroConnected: vi.fn().mockResolvedValue(true),
  nodaroCloudFetch: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
  callCloudRoute: vi.fn().mockResolvedValue({ ok: true, durationSec: 42 }),
  rehostByteSize: vi.fn(async (_url: string): Promise<number | undefined> => undefined),
  requestJobStop: vi.fn().mockResolvedValue(undefined),
  insertJob: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }),
  queueAdd: vi.fn().mockResolvedValue({ id: "bull-1" }),
  maybeSingle: vi.fn(),
  relaySupport: vi.fn(async (): Promise<{ relay: boolean; source: string }> => ({ relay: true, source: "nodaro.ai" })),
}))

vi.mock("@/lib/nodaro-connect.js", () => ({
  isNodaroConnected: mocks.isNodaroConnected,
  nodaroCloudFetch: mocks.nodaroCloudFetch,
}))
vi.mock("@/providers/nodaro/client.js", () => ({ callCloudRoute: mocks.callCloudRoute, rehostByteSize: mocks.rehostByteSize }))
vi.mock("@/workers/shared.js", () => ({ requestJobStop: mocks.requestJobStop }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: mocks.insertJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mocks.queueAdd }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({ creditGuard: () => async () => {} }))
vi.mock("@/lib/supabase.js", () => {
  // .select().eq("id",...).eq("user_id",...).maybeSingle() — each eq returns
  // the same chain so scoping depth doesn't matter to the mock.
  const chain: Record<string, unknown> = {}
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = (...args: unknown[]) => mocks.maybeSingle(...args)
  const select = vi.fn(() => chain)
  return { supabase: { from: vi.fn(() => ({ select })) } }
})
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

vi.mock("@/lib/private-plugins/speaker-frames-relay-support.js", async (orig) => ({
  ...(await orig<typeof import("../../lib/private-plugins/speaker-frames-relay-support.js")>()),
  speakerFramesRelaySupport: mocks.relaySupport,
}))

import { nodaroExclusiveRoutes } from "../nodaro-exclusive.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.isNodaroConnected.mockResolvedValue(true)
  mocks.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
  mocks.nodaroCloudFetch.mockResolvedValue({ ok: true, status: 200 })
  mocks.callCloudRoute.mockResolvedValue({ ok: true, durationSec: 42 })
  mocks.rehostByteSize.mockResolvedValue(undefined)
  mocks.relaySupport.mockResolvedValue({ relay: true, source: "nodaro.ai" })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => {
    await nodaroExclusiveRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const USER = "00000000-0000-4000-8000-000000000001"
const VIDEO = "https://example.com/v.mp4"

describe("connection gate", () => {
  const posts: Array<[string, Record<string, unknown>]> = [
    ["/v1/voice-changer-pro", { audioUrl: "https://example.com/a.mp3" }],
    ["/v1/generate-video-pro", { prompt: "p" }],
    ["/v1/edit-video-pro", { videoUrl: VIDEO }],
    ["/v1/video-analysis", { videoUrl: VIDEO }],
    ["/v1/video-audit", { videoUrl: VIDEO }],
    ["/v1/video-analysis/probe", { videoUrl: VIDEO }],
    ["/v1/generate-video-pro/continue", { fromJobId: "j-0" }],
    ["/v1/speaker-view", { edl: { version: 1, clock: "master", sources: [], segments: [] } }],
    ["/v1/speaker-frames", { videoUrl: VIDEO }],
  ]
  for (const [url, payload] of posts) {
    it(`${url} answers 503 nodaro_connection_required when unconnected — and creates nothing`, async () => {
      mocks.isNodaroConnected.mockResolvedValue(false)
      const res = await app.inject({ method: "POST", url, payload: { ...payload, userId: USER } })
      expect(res.statusCode).toBe(503)
      expect(res.json().error.code).toBe("nodaro_connection_required")
      expect(mocks.insertJob).not.toHaveBeenCalled()
      expect(mocks.queueAdd).not.toHaveBeenCalled()
    })
  }
})

describe("enqueue", () => {
  it("a connected request creates the local job and enqueues its payload for the relay", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-video-pro",
      payload: { videoUrl: VIDEO, instructions: "stabilize", userId: USER },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(mocks.insertJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ user_id: USER, status: "pending" }),
    )
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "edit-video-pro",
      expect.objectContaining({ jobId: "job-1", videoUrl: VIDEO, instructions: "stabilize" }),
    )
  })

  it("gvp is a passthrough — unknown fields survive to the relay (the cloud's Zod is the schema authority)", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/generate-video-pro",
      payload: { prompt: "epic", segments: 4, weirdNewField: "x", userId: USER },
    })
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "generate-video-pro",
      expect.objectContaining({ segments: 4, weirdNewField: "x" }),
    )
  })

  it("vcp refuses a body with neither audioUrl nor videoUrl", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/voice-changer-pro",
      payload: { voice: "deep", userId: USER },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("the video-first types refuse a body without videoUrl", async () => {
    for (const url of ["/v1/edit-video-pro", "/v1/video-analysis", "/v1/video-audit"]) {
      const res = await app.inject({ method: "POST", url, payload: { userId: USER } })
      expect(res.statusCode).toBe(400)
    }
  })

  it("requires auth", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-audit", payload: { videoUrl: VIDEO } })
    expect(res.statusCode).toBe(401)
  })
})

// B4 (decided 2026-09-25): the relayed edit-plan takes offsets on
// sources[].offsetMs only — refused, with the cloud route's own codes, before
// anything is created or relayed.
describe("edit-plan offsets", () => {
  const transcript = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 500 }] }
  const mic = { id: "mic", url: "https://example.com/mic.m4a", kind: "audio", role: "master-audio" }
  const cam = { id: "cam", url: VIDEO, kind: "video" }
  const post = (body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/v1/edit-plan", payload: { mode: "tighten", planTier: "standard", transcript, userId: USER, ...body } })

  it("refuses a raw `offsets` field — the cloud schema would strip it and plan the cameras unsynced", async () => {
    const res = await post({ sources: [mic, cam], offsets: { reference: "mic", offsets: [] } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("offsets_not_applied")
    expect(mocks.insertJob).not.toHaveBeenCalled()
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("refuses an offset on the master", async () => {
    const res = await post({ sources: [{ ...mic, offsetMs: 40 }, cam] })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("master_offset")
    expect(res.json().error.message).toMatch(/"mic" is the master/)
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("refuses an offset on the source the transcript was made from", async () => {
    const res = await post({ sources: [mic, { ...cam, offsetMs: 2_000 }], transcript: { ...transcript, sourceId: "cam" } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.message).toMatch(/the transcript was made from "cam"/)
  })

  it("relays camera offsets as given", async () => {
    const res = await post({ sources: [mic, { ...cam, offsetMs: 2_000 }] })
    expect(res.statusCode).toBe(200)
    expect(mocks.queueAdd.mock.calls[0]![1].sources[1].offsetMs).toBe(2_000)
  })
})

// B5 (decided 2026-10-03): the relayed camera-switch refuses, before anything
// is created or relayed, a malformed edit and a transcript with no speakers.
describe("camera-switch", () => {
  const edl = { version: 1, clock: "master", sources: [{ id: "camA", url: VIDEO, kind: "video" }], segments: [{ id: "s", inMs: 0, outMs: 1_000, video: "camA" }] }
  const diarized = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "speaker_0" }] }
  const post = (body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/v1/camera-switch", payload: { userId: USER, ...body } })

  it("relays an edit + a diarized transcript; input_data keeps sizes, not the edit or the transcript", async () => {
    const res = await post({ edl, transcript: diarized })
    expect(res.statusCode).toBe(200)
    expect(mocks.queueAdd.mock.calls[0]![0]).toBe("camera-switch")
    const inputData = (mocks.insertJob.mock.calls[0]![1] as { input_data: Record<string, unknown> }).input_data
    expect(inputData).not.toHaveProperty("edl")
    expect(inputData).not.toHaveProperty("transcript")
  })

  it("refuses a transcript with no speaker labels (422 no_speakers) and creates nothing", async () => {
    const res = await post({ edl, transcript: { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400 }] } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("no_speakers")
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("refuses an edit with no segments (400 invalid_edl)", async () => {
    const res = await post({ edl: { ...edl, segments: [] }, transcript: diarized })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_edl")
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("refuses a clip set and an output-clock edit (400 invalid_edl), the plugin route's rules", async () => {
    for (const bad of [{ clips: [edl] }, { ...edl, clock: "output" }]) {
      const res = await post({ edl: bad, transcript: diarized })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("invalid_edl")
    }
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  // A JSON-string edit (the docs allow it) is queued PARSED: the relay re-hosts
  // the cameras' URLs from the object — a string hid them (review of #1749).
  it("queues a JSON-string edit and transcript as objects", async () => {
    const res = await post({ edl: JSON.stringify(edl), transcript: JSON.stringify(diarized) })
    expect(res.statusCode).toBe(200)
    const queued = mocks.queueAdd.mock.calls[0]![1] as { edl: unknown; transcript: unknown }
    expect(queued.edl).toEqual(edl)
    expect(queued.transcript).toEqual(diarized)
    const inputData = (mocks.insertJob.mock.calls[0]![1] as { input_data: Record<string, unknown> }).input_data
    expect(inputData.edlSegmentCount).toBe(1)
  })
})

describe("probe passthrough", () => {
  it("proxies synchronously through the connection", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/video-analysis/probe",
      payload: { videoUrl: VIDEO, userId: USER },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, durationSec: 42 })
    expect(mocks.callCloudRoute).toHaveBeenCalledWith(
      "/v1/video-analysis/probe",
      expect.objectContaining({ videoUrl: VIDEO }),
    )
  })
})

describe("gvp stop", () => {
  const stopUrl = "/v1/generate-video-pro/job-1/stop"
  const gvpRow = (over: Record<string, unknown> = {}) => ({
    id: "job-1",
    user_id: USER,
    job_type: "generate-video-pro",
    status: "processing",
    provider_task_id: null,
    ...over,
  })

  it("404s a job the caller does not own — the query is user-scoped, so not-owned resolves as absent", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null })
    const res = await app.inject({ method: "POST", url: stopUrl, payload: { userId: USER } })
    expect(res.statusCode).toBe(404)
  })

  it("409s a job already terminal", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: gvpRow({ status: "completed" }) })
    const res = await app.inject({ method: "POST", url: stopUrl, payload: { userId: USER } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("already_terminal")
  })

  it("before the cloud job exists: stamps the local row (the relay forwards it after create)", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: gvpRow() })
    const res = await app.inject({ method: "POST", url: stopUrl, payload: { userId: USER } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1", stopping: true })
    expect(mocks.requestJobStop).toHaveBeenCalledWith("job-1")
    expect(mocks.nodaroCloudFetch).not.toHaveBeenCalled()
  })

  it("after the cloud job exists: forwards the stop to the CLOUD job id", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: gvpRow({ provider_task_id: "cloud-7" }) })
    const res = await app.inject({ method: "POST", url: stopUrl, payload: { userId: USER } })
    expect(res.statusCode).toBe(200)
    expect(mocks.nodaroCloudFetch).toHaveBeenCalledWith("/v1/generate-video-pro/cloud-7/stop", {
      method: "POST",
    })
    expect(mocks.requestJobStop).not.toHaveBeenCalled()
  })

  it("a cloud 409 (already stopping) still reports stopping: true; a cloud 5xx is a 502", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: gvpRow({ provider_task_id: "cloud-7" }) })
    mocks.nodaroCloudFetch.mockResolvedValue({ ok: false, status: 409 })
    let res = await app.inject({ method: "POST", url: stopUrl, payload: { userId: USER } })
    expect(res.statusCode).toBe(200)

    mocks.nodaroCloudFetch.mockResolvedValue({ ok: false, status: 500 })
    res = await app.inject({ method: "POST", url: stopUrl, payload: { userId: USER } })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("cloud_stop_failed")
  })
})

describe("gvp continue", () => {
  it("maps the LOCAL parent to its CLOUD id and enqueues a resume payload (fromJobId never leaks to the cloud body)", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "j-parent", user_id: USER, job_type: "generate-video-pro", provider_task_id: "cloud-parent-3" },
    })
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video-pro/continue",
      payload: { fromJobId: "j-parent", fromSegment: 2, prompt: "keep going", userId: USER },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    const payload = mocks.queueAdd.mock.calls[0]?.[1] as Record<string, unknown>
    expect(payload.__nodaroContinue).toEqual({ cloudFromJobId: "cloud-parent-3", fromSegment: 2 })
    expect(payload.fromJobId).toBeUndefined()
    expect(payload.prompt).toBe("keep going")
  })

  it("409s not_resumable when the parent never reached the cloud", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "j-parent", user_id: USER, job_type: "generate-video-pro", provider_task_id: null },
    })
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video-pro/continue",
      payload: { fromJobId: "j-parent", userId: USER },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("not_resumable")
  })

  it("404s a parent the caller does not own (query-scoped → absent) or of another type", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null })
    let res = await app.inject({
      method: "POST",
      url: "/v1/generate-video-pro/continue",
      payload: { fromJobId: "j-parent", userId: USER },
    })
    expect(res.statusCode).toBe(404)

    mocks.maybeSingle.mockResolvedValue({
      data: { id: "j-parent", user_id: USER, job_type: "text-to-video", provider_task_id: "c" },
    })
    res = await app.inject({
      method: "POST",
      url: "/v1/generate-video-pro/continue",
      payload: { fromJobId: "j-parent", userId: USER },
    })
    expect(res.statusCode).toBe(404)
  })
})

// Speaker View (C3.1, decided 2026-10-06): relayed like the other exclusive
// renders. Before anything is created, a private source over the re-host cap
// is refused, naming it and its size (SV12); a Preview is private from its
// insert (Track A F1); the job keeps the edit and slims the transcript.
describe("speaker-view", () => {
  const OWN = "http://localhost:9000/nodaro-assets/cam-a.mp4"
  const edl = {
    version: 1,
    clock: "master",
    sources: [
      { id: "camA", url: OWN, kind: "video" },
      { id: "mic", url: "https://example.com/mic.wav", kind: "audio", role: "master-audio" },
    ],
    segments: [{ id: "s0", inMs: 0, outMs: 30_000, video: "camA", speaker: "Host" }],
  }
  const transcript = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "Host" }, { text: "there", startMs: 400, endMs: 800, speaker: "Host" }] }
  const post = (body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/v1/speaker-view", payload: { userId: USER, ...body } })

  it("enqueues the edit PARSED (the relay re-hosts its cameras from the object), every setting passing through", async () => {
    const res = await post({ edl: JSON.stringify(edl), transcript, quality: "final", targetAspect: "9:16", layout: "auto", clipKey: "0-30000" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "speaker-view",
      expect.objectContaining({ jobId: "job-1", edl, transcript, quality: "final", targetAspect: "9:16", layout: "auto", clipKey: "0-30000" }),
    )
  })

  it("keeps the edit on the job row and slims the transcript to its size", async () => {
    await post({ edl, transcript })
    const inputData = mocks.insertJob.mock.calls[0]![1].input_data as Record<string, unknown>
    expect(inputData.edl).toEqual(edl)
    expect(inputData.transcript).toBeUndefined()
    expect(inputData.transcriptWordCount).toBe(2)
  })

  it("inserts a Preview (quality proxy) private, and a final as the request says", async () => {
    await post({ edl, quality: "proxy" })
    expect(mocks.insertJob.mock.calls[0]![1].force_private).toBe(true)
    mocks.insertJob.mockClear()
    await post({ edl, quality: "final" })
    expect(mocks.insertJob.mock.calls[0]![1].force_private).toBeUndefined()
  })

  it("refuses a private source over the re-host cap BEFORE anything is created, naming it and its size", async () => {
    mocks.rehostByteSize.mockImplementation(async (url: string) => (url === OWN ? 3_100_000_000 : undefined))
    const res = await post({ edl, transcript })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toEqual({
      code: "source_too_large",
      message: 'Speaker View sends each source of the edit to nodaro.ai; "camA" is 3.1 GB, over the 500 MB limit. Use a public URL or a smaller file.',
    })
    expect(mocks.insertJob).not.toHaveBeenCalled()
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("lets a source through whose size cannot be read (the relay's in-rehost cap is the backstop)", async () => {
    const res = await post({ edl })
    expect(res.statusCode).toBe(200)
    expect(mocks.rehostByteSize).toHaveBeenCalledWith(OWN)
  })

  it("refuses a request with no edit", async () => {
    const res = await post({ transcript })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })
})

// Speaker Frames (P3.6, decided 2026-10-09): relayed only once nodaro.ai takes a
// relayed job (its proxies and the relayed marker); until then a connected
// install answers a clear "not available on a connected install yet" and
// creates nothing. The scope the plugin would refuse is refused here first.
describe("speaker-frames", () => {
  const edl = {
    version: 1,
    clock: "master",
    sources: [
      { id: "mic", url: "https://example.com/mic.wav", kind: "audio", role: "master-audio" },
      { id: "camA", url: "https://example.com/cam-a.mp4", kind: "video" },
    ],
    segments: [{ id: "s0", inMs: 0, outMs: 30_000, video: "camA", speaker: "Host" }],
  }
  const transcript = {
    version: 1,
    words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "Host" }, { text: "there", startMs: 400, endMs: 800, speaker: "Guest" }],
    speakerNames: { "Speaker A": "Host", "Speaker B": "Guest" },
  }
  const post = (body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/v1/speaker-frames", payload: { userId: USER, ...body } })

  it("answers 503 speaker_frames_relay_unavailable while nodaro.ai does not take a relayed job — and creates nothing", async () => {
    mocks.relaySupport.mockResolvedValue({ relay: false, source: "nodaro.ai" })
    const res = await post({ edl, transcript })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toEqual({ code: "speaker_frames_relay_unavailable", message: expect.stringContaining("not available on a connected install yet") })
    expect(mocks.insertJob).not.toHaveBeenCalled()
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("says so when nodaro.ai could not be asked", async () => {
    mocks.relaySupport.mockResolvedValue({ relay: false, source: "nodaro.ai-unreachable" })
    const res = await post({ edl })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.message).toContain("Couldn't reach nodaro.ai")
  })

  // A revoked or expired relay credential is not an outage: the remedy is the
  // connection's, so the answer is the connection code with the reason.
  it("a rejected connection (401/403 from nodaro.ai) answers 503 nodaro_connection_required, saying it was rejected", async () => {
    mocks.relaySupport.mockResolvedValue({ relay: false, source: "nodaro.ai-rejected" })
    const res = await post({ edl })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toEqual({ code: "nodaro_connection_required", message: expect.stringContaining("connection was rejected") })
    expect(res.json().error.message).not.toContain("Couldn't reach")
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  // Round 2 (decided 2026-10-09): the sources Speaker Frames does not sample
  // (the master audio, an unticked camera) go as a placeholder nodaro.ai never
  // reads, and its sampled cameras as detection proxies the worker builds — so
  // no original is sent and none is sized here, however large.
  it("never sizes or refuses a source of the edit: no original is relayed", async () => {
    const twoCams = { ...edl, sources: [...edl.sources, { id: "camB", url: "https://example.com/cam-b.mp4", kind: "video" }] }
    mocks.rehostByteSize.mockResolvedValue(9_000_000_000)
    const res = await post({ edl: twoCams, excludeSourceIds: ["camB"] })
    expect(res.statusCode).toBe(200)
    expect(mocks.rehostByteSize).not.toHaveBeenCalled()
  })

  it("enqueues the plugin's job payload: the edit PARSED, the transcript with its speakerNames as given", async () => {
    const res = await post({ edl: JSON.stringify(edl), transcript, excludeSourceIds: [] })
    expect(res.statusCode).toBe(200)
    expect(mocks.queueAdd).toHaveBeenCalledWith("speaker-frames", expect.objectContaining({ jobId: "job-1", edl, transcript, excludeSourceIds: [] }))
    const payload = mocks.queueAdd.mock.calls[0]![1] as { transcript: { speakerNames?: unknown } }
    expect(payload.transcript.speakerNames).toEqual(transcript.speakerNames)
  })

  it("enqueues a clip pack as ONE job over its edits (P3-24 (a))", async () => {
    const res = await post({ edl: [JSON.stringify(edl), edl] })
    expect(res.statusCode).toBe(200)
    expect(mocks.queueAdd).toHaveBeenCalledTimes(1)
    expect(mocks.queueAdd).toHaveBeenCalledWith("speaker-frames", expect.objectContaining({ edl: [edl, edl] }))
  })

  it("keeps the edit on the job row and slims the transcript to its word and speaker counts", async () => {
    await post({ edl, transcript })
    const inputData = mocks.insertJob.mock.calls[0]![1].input_data as Record<string, unknown>
    expect(inputData.edl).toEqual(edl)
    expect(inputData.transcript).toBeUndefined()
    expect(inputData.transcriptWordCount).toBe(2)
    expect(inputData.transcriptSpeakerCount).toBe(2)
  })

  it("refuses what the plugin would, before anything is created", async () => {
    for (const [body, code] of [
      [{}, "invalid_input"],
      [{ edl, videoUrl: VIDEO }, "invalid_input"],
      [{ edl: { ...edl, clock: "output" } }, "invalid_edl"],
      [{ edl, excludeSourceIds: ["camA"] }, "invalid_input"],
    ] as const) {
      const res = await post(body as Record<string, unknown>)
      expect(res.statusCode, JSON.stringify(body)).toBe(400)
      expect(res.json().error.code).toBe(code)
    }
    expect(mocks.insertJob).not.toHaveBeenCalled()
    expect(mocks.relaySupport).not.toHaveBeenCalled()
  })
})
