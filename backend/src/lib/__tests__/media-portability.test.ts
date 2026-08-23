/**
 * Workflow media portability (#866): the export half lists media URLs another
 * instance cannot fetch; the import half copies reachable foreign media onto
 * this instance's storage and reports what it could not.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { safeFetchMock, uploadMock, r2KeyMock, r2SizeMock, storeImageMock, reserveMock, refundMock, insertMock } = vi.hoisted(() => ({
  safeFetchMock: vi.fn<(url: string, init?: unknown) => Promise<Response>>(),
  uploadMock: vi.fn<(buf: Buffer, key: string, mime: string) => Promise<string>>(),
  r2KeyMock: vi.fn<(url: string) => string | null>(),
  r2SizeMock: vi.fn<(key: string) => Promise<number>>(),
  storeImageMock: vi.fn(),
  reserveMock: vi.fn<(userId: string, bytes: number) => Promise<boolean>>(),
  refundMock: vi.fn(),
  insertMock: vi.fn(),
}))

vi.mock("../safe-fetch.js", () => ({ safeFetch: safeFetchMock }))
vi.mock("../storage.js", () => ({ uploadBufferToR2: uploadMock, r2KeyFromOurUrl: r2KeyMock, getR2ObjectSize: r2SizeMock }))
vi.mock("../media-import.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../media-import.js")>()
  return { ...actual, storeImportedImageBuffer: storeImageMock }
})
vi.mock("../supabase.js", () => ({
  supabase: { from: vi.fn(() => ({ insert: insertMock })) },
}))
vi.mock("../../utils/file-validation.js", () => ({
  reserveStorageIfWithinLimit: reserveMock,
  refundStorage: refundMock,
  checkStorageQuota: vi.fn(),
}))

import {
  collectNodeMediaUrls,
  findUnroutableMedia,
  isUnroutableMediaUrl,
  rehostForeignMedia,
} from "../media-portability.js"

/** A Response-like object with a streaming body, as the capped reader consumes it. */
function mediaResponse(bytes: Buffer, contentType: string, status = 200): Response {
  return new Response(new Uint8Array(bytes), { status, headers: { "content-type": contentType } })
}

const OUR_PREFIX = "http://localhost:3000/storage/nodaro-assets/"
const OURS = OUR_PREFIX + "videos/mine.mp4"
const PUBLIC_VIDEO = "https://cdn.example.com/clips/intro.mp4"
const PUBLIC_IMAGE = "https://cdn.example.com/stills/frame.png"

beforeEach(() => {
  vi.clearAllMocks()
  // Anything under our public prefix resolves to a key; the object EXISTS only for OURS.
  r2KeyMock.mockImplementation((url) => (url.startsWith(OUR_PREFIX) ? url.slice(OUR_PREFIX.length) : null))
  r2SizeMock.mockImplementation(async (key) => (key === "videos/mine.mp4" ? 1234 : 0))
  reserveMock.mockResolvedValue(true)
  insertMock.mockResolvedValue({ error: null })
  uploadMock.mockImplementation(async (_buf, key) => `https://this-instance.example/${key}`)
  storeImageMock.mockResolvedValue({ ok: true, url: "https://this-instance.example/uploads/images/x.png" })
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("isUnroutableMediaUrl", () => {
  it("flags hosts nothing outside the machine/network can reach", () => {
    for (const u of [
      "http://localhost:3000/storage/a.png",
      "http://127.0.0.1:9000/b.mp4",
      "http://10.0.0.5/c.wav",
      "http://192.168.1.20:3000/d.png",
      "http://172.16.4.4/e.png",
      "http://host.docker.internal:3000/f.png",
      "http://minio:9000/g.png",
      "http://media.corp.internal/h.png",
      "http://[::1]:3000/i.png",
      "ftp://cdn.example.com/j.png",
      "not a url",
    ]) {
      expect(isUnroutableMediaUrl(u), u).toBe(true)
    }
  })

  it("passes public hosts", () => {
    for (const u of ["https://cdn.nodaro.ai/images/a.png", PUBLIC_VIDEO, "http://203.0.113.9/x.mp4"]) {
      expect(isUnroutableMediaUrl(u), u).toBe(false)
    }
  })
})

describe("collectNodeMediaUrls / findUnroutableMedia", () => {
  const nodes = [
    {
      id: "n1",
      type: "youtube-video",
      data: { label: "Video URL", youtubeUrl: OURS, prompt: "see https://example.com/not-a-field" },
    },
    {
      id: "n2",
      type: "generate-video",
      data: {
        referenceImageUrls: [PUBLIC_IMAGE, "http://localhost:3000/storage/ref.png"],
        nested: { assets: [{ url: "http://10.1.1.1/deep.png" }] },
        generatedResults: [{ url: "https://cdn.nodaro.ai/out.mp4" }],
      },
    },
    { id: "n3", type: "text-prompt", data: { prompt: "no media here" } },
  ]

  it("finds URL-NAMED fields only — a link inside a prompt is never a media ref", () => {
    const refs = collectNodeMediaUrls(nodes)
    expect(refs.map((r) => `${r.nodeId}:${r.field}`)).toEqual([
      "n1:youtubeUrl",
      "n2:referenceImageUrls[0]",
      "n2:referenceImageUrls[1]",
      "n2:nested.assets[0].url",
      "n2:generatedResults[0].url",
    ])
    expect(refs[0]).toMatchObject({ nodeLabel: "Video URL" })
    expect(refs[1]).not.toHaveProperty("nodeLabel")
  })

  it("lists only the unreachable ones for the export note", () => {
    expect(findUnroutableMedia(nodes).map((r) => r.url)).toEqual([
      OURS,
      "http://localhost:3000/storage/ref.png",
      "http://10.1.1.1/deep.png",
    ])
  })
})

describe("rehostForeignMedia", () => {
  it("copies reachable foreign media onto this instance, leaves ours alone, reports private hosts", async () => {
    safeFetchMock.mockImplementation(async (url) => {
      if (url === PUBLIC_VIDEO) return mediaResponse(Buffer.from("mp4-bytes"), "video/mp4")
      if (url === PUBLIC_IMAGE) return mediaResponse(Buffer.from("png-bytes"), "image/png")
      throw new Error(`unexpected fetch ${url}`)
    })
    const nodes = [
      { id: "a", data: { videoUrl: PUBLIC_VIDEO, label: "Clip" } },
      { id: "b", data: { imageUrl: PUBLIC_IMAGE, referenceImageUrls: [PUBLIC_IMAGE, OURS] } },
      { id: "c", data: { audioUrl: "http://192.168.0.9/voice.wav" } },
    ]
    const snapshot = JSON.stringify(nodes)

    const { nodes: out, report } = await rehostForeignMedia(nodes, "user-1")

    expect(report.skipped.map((s) => `${s.field}: ${s.reason}`)).toEqual([])
    expect(report.rehosted).toBe(2)
    expect(report.unreachable).toEqual([{ nodeId: "c", field: "audioUrl", url: "http://192.168.0.9/voice.wav" }])
    // One fetch per distinct URL, however many fields reference it.
    expect(safeFetchMock).toHaveBeenCalledTimes(2)
    // Video: stored under uploads/videos with a library row; image: through the image-import path.
    expect(uploadMock).toHaveBeenCalledWith(expect.any(Buffer), expect.stringMatching(/^uploads\/videos\/[0-9a-f-]+\.mp4$/), "video/mp4")
    expect(reserveMock).toHaveBeenCalledWith("user-1", 9)
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1", type: "video", upload_source: "url_import" }))
    expect(storeImageMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", uploadSource: "url_import", sourceUrl: PUBLIC_IMAGE }))
    // Rewritten in place of the foreign URL, everything else byte-identical.
    const a = out[0] as { data: { videoUrl: string; label: string } }
    const b = out[1] as { data: { imageUrl: string; referenceImageUrls: string[] } }
    expect(a.data.videoUrl).toMatch(/^https:\/\/this-instance\.example\/uploads\/videos\//)
    expect(a.data.label).toBe("Clip")
    expect(b.data.imageUrl).toBe("https://this-instance.example/uploads/images/x.png")
    expect(b.data.referenceImageUrls).toEqual(["https://this-instance.example/uploads/images/x.png", OURS])
    expect(out[2]).toEqual(nodes[2])
    // Input never mutated.
    expect(JSON.stringify(nodes)).toBe(snapshot)
  })

  it("skips — with a reason — what it will not copy: non-media, HTTP errors, oversize, storage limit, the cap", async () => {
    safeFetchMock.mockImplementation(async (url) => {
      if (url.endsWith("/page.html")) return mediaResponse(Buffer.from("<html>"), "text/html")
      if (url.endsWith("/gone.mp4")) return mediaResponse(Buffer.alloc(0), "video/mp4", 404)
      if (url.endsWith("/huge.mp4")) return mediaResponse(Buffer.alloc(64), "video/mp4")
      if (url.endsWith("/full.mp4")) return mediaResponse(Buffer.from("x"), "video/mp4")
      throw new Error("boom")
    })
    reserveMock.mockImplementation(async (_u, bytes) => bytes !== 1)
    const nodes = [
      {
        id: "n",
        data: {
          htmlUrl: "https://cdn.example.com/page.html",
          goneUrl: "https://cdn.example.com/gone.mp4",
          hugeUrl: "https://cdn.example.com/huge.mp4",
          fullUrl: "https://cdn.example.com/full.mp4",
          deadUrl: "https://cdn.example.com/dead.mp4",
          extraUrls: ["https://cdn.example.com/over-cap.mp4"],
        },
      },
    ]
    const { nodes: out, report } = await rehostForeignMedia(nodes, "user-1", { maxBytes: 32, maxFiles: 5, concurrency: 1 })
    expect(report.rehosted).toBe(0)
    const reasons = Object.fromEntries(report.skipped.map((s) => [s.field, s.reason]))
    expect(reasons.htmlUrl).toMatch(/not media/)
    expect(reasons.goneUrl).toBe("HTTP 404")
    expect(reasons.hugeUrl).toMatch(/larger than/)
    expect(reasons.fullUrl).toBe("storage limit exceeded")
    expect(reasons.deadUrl).toMatch(/fetch failed: boom/)
    expect(reasons["extraUrls[0]"]).toMatch(/5-file import cap/)
    expect(out).toEqual(nodes)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it("refunds the reservation and reports when the upload itself fails", async () => {
    safeFetchMock.mockResolvedValue(mediaResponse(Buffer.from("abc"), "audio/mpeg"))
    uploadMock.mockRejectedValue(new Error("R2 down"))
    const { report } = await rehostForeignMedia([{ id: "n", data: { audioUrl: "https://cdn.example.com/a.mp3" } }], "user-1")
    expect(report.skipped[0]?.reason).toBe("upload failed: R2 down")
    expect(refundMock).toHaveBeenCalledWith("user-1", 3)
  })

  it("a URL under OUR prefix that does not exist here is another install's private storage — unreachable, never 'ours' (#866's flagship case)", async () => {
    // Two default self-hosts share http://localhost:3000/storage/… verbatim.
    const theirs = OUR_PREFIX + "videos/not-here.mp4"
    const nodes = [{ id: "n", data: { videoUrl: theirs, imageUrl: OURS } }]
    const { nodes: out, report } = await rehostForeignMedia(nodes, "user-1")
    expect(safeFetchMock).not.toHaveBeenCalled()
    expect(report.unreachable).toEqual([{ nodeId: "n", field: "videoUrl", url: theirs }])
    expect(report.rehosted).toBe(0)
    expect(out).toEqual(nodes)
  })

  it("never fetches endpoints, previews, or generated output — inputs only", async () => {
    safeFetchMock.mockResolvedValue(mediaResponse(Buffer.from("x"), "video/mp4"))
    const nodes = [
      {
        id: "n",
        data: {
          webhookUrl: "https://hooks.example.com/abc",
          platformPostUrl: "https://social.example.com/p/1",
          thumbnailUrl: "https://cdn.example.com/thumb.png",
          generatedVideoUrl: "https://cdn.example.com/out.mp4",
          generatedResults: [{ url: "https://cdn.example.com/out-2.mp4" }],
          videoUrl: PUBLIC_VIDEO,
        },
      },
    ]
    const { report } = await rehostForeignMedia(nodes, "user-1")
    expect(safeFetchMock).toHaveBeenCalledTimes(1)
    expect(safeFetchMock).toHaveBeenCalledWith(PUBLIC_VIDEO, expect.anything())
    expect(report.rehosted).toBe(1)
    // …while the export-side listing still sees every URL-named field.
    expect(collectNodeMediaUrls(nodes).map((r) => r.field)).toContain("webhookUrl")
  })

  it("a copy that THROWS (stream reset, R2 failure in the image path) is a skipped entry, never a failed import", async () => {
    safeFetchMock.mockImplementation(async (url) => {
      if (url === PUBLIC_IMAGE) return mediaResponse(Buffer.from("png"), "image/png")
      return mediaResponse(Buffer.from("mp4"), "video/mp4")
    })
    storeImageMock.mockRejectedValue(new Error("R2 down"))
    const nodes = [{ id: "n", data: { imageUrl: PUBLIC_IMAGE, videoUrl: PUBLIC_VIDEO } }]
    const { nodes: out, report } = await rehostForeignMedia(nodes, "user-1")
    expect(report.skipped).toEqual([{ nodeId: "n", field: "imageUrl", url: PUBLIC_IMAGE, reason: "copy failed: R2 down" }])
    expect(report.rehosted).toBe(1)
    expect((out[0] as { data: { imageUrl: string } }).data.imageUrl).toBe(PUBLIC_IMAGE)
  })

  it("rewrites on the same axis it walked — a URL at the deepest walked level is both copied and replaced", async () => {
    safeFetchMock.mockResolvedValue(mediaResponse(Buffer.from("mp4"), "video/mp4"))
    // data → a → b → c → d → e → { videoUrl }  (depth 6 from data)
    const nodes = [{ id: "n", data: { a: { b: { c: { d: { e: { f: { videoUrl: PUBLIC_VIDEO } } } } } } } }]
    const { nodes: out, report } = await rehostForeignMedia(nodes, "user-1")
    expect(report.rehosted).toBe(1)
    const deep = (out[0] as { data: { a: { b: { c: { d: { e: { f: { videoUrl: string } } } } } } } }).data.a.b.c.d.e.f.videoUrl
    expect(deep).toMatch(/^https:\/\/this-instance\.example\//)
  })

  it("is a no-op when every URL is already ours — no fetch, nodes returned as-is", async () => {
    const nodes = [{ id: "n", data: { videoUrl: OURS } }]
    const { nodes: out, report } = await rehostForeignMedia(nodes, "user-1")
    expect(safeFetchMock).not.toHaveBeenCalled()
    expect(report).toEqual({ rehosted: 0, unreachable: [], skipped: [] })
    expect(out).toEqual(nodes)
  })
})
