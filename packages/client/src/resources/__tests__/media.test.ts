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

  it("stillToVideo() POSTs /v1/still-to-video with image + audio + levers", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j-stv" }))
    const c = make(fetchMock)
    const out = await c.media.stillToVideo({
      imageUrl: "https://x/still.png",
      audioUrl: "https://x/track.mp3",
      motion: "ken-burns",
      intensity: 4,
      resolution: "1080p",
      aspectRatio: "16:9",
      fps: 30,
      fit: "contain",
      padColor: "#101010",
    })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/still-to-video")
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({
      imageUrl: "https://x/still.png",
      audioUrl: "https://x/track.mp3",
      motion: "ken-burns",
      intensity: 4,
      resolution: "1080p",
      aspectRatio: "16:9",
      fps: 30,
      fit: "contain",
      padColor: "#101010",
    })
    expect(out.jobId).toBe("j-stv")
  })

  it("slideshow() POSTs /v1/slideshow with images + levers", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j-slides" }))
    const c = make(fetchMock)
    const out = await c.media.slideshow({
      imageUrls: ["https://x/a.png", "https://x/b.png", "https://x/c.png"],
      audioUrl: "https://x/track.mp3",
      imageDurations: [10, null, null],
      transition: "dissolve",
      transitionDuration: 0.5,
      motion: "alternate",
    })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/slideshow")
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({
      imageUrls: ["https://x/a.png", "https://x/b.png", "https://x/c.png"],
      audioUrl: "https://x/track.mp3",
      imageDurations: [10, null, null],
      transition: "dissolve",
      transitionDuration: 0.5,
      motion: "alternate",
    })
    expect(out.jobId).toBe("j-slides")
  })

  it("trimAudio() POSTs /v1/trim-audio", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j3" }))
    const c = make(fetchMock)
    await c.media.trimAudio({ videoUrl: "https://x/v.mp4", audioFormat: "wav", startTime: 0, endTime: 10 })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/trim-audio")
  })

  it("imageCollage() POSTs /v1/image-collage with per-image size hints and returns { jobId }", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j4" }))
    const c = make(fetchMock)
    const out = await c.media.imageCollage({
      imageUrls: ["https://x/a.png", "https://x/b.png", "https://x/c.png"],
      imageSizes: [1, 0, 3],
      layout: "smart",
      resolution: "2K",
      aspectRatio: "16:9",
    })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/image-collage")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({
      imageUrls: ["https://x/a.png", "https://x/b.png", "https://x/c.png"],
      imageSizes: [1, 0, 3],
      layout: "smart",
      resolution: "2K",
      aspectRatio: "16:9",
    })
    expect(out.jobId).toBe("j4")
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

/** A Response whose body is an SSE stream emitting the given raw chunks. */
function mockSse(chunks: string[]) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return Promise.resolve({ ok: true, status: 200, body } as unknown as Response)
}

describe("media.downloadVideoProgress", () => {
  it("GETs the progress endpoint with auth and yields each SSE event until the stream ends", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockSse([
        'data: {"phase":"downloading","percent":12}\n\n',
        'data: {"phase":"uploading","percent":100}\n\ndata: {"phase":"completed","percent":100,"videoUrl":"https://r2/x.mp4"}\n\n',
      ]),
    )
    const c = make(fetchMock)
    const events = []
    for await (const ev of c.media.downloadVideoProgress("dl-1")) events.push(ev)

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/download-video/progress/dl-1")
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(init.headers.Authorization).toBe("Bearer t")
    expect(events).toEqual([
      { phase: "downloading", percent: 12 },
      { phase: "uploading", percent: 100 },
      { phase: "completed", percent: 100, videoUrl: "https://r2/x.mp4" },
    ])
  })

  it("reassembles an SSE frame split across chunk boundaries", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockSse(['data: {"phase":"downloadi', 'ng","percent":55}\n', "\n"]),
    )
    const c = make(fetchMock)
    const events = []
    for await (const ev of c.media.downloadVideoProgress("dl-2")) events.push(ev)
    expect(events).toEqual([{ phase: "downloading", percent: 55 }])
  })

  it("throws the typed error on a non-OK response (expired download → 404)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({ error: { code: "not_found", message: "Download not found or expired" } }),
      } as unknown as Response),
    )
    const c = make(fetchMock)
    const iterate = async () => {
      for await (const ev of c.media.downloadVideoProgress("dl-gone")) void ev
    }
    await expect(iterate()).rejects.toThrow("Download not found or expired")
  })
})
