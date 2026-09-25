import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NodaroError, EditResource, unwrapEditPlanOutput } from "../../index.js"
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
