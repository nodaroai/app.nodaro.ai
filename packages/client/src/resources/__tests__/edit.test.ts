import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NodaroError, NotFoundError, ForbiddenError, ContinuationRefusedError, EditResource, unwrapEditPlanOutput } from "../../index.js"
import type { Edl, Transcript, SilenceRanges } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

function client(fetchMock: typeof fetch) {
  return createClient({
    baseUrl: "https://api.example.com",
    auth: new StaticTokenAuth("t"),
    fetch: fetchMock,
  })
}

describe("edit resource — constructor wiring", () => {
  it("createClient().edit is a wired EditResource (constructor-assignment guard)", () => {
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t") })
    expect(c.edit).toBeInstanceOf(EditResource)
  })
})

describe("edit.silenceDetect", () => {
  it("POSTs to /v1/silence-detect with the tuning knobs", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-sd" }))
    const c = client(fetchMock)
    const result = await c.edit.silenceDetect({
      audioUrl: "https://r2/ep.mp3",
      thresholdDb: -40,
      minSilenceMs: 500,
      padMs: 80,
      workflowId: "wf-1",
    })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/silence-detect")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    const sent = JSON.parse(init.body) as Record<string, unknown>
    expect(sent).toEqual({
      audioUrl: "https://r2/ep.mp3",
      thresholdDb: -40,
      minSilenceMs: 500,
      padMs: 80,
      workflowId: "wf-1",
    })
    expect(result.jobId).toBe("job-sd")
  })

  it("omits absent optional fields (server defaults apply)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j" }))
    await client(fetchMock).edit.silenceDetect({ audioUrl: "https://r2/ep.mp3" })
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(sent).toEqual({ audioUrl: "https://r2/ep.mp3" })
  })
})

describe("edit.audioSync", () => {
  it("POSTs to /v1/audio-sync with the sources and the reference", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-as" }))
    const sources = [
      { id: "mic", url: "https://r2/mic.m4a" },
      { id: "camA", url: "https://r2/camA.mp4" },
    ]
    const result = await client(fetchMock).edit.audioSync({ sources, reference: "mic", workflowId: "wf-1" })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/audio-sync")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ sources, reference: "mic", workflowId: "wf-1" })
    expect(result.jobId).toBe("job-as")
  })

  it("omits the reference when none is given (the server measures against the first source)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j" }))
    await client(fetchMock).edit.audioSync({
      sources: [{ id: "a", url: "https://r2/a.wav" }, { id: "b", url: "https://r2/b.wav" }],
    })
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(sent).toEqual({ sources: [{ id: "a", url: "https://r2/a.wav" }, { id: "b", url: "https://r2/b.wav" }] })
  })

  it("surfaces a 400 as a typed NodaroError", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(400, { error: { code: "validation_error", message: 'reference: reference "x" is not one of the sources\' ids' } }),
    )
    await expect(
      client(fetchMock).edit.audioSync({
        sources: [{ id: "a", url: "https://r2/a.wav" }, { id: "b", url: "https://r2/b.wav" }],
        reference: "x",
      }),
    ).rejects.toBeInstanceOf(NodaroError)
  })
})

describe("edit.applyEdl", () => {
  const edl: Edl = {
    version: 1,
    clock: "master",
    sources: [{ id: "master", url: "https://r2/master.mp4", kind: "video", role: "master-audio" }],
    segments: [
      { id: "s0", inMs: 0, outMs: 5000, video: "master" },
      { id: "s1", inMs: 8000, outMs: 12000, video: "master" },
    ],
    dropped: [{ inMs: 5000, outMs: 8000, reason: "silence" }],
  }

  it("POSTs to /v1/apply-edl with edl + render options", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-edl" }))
    const c = client(fetchMock)
    const result = await c.edit.applyEdl({
      edl,
      sources: ["https://r2/override.mp4"],
      output: "video",
      quality: "final",
      crossfadeMs: 250,
    })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/apply-edl")
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(sent.edl).toEqual(edl)
    expect(sent.sources).toEqual(["https://r2/override.mp4"])
    expect(sent.output).toBe("video")
    expect(sent.quality).toBe("final")
    expect(sent.crossfadeMs).toBe(250)
    expect(result.jobId).toBe("job-edl")
  })

  it("sends the plan clip's key when given (stamped on the result as clipKey)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j" }))
    await client(fetchMock).edit.applyEdl({ edl, quality: "proxy", clipKey: "0-12000" })
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(sent.clipKey).toBe("0-12000")
  })

  it("sends the plan value's basis when given (stamped on the result as planBasis)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j" }))
    await client(fetchMock).edit.applyEdl({ edl, planBasis: "0123456789abcdef" })
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(sent.planBasis).toBe("0123456789abcdef")
  })

  it("sends only edl when no options are given", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j" }))
    await client(fetchMock).edit.applyEdl({ edl })
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(Object.keys(sent)).toEqual(["edl"])
  })

  it("maps a 400 invalid_edl to a typed NodaroError", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(400, { error: { code: "invalid_edl", message: "EDL failed validation" } }),
    )
    await expect(client(fetchMock).edit.applyEdl({ edl })).rejects.toBeInstanceOf(NodaroError)
  })
})

describe("edit.editPlan", () => {
  const transcript: Transcript = {
    version: 1,
    words: [{ text: "hello", startMs: 0, endMs: 400 }],
  }

  it("POSTs to /v1/edit-plan with mode / planTier / transcript / sources + clip levers", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-plan" }))
    const c = client(fetchMock)
    const result = await c.edit.editPlan({
      mode: "clips",
      planTier: "premium",
      transcript,
      sources: [{ id: "src-1", url: "https://r2/master.mp4", kind: "video", role: "master-audio" }],
      instructions: "keep the funniest moments",
      count: 3,
      targetDurationSec: 45,
      targetAspect: "9:16",
      platform: "shorts",
    })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/edit-plan")
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(sent.mode).toBe("clips")
    expect(sent.planTier).toBe("premium")
    expect(sent.transcript).toEqual(transcript)
    expect(sent.sources).toEqual([
      { id: "src-1", url: "https://r2/master.mp4", kind: "video", role: "master-audio" },
    ])
    expect(sent.count).toBe(3)
    expect(sent.targetDurationSec).toBe(45)
    expect(sent.targetAspect).toBe("9:16")
    expect(sent.platform).toBe("shorts")
    expect(result.jobId).toBe("job-plan")
  })

  it("sends required fields only when optionals are omitted", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j" }))
    await client(fetchMock).edit.editPlan({
      mode: "tighten",
      planTier: "standard",
      transcript,
      sources: [{ id: "src-1", url: "https://r2/a.mp3", kind: "audio" }],
    })
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(Object.keys(sent).sort()).toEqual(["mode", "planTier", "sources", "transcript"].sort())
  })

  it("threads a SilenceRanges object as `silence`", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j" }))
    const silence: SilenceRanges = {
      version: 1,
      ranges: [{ startMs: 5000, endMs: 8000 }],
      durationMs: 12000,
    }
    await client(fetchMock).edit.editPlan({
      mode: "tighten",
      planTier: "standard",
      transcript,
      sources: [{ id: "src-1", url: "https://r2/a.mp3", kind: "audio" }],
      silence,
    })
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(sent.silence).toEqual(silence)
  })

  // B4 (decided 2026-09-25): an audio-sync result is applied client-side —
  // the server never sees `offsets`, only the sources' offsetMs.
  const mic = { id: "mic", url: "https://r2/mic.m4a", kind: "audio" as const, role: "master-audio" as const }
  const cam = { id: "cam", url: "https://r2/cam.mp4", kind: "video" as const }
  const sync = (confidence: number) => ({
    version: 1 as const,
    reference: "mic",
    offsets: [
      { sourceId: "mic", offsetMs: 0, confidence: 1, driftMsPerHour: 0 },
      { sourceId: "cam", offsetMs: 2_000, confidence, driftMsPerHour: null },
    ],
    notes: [],
  })

  it("writes an audio-sync result's offsets onto the sources, and never sends `offsets` itself", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j" }))
    await client(fetchMock).edit.editPlan({
      mode: "tighten", planTier: "standard", transcript, sources: [mic, cam], offsets: sync(0.9), transcriptSourceId: "mic",
    })
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(sent.sources).toEqual([mic, { ...cam, offsetMs: 2_000 }])
    expect(sent).not.toHaveProperty("offsets")
    expect(sent).not.toHaveProperty("transcriptSourceId")
    expect((sent.transcript as { sourceId?: string }).sourceId).toBe("mic")
  })

  it("rejects a weak match with a NodaroError before any request (nothing is charged)", async () => {
    const fetchMock = vi.fn()
    const err = await client(fetchMock).edit.editPlan({
      mode: "tighten", planTier: "standard", transcript, sources: [mic, cam], offsets: sync(0.3),
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    expect((err as NodaroError).code).toBe("edit_plan_sources")
    expect((err as NodaroError).message).toMatch(/audio-sync's match for "cam" is too weak to trust \(confidence 0.3; 0.5 needed\)/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("unwrapEditPlanOutput re-export (result normalizer)", () => {
  it("unwraps clips to a bare Edl[] and strips viaNodaroCloud", () => {
    const clip: Edl = {
      version: 1,
      clock: "master",
      sources: [{ id: "m", url: "https://r2/m.mp4", kind: "video", role: "master-audio" }],
      segments: [{ id: "s0", inMs: 0, outMs: 5000, video: "m" }],
    }
    const outputData = { version: 1, clips: [clip], viaNodaroCloud: true }
    const out = unwrapEditPlanOutput(outputData)
    expect(Array.isArray(out)).toBe(true)
    expect(out).toEqual([clip])
  })
})

describe("edit.remapTranscript (pure local helper — no request)", () => {
  it("drops words in cut spans and offsets survivors, making NO request", () => {
    const fetchMock = vi.fn()
    const c = client(fetchMock)
    const edl: Edl = {
      version: 1,
      clock: "master",
      sources: [{ id: "master", url: "https://x/master.mp4", kind: "video", role: "master-audio" }],
      segments: [
        { id: "s0", inMs: 0, outMs: 5000, video: "master" },
        { id: "s1", inMs: 8000, outMs: 12000, video: "master" }, // 5000-8000 dropped
      ],
      dropped: [{ inMs: 5000, outMs: 8000, reason: "silence" }],
    }
    const transcript: Transcript = {
      version: 1,
      words: [
        { text: "keep", startMs: 100, endMs: 400 },
        { text: "gone", startMs: 6000, endMs: 6500 }, // inside the dropped span
        { text: "back", startMs: 8100, endMs: 8500 },
      ],
    }
    const out = c.edit.remapTranscript(edl, transcript)
    expect(out.words.map((w) => w.text)).toEqual(["keep", "back"])
    expect(out.words[0]).toMatchObject({ startMs: 100, endMs: 400 })
    expect(out.words[1]).toMatchObject({ startMs: 5100, endMs: 5500 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/** `GET /v1/jobs/:id` answering a Tighten Episode run, as the run route writes it. */
const TIGHTEN_RUN = () => mockOk({ data: { id: "job-1", job_type: "tighten-episode", input_data: { type: "tighten-episode", mode: "run" } } })

describe("edit.tightenEpisode / estimateTightenEpisode / continueUseCase", () => {
  it("tightenEpisode posts the recording and only the settings given", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1", executionId: "exec-1" }))
    const out = await client(fetchMock).edit.tightenEpisode({ mediaUrl: "https://r2/ep.mp4", captions: false })
    expect(out.jobId).toBe("job-1")
    expect(out.executionId).toBe("exec-1")
    const [url, init] = fetchMock.mock.calls[0]! as [string, { method: string; body: string; headers: Record<string, string> }]
    expect(url).toBe("https://api.example.com/v1/tighten-episode")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ mediaUrls: ["https://r2/ep.mp4"], captions: false })
    expect(init.headers["Idempotency-Key"]).toBeUndefined()
  })

  it("tightenEpisode sends framing, music and the rest as given, and an Idempotency-Key only when asked", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1", deduped: true }))
    const out = await client(fetchMock).edit.tightenEpisode(
      {
        mediaUrl: "https://r2/ep.mp4",
        musicUrl: "https://r2/bed.mp3",
        output: "video",
        framing: { aspect: "9:16", layout: "stacked" },
        reviewBeforeRender: true,
        planTier: "premium",
        musicDuckAmount: 60,
      },
      { idempotencyKey: "retry-1" },
    )
    expect(out.deduped).toBe(true)
    const init = fetchMock.mock.calls[0]![1] as { body: string; headers: Record<string, string> }
    expect(init.headers["Idempotency-Key"]).toBe("retry-1")
    expect(JSON.parse(init.body)).toEqual({
      mediaUrls: ["https://r2/ep.mp4"],
      musicUrl: "https://r2/bed.mp3",
      output: "video",
      framing: { aspect: "9:16", layout: "stacked" },
      reviewBeforeRender: true,
      planTier: "premium",
      musicDuckAmount: 60,
    })
  })

  it("estimateTightenEpisode and continueUseCase hit their routes", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(mockOk({ data: { totalCredits: 932, stepsCredits: 922, feeCredits: 10, durationSec: 3600 } }))
      .mockReturnValueOnce(TIGHTEN_RUN())
      .mockReturnValueOnce(mockOk({ jobId: "job-2" }))
    const c = client(fetchMock)
    expect((await c.edit.estimateTightenEpisode({ mediaUrl: "https://r2/ep.mp4" })).data.totalCredits).toBe(932)
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.com/v1/tighten-episode/estimate")
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({ mediaUrls: ["https://r2/ep.mp4"] })
    await c.edit.continueUseCase({ jobId: "job-1", mode: "from-failed" })
    expect(fetchMock.mock.calls[2]![0]).toBe("https://api.example.com/v1/tighten-episode/continue")
    expect(JSON.parse((fetchMock.mock.calls[2]![1] as { body: string }).body)).toEqual({ jobId: "job-1", mode: "from-failed" })
  })

  it("continueUseCase sends the reviewer's edit with a Render final", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(TIGHTEN_RUN()).mockReturnValueOnce(mockOk({ jobId: "job-3", executionId: "exec-3" }))
    const editedEdl = { version: 1, segments: [] }
    await client(fetchMock).edit.continueUseCase({ jobId: "job-1", mode: "render-final", editedEdl })
    expect(JSON.parse((fetchMock.mock.calls[1]![1] as { body: string }).body)).toEqual({ jobId: "job-1", mode: "render-final", editedEdl })
  })

  it("continueUseCase reads the run's type when none is given, and continues it on that type's route", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(TIGHTEN_RUN()).mockReturnValueOnce(mockOk({ jobId: "job-2" }))
    const out = await client(fetchMock).edit.continueUseCase({ jobId: "job-1", mode: "from-failed" })
    expect(out.jobId).toBe("job-2")
    const calls = fetchMock.mock.calls.map(([url, init]) => `${(init as { method: string }).method} ${url as string}`)
    expect(calls).toEqual([
      "GET https://api.example.com/v1/jobs/job-1",
      "POST https://api.example.com/v1/tighten-episode/continue",
    ])
  })

  it("the type the run's input records wins over its job_type", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(mockOk({ data: { id: "job-1", job_type: "something-else", input_data: { type: "tighten-episode" } } }))
      .mockReturnValueOnce(mockOk({ jobId: "job-2" }))
    await client(fetchMock).edit.continueUseCase({ jobId: "job-1", mode: "from-failed" })
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.example.com/v1/tighten-episode/continue")
  })

  it("a row with no recorded type is read by its job_type", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(mockOk({ data: { id: "job-1", job_type: "tighten-episode", input_data: { mode: "run" } } }))
      .mockReturnValueOnce(mockOk({ jobId: "job-2" }))
    await client(fetchMock).edit.continueUseCase({ jobId: "job-1", mode: "from-failed" })
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.example.com/v1/tighten-episode/continue")
  })

  it("continueUseCase with nodeType posts straight to that type's route, without reading the job", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-2" }))
    await client(fetchMock).edit.continueUseCase({ jobId: "job-1", mode: "render-final", nodeType: "tighten-episode" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]! as [string, { method: string; body: string }]
    expect(url).toBe("https://api.example.com/v1/tighten-episode/continue")
    // nodeType picks the route; it is never part of the body.
    expect(JSON.parse(init.body)).toEqual({ jobId: "job-1", mode: "render-final" })
  })

  it("a key that may not read jobs (403) continues on the Tighten Episode route, as before the read", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(mockErr(403, { error: { code: "insufficient_scope", message: "Missing required scope: jobs:read", missingScope: "jobs:read" } }))
      .mockReturnValueOnce(mockOk({ jobId: "job-2" }))
    const out = await client(fetchMock).edit.continueUseCase({ jobId: "job-1", mode: "from-failed" }, { idempotencyKey: "k-1" })
    expect(out.jobId).toBe("job-2")
    const [url, init] = fetchMock.mock.calls[1]! as [string, { body: string; headers: Record<string, string> }]
    expect(url).toBe("https://api.example.com/v1/tighten-episode/continue")
    expect(JSON.parse(init.body)).toEqual({ jobId: "job-1", mode: "from-failed" })
    expect(init.headers["Idempotency-Key"]).toBe("k-1")
  })

  it("a job that is not a use-case run is sent to the Tighten Episode route, which answers its own not_found", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(mockOk({ data: { id: "job-1", job_type: "apply-edl", input_data: { edl: {} } } }))
      .mockReturnValueOnce(mockErr(404, { error: { code: "not_found", message: "That run was not found." } }))
    const err = await client(fetchMock).edit.continueUseCase({ jobId: "job-1", mode: "from-failed" }).catch((e: unknown) => e)
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.example.com/v1/tighten-episode/continue")
    expect(err).toBeInstanceOf(NotFoundError)
  })

  it("a read that fails otherwise (500, 401) rethrows and posts nothing", async () => {
    for (const [status, code] of [[500, "internal_error"], [401, "unauthorized"]] as const) {
      const fetchMock = vi.fn().mockReturnValueOnce(mockErr(status, { error: { code, message: code } }))
      const err = await client(fetchMock).edit.continueUseCase({ jobId: "job-1", mode: "from-failed" }).catch((e: unknown) => e)
      expect(err, code).toBeInstanceOf(NodaroError)
      expect(err, code).toMatchObject({ status })
      expect(fetchMock, code).toHaveBeenCalledTimes(1)
    }
  })

  it("a 403 that is not the jobs:read scope refusal rethrows and posts nothing", async () => {
    for (const body of [
      { error: { code: "forbidden", message: "Not allowed" } },
      { error: { code: "insufficient_scope", message: "Missing required scope: workflows:read", missingScope: "workflows:read" } },
    ]) {
      const fetchMock = vi.fn().mockReturnValueOnce(mockErr(403, body))
      const err = await client(fetchMock).edit.continueUseCase({ jobId: "job-1", mode: "from-failed" }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ForbiddenError)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it("an unknown nodeType throws before any request", async () => {
    const fetchMock = vi.fn()
    const err = await client(fetchMock)
      .edit.continueUseCase({ jobId: "job-1", mode: "from-failed", nodeType: "apply-edl" as never })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    expect(err).toMatchObject({ code: "invalid_node_type", status: 400 })
    expect((err as Error).message).toMatch(/apply-edl.*tighten-episode/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a job the read cannot find throws NotFoundError and posts nothing", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(404, { error: { code: "not_found", message: "Job not found" } }))
    const err = await client(fetchMock).edit.continueUseCase({ jobId: "job-1", mode: "from-failed" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NotFoundError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("a refusal that names a job throws ContinuationRefusedError carrying that jobId", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(TIGHTEN_RUN()).mockReturnValueOnce(
      mockErr(409, { error: { code: "continuation_superseded", message: "A later continuation of this run failed: continue that one." }, jobId: "job-newer" }),
    )
    const err = await client(fetchMock).edit.continueUseCase({ jobId: "job-1", mode: "from-failed" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ContinuationRefusedError)
    expect(err).toBeInstanceOf(NodaroError)
    expect(err).toMatchObject({ code: "continuation_superseded", status: 409, jobId: "job-newer" })
  })

  it("only the three named-job codes select it: another 409 carrying a jobId stays a plain NodaroError", async () => {
    for (const code of ["already_running", "continuation_superseded", "render_final_already_rendered"]) {
      const fetchMock = vi.fn().mockReturnValueOnce(TIGHTEN_RUN()).mockReturnValueOnce(mockErr(409, { error: { code, message: code }, jobId: "job-x" }))
      const err = await client(fetchMock).edit.continueUseCase({ jobId: "job-1", mode: "render-final" }).catch((e: unknown) => e)
      expect(err, code).toBeInstanceOf(ContinuationRefusedError)
    }
    const fetchMock = vi.fn().mockReturnValueOnce(TIGHTEN_RUN()).mockReturnValueOnce(mockErr(409, { error: { code: "some_other_conflict", message: "no" }, jobId: "job-x" }))
    const err = await client(fetchMock).edit.continueUseCase({ jobId: "job-1", mode: "from-failed" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    expect(err).not.toBeInstanceOf(ContinuationRefusedError)
  })

  it("a 409 that names no job stays a plain NodaroError", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(TIGHTEN_RUN()).mockReturnValueOnce(
      mockErr(409, { error: { code: "continuation_not_failed", message: "That run did not fail." } }),
    )
    const err = await client(fetchMock).edit.continueUseCase({ jobId: "job-1", mode: "from-failed" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    expect(err).not.toBeInstanceOf(ContinuationRefusedError)
    expect(err).toMatchObject({ code: "continuation_not_failed", status: 409 })
  })
})
