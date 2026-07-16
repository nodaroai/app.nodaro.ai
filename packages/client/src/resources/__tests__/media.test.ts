import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function make(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock as unknown as typeof fetch })
}

describe("media resource", () => {
  it("downloadVideo() POSTs /v1/download-video and returns { downloadId }", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ downloadId: "dl-1" }))
    const c = make(fetchMock)
    const out = await c.media.downloadVideo({ url: "https://youtu.be/x", maxHeight: 720, sectionStartSec: 30, sectionEndSec: 50 })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/download-video")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ url: "https://youtu.be/x", maxHeight: 720, sectionStartSec: 30, sectionEndSec: 50 })
    expect(out.downloadId).toBe("dl-1")
  })

  it("saveToStorage() POSTs /v1/save-to-storage", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j1" }))
    const c = make(fetchMock)
    await c.media.saveToStorage({ mediaUrl: "https://x/a.mp4", mediaType: "video" })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/save-to-storage")
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({ mediaUrl: "https://x/a.mp4", mediaType: "video" })
  })

  it("trimVideo() POSTs /v1/trim-video with the range", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j2" }))
    const c = make(fetchMock)
    await c.media.trimVideo({ videoUrl: "https://x/v.mp4", startTime: 5, endTime: 20 })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/trim-video")
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({ videoUrl: "https://x/v.mp4", startTime: 5, endTime: 20 })
  })

  it("trimAudio() POSTs /v1/trim-audio", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j3" }))
    const c = make(fetchMock)
    await c.media.trimAudio({ videoUrl: "https://x/v.mp4", audioFormat: "wav", startTime: 0, endTime: 10 })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/trim-audio")
  })

  it("videoMetadata() POSTs /v1/video-metadata and returns the metadata directly", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ durationSec: 212, width: 1280, height: 720, title: "Clip", isLive: false }))
    const c = make(fetchMock)
    const out = await c.media.videoMetadata({ url: "https://youtu.be/x" })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/video-metadata")
    expect(out.durationSec).toBe(212)
    expect(out.height).toBe(720)
  })
})
