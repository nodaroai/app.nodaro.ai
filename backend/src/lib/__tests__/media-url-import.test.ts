import { describe, it, expect, vi, beforeEach } from "vitest"
import { promises as nodeFs } from "node:fs"

vi.mock("../safe-fetch.js", () => ({ safeFetch: vi.fn() }))
vi.mock("../storage.js", () => ({ uploadLocalFileToR2Key: vi.fn() }))
vi.mock("../../utils/file-validation.js", () => ({
  reserveStorageIfWithinLimit: vi.fn(),
  refundStorage: vi.fn().mockResolvedValue(undefined),
  checkStorageQuota: vi.fn(),
}))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: vi.fn(), probeMediaStreams: vi.fn() }))
vi.mock("../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../utils/faststart.js", () => ({ faststartVideoFile: vi.fn(), noteFaststartOutcome: vi.fn() }))

import { safeFetch } from "../safe-fetch.js"
import { uploadLocalFileToR2Key } from "../storage.js"
import { reserveStorageIfWithinLimit, checkStorageQuota } from "../../utils/file-validation.js"
import { probeMediaDuration, probeMediaStreams } from "../../providers/video/ffmpeg-utils.js"
import { supabase } from "../supabase.js"
import { faststartVideoFile } from "../../utils/faststart.js"
import { clearUploadPolicies, registerUploadPolicy } from "../upload-policy.js"
import { importRecordingFromUrl, IMPORT_MAX_BYTES } from "../media-url-import.js"

const URL_OK = "https://host.example/episode.mp4"

function mediaResponse(body: string, headers: Record<string, string>): Response {
  return new Response(body, { status: 200, headers })
}

function okSupabaseInsert(id: string | null, error: unknown = null) {
  const single = vi.fn().mockResolvedValue({ data: id ? { id } : null, error })
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })
  vi.mocked(supabase.from).mockReturnValue({ insert } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  clearUploadPolicies()
  vi.mocked(probeMediaDuration).mockResolvedValue(120)
  vi.mocked(probeMediaStreams).mockResolvedValue({ hasVideo: true } as never)
  vi.mocked(checkStorageQuota).mockResolvedValue({ remainingBytes: 10 ** 12, usedBytes: 0, quotaBytes: 10 ** 12, tier: "pro" } as never)
  vi.mocked(reserveStorageIfWithinLimit).mockResolvedValue(true)
  vi.mocked(uploadLocalFileToR2Key).mockResolvedValue("https://cdn.test/uploads/videos/x.mp4")
  okSupabaseInsert("asset-1")
  // Default: the file is already faststart — the import behaves exactly as before.
  vi.mocked(faststartVideoFile).mockImplementation(async (path) => ({ path, outcome: "already-faststart" }))
})

describe("importRecordingFromUrl — fetch/validation gates", () => {
  it("422 when the fetch throws", async () => {
    vi.mocked(safeFetch).mockRejectedValue(new Error("dns"))
    const r = await importRecordingFromUrl("u1", URL_OK)
    expect(r).toMatchObject({ ok: false, status: 422, code: "fetch_failed" })
  })

  it("422 on a non-2xx origin", async () => {
    vi.mocked(safeFetch).mockResolvedValue(new Response("nope", { status: 404 }))
    const r = await importRecordingFromUrl("u1", URL_OK)
    expect(r).toMatchObject({ ok: false, status: 422 })
  })

  it("400 when the Content-Type is obviously not media (html)", async () => {
    vi.mocked(safeFetch).mockResolvedValue(mediaResponse("<html>", { "content-type": "text/html" }))
    const r = await importRecordingFromUrl("u1", URL_OK)
    expect(r).toMatchObject({ ok: false, status: 400, code: "validation_error" })
  })

  it("400 when the Content-Type is not a recognized A/V type", async () => {
    vi.mocked(safeFetch).mockResolvedValue(mediaResponse("...", { "content-type": "application/octet-stream" }))
    const r = await importRecordingFromUrl("u1", URL_OK)
    expect(r).toMatchObject({ ok: false, status: 400 })
  })

  it("413 when the declared Content-Length exceeds the cap (no stream)", async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      mediaResponse("x", { "content-type": "video/mp4", "content-length": String(IMPORT_MAX_BYTES + 1) }),
    )
    const r = await importRecordingFromUrl("u1", URL_OK)
    expect(r).toMatchObject({ ok: false, status: 413, code: "file_too_large" })
    expect(probeMediaDuration).not.toHaveBeenCalled()
  })
})

describe("importRecordingFromUrl — policy is asked BEFORE any write", () => {
  it("403 when a registered policy denies, without downloading", async () => {
    registerUploadPolicy({ id: "deny", check: () => ({ allow: false, reason: "blocked here" }) })
    vi.mocked(safeFetch).mockResolvedValue(mediaResponse("bytes", { "content-type": "video/mp4" }))
    const r = await importRecordingFromUrl("u1", URL_OK)
    expect(r).toMatchObject({ ok: false, status: 403, code: "upload_blocked", message: "blocked here" })
    expect(probeMediaDuration).not.toHaveBeenCalled()
    expect(uploadLocalFileToR2Key).not.toHaveBeenCalled()
  })

  it("passes lane 'media-import' + metadata to the policy", async () => {
    const check = vi.fn().mockReturnValue({ allow: true })
    registerUploadPolicy({ id: "spy", check })
    vi.mocked(safeFetch).mockResolvedValue(mediaResponse("bytes", { "content-type": "audio/mpeg" }))
    await importRecordingFromUrl("u1", "https://host.example/show.mp3")
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ lane: "media-import", kind: "audio", mime: "audio/mpeg", userId: "u1" }))
  })
})

describe("importRecordingFromUrl — probe + duration cap + happy path", () => {
  it("400 when the bytes don't probe as decodable media", async () => {
    vi.mocked(safeFetch).mockResolvedValue(mediaResponse("bytes", { "content-type": "video/mp4" }))
    vi.mocked(probeMediaDuration).mockResolvedValue(0)
    const r = await importRecordingFromUrl("u1", URL_OK)
    expect(r).toMatchObject({ ok: false, status: 400 })
    expect(uploadLocalFileToR2Key).not.toHaveBeenCalled()
  })

  it("413 when the probed duration exceeds the 3-hour cap", async () => {
    vi.mocked(safeFetch).mockResolvedValue(mediaResponse("bytes", { "content-type": "video/mp4" }))
    vi.mocked(probeMediaDuration).mockResolvedValue(3 * 60 * 60 + 1)
    const r = await importRecordingFromUrl("u1", URL_OK)
    expect(r).toMatchObject({ ok: false, status: 413, code: "duration_exceeded" })
  })

  it("413 storage_limit_exceeded when the reservation fails", async () => {
    vi.mocked(safeFetch).mockResolvedValue(mediaResponse("bytes", { "content-type": "video/mp4" }))
    vi.mocked(reserveStorageIfWithinLimit).mockResolvedValue(false)
    vi.mocked(checkStorageQuota).mockResolvedValue({ error: "over", usedBytes: 1, quotaBytes: 1, remainingBytes: 0, tier: "free" } as never)
    const r = await importRecordingFromUrl("u1", URL_OK)
    expect(r).toMatchObject({ ok: false, status: 413, code: "storage_limit_exceeded" })
    expect(uploadLocalFileToR2Key).not.toHaveBeenCalled()
  })

  it("imports a valid recording: stores it, writes an asset row, returns the url + duration + kind", async () => {
    vi.mocked(safeFetch).mockResolvedValue(mediaResponse("fake video bytes", { "content-type": "video/mp4" }))
    const r = await importRecordingFromUrl("u1", URL_OK)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r).toMatchObject({ url: "https://cdn.test/uploads/videos/x.mp4", assetId: "asset-1", mimeType: "video/mp4", durationSec: 120, kind: "video" })
    expect(r.sizeBytes).toBeGreaterThan(0)
    const [, key, ctype] = vi.mocked(uploadLocalFileToR2Key).mock.calls[0]
    expect(key).toMatch(/^uploads\/videos\/[0-9a-f-]+\.mp4$/)
    expect(ctype).toBe("video/mp4")
  })

  it("uses the PROBED streams for kind, not the (spoofable) Content-Type", async () => {
    // Served as video/mp4 but the streams have no video → stored as audio.
    vi.mocked(safeFetch).mockResolvedValue(mediaResponse("bytes", { "content-type": "video/mp4" }))
    vi.mocked(probeMediaStreams).mockResolvedValue({ hasVideo: false } as never)
    const r = await importRecordingFromUrl("u1", URL_OK)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.kind).toBe("audio")
    expect(vi.mocked(uploadLocalFileToR2Key).mock.calls[0][1]).toMatch(/^uploads\/audios\//)
  })

  it("re-consults the policy after download with the REAL size (not the advisory Content-Length)", async () => {
    const check = vi.fn().mockReturnValue({ allow: true })
    registerUploadPolicy({ id: "spy2", check })
    vi.mocked(safeFetch).mockResolvedValue(mediaResponse("real bytes here", { "content-type": "video/mp4", "content-length": "999999" }))
    await importRecordingFromUrl("u1", URL_OK)
    // Two calls: pre-download (advisory 999999) then post-download (real stat size).
    expect(check).toHaveBeenCalledTimes(2)
    const postSize = check.mock.calls[1][0].sizeBytes
    expect(postSize).toBe("real bytes here".length)
    expect(postSize).not.toBe(999999)
  })
})

describe("importRecordingFromUrl — faststart (moov-last MP4/MOV is rewritten before anything is counted or stored)", () => {
  /** A remux that grows the file, so every downstream consumer visibly reads the NEW one. */
  function remuxesTo(content: string) {
    vi.mocked(faststartVideoFile).mockImplementation(async (path) => {
      const out = `${path}.faststart`
      await nodeFs.writeFile(out, content)
      return { path: out, outcome: "remuxed" }
    })
  }

  it("uploads, sizes, reserves, polices and records the REMUXED file", async () => {
    const remuxed = "remuxed bytes, a little longer"
    remuxesTo(remuxed)
    const check = vi.fn().mockReturnValue({ allow: true })
    registerUploadPolicy({ id: "spy3", check })
    vi.mocked(safeFetch).mockResolvedValue(mediaResponse("fetched bytes", { "content-type": "video/mp4" }))
    const insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "a1" }, error: null }) }) })
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const r = await importRecordingFromUrl("u1", URL_OK)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(vi.mocked(faststartVideoFile).mock.calls[0]![1]).toBe("video/mp4")
    expect(vi.mocked(uploadLocalFileToR2Key).mock.calls[0]![0]).toMatch(/\.faststart$/)
    expect(r.sizeBytes).toBe(remuxed.length)
    expect(vi.mocked(reserveStorageIfWithinLimit)).toHaveBeenCalledWith("u1", remuxed.length)
    expect(check.mock.calls[1]![0].sizeBytes).toBe(remuxed.length) // the post-download policy sees the final bytes
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ size_bytes: remuxed.length }))
  })

  it("a failed remux imports the file exactly as fetched", async () => {
    vi.mocked(faststartVideoFile).mockImplementation(async (path) => ({ path, outcome: "failed", reason: "boom" }))
    vi.mocked(safeFetch).mockResolvedValue(mediaResponse("fetched bytes", { "content-type": "video/mp4" }))
    const r = await importRecordingFromUrl("u1", URL_OK)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.sizeBytes).toBe("fetched bytes".length)
    expect(vi.mocked(uploadLocalFileToR2Key).mock.calls[0]![0]).toMatch(/source\.mp4$/)
  })

  it("never runs for audio, and not before the file has probed as real media", async () => {
    vi.mocked(safeFetch).mockResolvedValue(mediaResponse("bytes", { "content-type": "audio/mpeg" }))
    vi.mocked(probeMediaStreams).mockResolvedValue({ hasVideo: false } as never)
    await importRecordingFromUrl("u1", "https://host.example/show.mp3")
    expect(faststartVideoFile).not.toHaveBeenCalled()

    vi.mocked(safeFetch).mockResolvedValue(mediaResponse("junk", { "content-type": "video/mp4" }))
    vi.mocked(probeMediaDuration).mockResolvedValue(0)
    await importRecordingFromUrl("u1", URL_OK)
    expect(faststartVideoFile).not.toHaveBeenCalled()
  })
})

describe("importRecordingFromUrl — concurrency cap", () => {
  it("returns 429 once the per-user in-flight cap is exceeded", async () => {
    let release = () => {}
    const gate = new Promise<void>((r) => { release = r })
    vi.mocked(safeFetch).mockImplementation(async () => {
      await gate
      return mediaResponse("bytes", { "content-type": "video/mp4" })
    })
    // MAX_INFLIGHT_PER_USER = 2 → two hold slots (pending on the gate), the 3rd is refused.
    const p1 = importRecordingFromUrl("cap-user", URL_OK)
    const p2 = importRecordingFromUrl("cap-user", URL_OK)
    const r3 = await importRecordingFromUrl("cap-user", URL_OK)
    expect(r3).toMatchObject({ ok: false, status: 429, code: "too_many_imports" })
    release()
    await Promise.all([p1, p2])
  })
})
