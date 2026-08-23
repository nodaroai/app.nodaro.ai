import { describe, expect, it, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

function make(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({
    baseUrl: "https://api.example.com",
    auth: new StaticTokenAuth("t"),
    fetch: fetchMock as unknown as typeof fetch,
  })
}

describe("recast resource audio layers", () => {
  it("estimateRescore() quotes a complete prospective operation without a request id", async () => {
    const response = { credits: 34, audioRevision: "audio-r1", noOp: false }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(response))
    const client = make(fetchMock)

    await expect(client.recast.estimateRescore("recast 1", {
      expectedAudioRevision: "audio-r1",
      sections: [{ index: 0, brief: "A sparse analogue score" }],
      mix: {
        music: { gain: 62, muted: false },
        video: { gain: 80, muted: false },
      },
    })).resolves.toEqual(response)

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/recast/recast%201/estimate-rescore",
    )
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({
      expectedAudioRevision: "audio-r1",
      sections: [{ index: 0, brief: "A sparse analogue score" }],
      mix: {
        music: { gain: 62, muted: false },
        video: { gain: 80, muted: false },
      },
    })
  })

  it("rescore() submits the revision and stable request id together", async () => {
    const response = { recastId: "recast-1", jobId: "job-1" }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(response))
    const client = make(fetchMock)

    await expect(client.recast.rescore("recast-1", {
      requestId: "0e39b04d-576c-46a5-9c89-07d4da4689a4",
      expectedAudioRevision: "audio-r1",
      mix: {
        music: { gain: 0, muted: true },
        video: { gain: 125, muted: false },
      },
    })).resolves.toEqual(response)

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/recast/recast-1/rescore",
    )
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({
      requestId: "0e39b04d-576c-46a5-9c89-07d4da4689a4",
      expectedAudioRevision: "audio-r1",
      mix: {
        music: { gain: 0, muted: true },
        video: { gain: 125, muted: false },
      },
    })
  })
})
