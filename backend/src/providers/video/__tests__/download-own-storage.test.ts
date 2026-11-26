// @test-reads-none reads back only the temp files its downloads write; reads no repo file
/**
 * `downloadFile` reads a file of OUR storage straight from storage, not back
 * through the public host: the first read of a freshly written object is a
 * miss at the edge and can trickle. A missing object stays an honest 404; any
 * other storage failure falls back to HTTP; an HTTP timeout of one of our
 * files is retried once from storage. An install without storage (or without
 * a public base) keeps the HTTP path only.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  downloadR2ObjectToFile: vi.fn(),
  isStorageConfigured: vi.fn(() => true),
}))

vi.mock("../../../lib/safe-fetch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/safe-fetch.js")>()),
  safeFetch: mocks.safeFetch,
}))

vi.mock("../../../lib/storage.js", () => ({
  isStorageConfigured: mocks.isStorageConfigured,
  r2KeyFromOurUrl: (url: string) => {
    const base = process.env.R2_PUBLIC_URL
    return base && url.startsWith(`${base}/`) ? url.slice(base.length + 1) : null
  },
  downloadR2ObjectToFile: mocks.downloadR2ObjectToFile,
}))

const settings = vi.hoisted(() => ({ withheldGoPrivate: false }))
vi.mock("../../../lib/storage-deletes-setting.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage-deletes-setting.js")>()),
  withheldObjectsGoPrivate: () => settings.withheldGoPrivate,
}))

const { downloadFile, BIG_MEDIA_DOWNLOAD_LIMITS, isDownloadByteCapError } = await import("../ffmpeg-utils.js")

const BASE = "https://files.example.test"
const OWN = `${BASE}/tmp/provider-input/job-1/fitted-1.mp4`
const FOREIGN = "https://provider.example.org/out/result.mp4"
const ORIGINAL_BASE = process.env.R2_PUBLIC_URL

let dir = ""
let dest = ""
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.isStorageConfigured.mockReturnValue(true)
  mocks.downloadR2ObjectToFile.mockImplementation(async (_key: string, to: string) => { await fs.writeFile(to, "from-storage") })
  mocks.safeFetch.mockImplementation(async () => new Response("from-http"))
  process.env.R2_PUBLIC_URL = BASE
  dir = await fs.mkdtemp(join(tmpdir(), "download-own-storage-"))
  dest = join(dir, "out")
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })
afterAll(() => {
  if (ORIGINAL_BASE === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = ORIGINAL_BASE
})

const written = () => fs.readFile(dest, "utf8")
const storageError = (name: string, status?: number) =>
  Object.assign(new Error(name), { name, ...(status ? { $metadata: { httpStatusCode: status } } : {}) })

describe("downloadFile — our own stored files", () => {
  it("reads one of our files straight from storage, by its key, with no HTTP request", async () => {
    await downloadFile(OWN, dest)
    expect(mocks.downloadR2ObjectToFile).toHaveBeenCalledWith("tmp/provider-input/job-1/fitted-1.mp4", dest, { timeoutMs: expect.any(Number) })
    // Bounded by the default path's ceiling, like the link would be.
    const { timeoutMs } = mocks.downloadR2ObjectToFile.mock.calls[0]![2] as { timeoutMs: number }
    expect(timeoutMs).toBeGreaterThan(30 * 60_000 - 1_000)
    expect(timeoutMs).toBeLessThanOrEqual(30 * 60_000)
    expect(mocks.safeFetch).not.toHaveBeenCalled()
    expect(await written()).toBe("from-storage")
  })

  it("a foreign link goes over HTTP and never touches storage", async () => {
    await downloadFile(FOREIGN, dest)
    expect(mocks.safeFetch).toHaveBeenCalledOnce()
    expect(mocks.downloadR2ObjectToFile).not.toHaveBeenCalled()
    expect(await written()).toBe("from-http")
  })

  it("a lower ceilingMs bounds the storage read of our file too (the call's one deadline)", async () => {
    await downloadFile(OWN, dest, { ceilingMs: 8 * 60_000 })
    const { timeoutMs } = mocks.downloadR2ObjectToFile.mock.calls[0]![2] as { timeoutMs: number }
    expect(timeoutMs).toBeGreaterThan(8 * 60_000 - 1_000)
    expect(timeoutMs).toBeLessThanOrEqual(8 * 60_000)
  })

  it("onSource reaches the storage read of our file, and the link's headers when it goes over HTTP", async () => {
    const onSource = vi.fn()
    await downloadFile(OWN, dest, { onSource })
    expect(mocks.downloadR2ObjectToFile).toHaveBeenCalledWith("tmp/provider-input/job-1/fitted-1.mp4", dest, { timeoutMs: expect.any(Number), onSource })
    mocks.safeFetch.mockImplementationOnce(async () => new Response("from-http", { headers: { "content-type": "video/mp4", "content-length": "9" } }))
    const fromHttp = vi.fn()
    await downloadFile(FOREIGN, dest, { onSource: fromHttp })
    expect(fromHttp).toHaveBeenCalledWith({ contentType: "video/mp4", contentLength: 9 })
  })

  it("a storage read that fails for another reason than 'not found' falls back to HTTP", async () => {
    mocks.downloadR2ObjectToFile.mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))
    await downloadFile(OWN, dest)
    expect(mocks.downloadR2ObjectToFile).toHaveBeenCalledOnce()
    expect(mocks.safeFetch).toHaveBeenCalledOnce()
    expect(await written()).toBe("from-http")
  })

  it("a storage read that ended short of the object's size falls back to HTTP like any failed read", async () => {
    const { DownloadIncompleteError } = await import("../../../lib/download-incomplete.js")
    mocks.downloadR2ObjectToFile.mockRejectedValueOnce(new DownloadIncompleteError("short storage read"))
    await downloadFile(OWN, dest)
    expect(mocks.safeFetch).toHaveBeenCalledOnce()
    expect(await written()).toBe("from-http")
  })

  it("a storage refusal that is not about the file (a bucket it does not know) falls back to HTTP", async () => {
    mocks.downloadR2ObjectToFile.mockRejectedValueOnce(storageError("NoSuchBucket", 404))
    await downloadFile(OWN, dest)
    expect(mocks.safeFetch).toHaveBeenCalledOnce()
    expect(await written()).toBe("from-http")
  })

  it("an object storage does not have is an honest 404 — no HTTP retry", async () => {
    mocks.downloadR2ObjectToFile.mockRejectedValueOnce(storageError("NoSuchKey", 404))
    await expect(downloadFile(OWN, dest)).rejects.toThrow(`Failed to download: ${OWN} (404)`)
    expect(mocks.safeFetch).not.toHaveBeenCalled()
  })

  it("a byte-cap refusal from storage is final (the same on every attempt)", async () => {
    mocks.downloadR2ObjectToFile.mockRejectedValueOnce(new Error("Download exceeds 1 MB: r2 object k"))
    const err = await downloadFile(OWN, dest, { maxBytes: 1024 * 1024 }).catch((e: unknown) => e)
    expect(isDownloadByteCapError(err)).toBe(true)
    expect(mocks.downloadR2ObjectToFile.mock.calls[0]![2]).toMatchObject({ maxBytes: 1024 * 1024 })
    expect(mocks.safeFetch).not.toHaveBeenCalled()
  })

  it("an HTTP timeout of one of our files is retried once from storage", async () => {
    mocks.downloadR2ObjectToFile.mockRejectedValueOnce(new Error("Download timeout: too slow: r2 object k"))
    mocks.safeFetch.mockRejectedValueOnce(new Error(`Download timeout: longer than 120 s for its size (21 MB): ${OWN}`))
    await downloadFile(OWN, dest)
    expect(mocks.downloadR2ObjectToFile).toHaveBeenCalledTimes(2)
    expect(await written()).toBe("from-storage")
  })

  it("every attempt shares the call's one deadline: the retry gets only what is left", async () => {
    const limits = { ...BIG_MEDIA_DOWNLOAD_LIMITS, maxMs: 120_000 }
    mocks.downloadR2ObjectToFile.mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
    mocks.safeFetch.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 200))
      throw new Error(`Download timeout: no response within 15 s: ${OWN}`)
    })
    await downloadFile(OWN, dest, { limits })
    const [first, retry] = mocks.downloadR2ObjectToFile.mock.calls.map((c) => (c[2] as { timeoutMs: number }).timeoutMs)
    expect(first).toBeLessThanOrEqual(120_000)
    expect(retry).toBeLessThanOrEqual(first! - 190)
  })

  it("when the retry fails too, the HTTP timeout is what the caller sees", async () => {
    mocks.downloadR2ObjectToFile.mockRejectedValue(new Error("connect ECONNREFUSED"))
    mocks.safeFetch.mockRejectedValueOnce(new Error(`Download timeout: no response within 120 s: ${OWN}`))
    await expect(downloadFile(OWN, dest)).rejects.toThrow(/^Download timeout: no response within 120 s/)
    expect(mocks.downloadR2ObjectToFile).toHaveBeenCalledTimes(2)
  })

  it("an HTTP failure that is not a timeout is not retried from storage", async () => {
    mocks.downloadR2ObjectToFile.mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
    mocks.safeFetch.mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
    await expect(downloadFile(OWN, dest)).rejects.toThrow(`Failed to download: ${OWN} (502)`)
    expect(mocks.downloadR2ObjectToFile).toHaveBeenCalledOnce()
  })

  it("a caller on a budget hands the storage read its time, its signal and its cap", async () => {
    const stop = new AbortController()
    await downloadFile(OWN, dest, { timeoutMs: 40_000, signal: stop.signal, maxBytes: 2048 })
    const bounds = mocks.downloadR2ObjectToFile.mock.calls[0]![2] as { timeoutMs: number; signal: AbortSignal; maxBytes: number }
    expect(bounds.timeoutMs).toBeGreaterThan(39_000)
    expect(bounds.timeoutMs).toBeLessThanOrEqual(40_000)
    expect(bounds.signal).toBe(stop.signal)
    expect(bounds.maxBytes).toBe(2048)
  })

  it("a caller's abort during the storage read is final — no HTTP attempt after it", async () => {
    const stop = new AbortController()
    mocks.downloadR2ObjectToFile.mockImplementationOnce(async () => {
      stop.abort(new Error("client went away"))
      throw Object.assign(new Error("aborted"), { name: "AbortError" })
    })
    await expect(downloadFile(OWN, dest, { signal: stop.signal })).rejects.toThrow("aborted")
    expect(mocks.safeFetch).not.toHaveBeenCalled()
  })

  it("big-media downloads of our files read from storage under the caller's own limits and cap", async () => {
    await downloadFile(OWN, dest, { limits: BIG_MEDIA_DOWNLOAD_LIMITS, maxBytes: 4096 })
    expect(mocks.downloadR2ObjectToFile).toHaveBeenCalledWith("tmp/provider-input/job-1/fitted-1.mp4", dest, {
      maxBytes: 4096,
      limits: BIG_MEDIA_DOWNLOAD_LIMITS,
      timeoutMs: expect.any(Number),
    })
    // Within the caller's own overall ceiling, not a fresh one per attempt.
    expect((mocks.downloadR2ObjectToFile.mock.calls[0]![2] as { timeoutMs: number }).timeoutMs).toBeLessThanOrEqual(BIG_MEDIA_DOWNLOAD_LIMITS.maxMs)
    expect(mocks.safeFetch).not.toHaveBeenCalled()
  })

  it("a link that is not strictly ours (an escape, an edge transform) stays on HTTP", async () => {
    for (const url of [`${BASE}/tmp/a%2Db.mp4`, `${BASE}/cdn-cgi/image/width=100/tmp/a.png`]) {
      await downloadFile(url, dest)
    }
    expect(mocks.downloadR2ObjectToFile).not.toHaveBeenCalled()
    expect(mocks.safeFetch).toHaveBeenCalledTimes(2)
  })
})

describe("downloadFile — files whose public link is refused are never read from storage", () => {
  afterEach(() => { settings.withheldGoPrivate = false })

  it("a kept file (a restricted file's evidence bytes) goes over its link only, where the host refuses it", async () => {
    mocks.safeFetch.mockResolvedValueOnce(new Response("refused", { status: 403 }))
    await expect(downloadFile(`${BASE}/evidence/r-1/videos/job-1.mp4`, dest)).rejects.toThrow(/\(403\)/)
    expect(mocks.downloadR2ObjectToFile).not.toHaveBeenCalled()
  })

  it("and a 404 at the link does not fall back to storage for it either", async () => {
    mocks.safeFetch.mockResolvedValueOnce(new Response("gone", { status: 404 }))
    await expect(downloadFile(`${BASE}/evidence/r-1/videos/job-1.mp4`, dest)).rejects.toThrow(/\(404\)/)
    expect(mocks.downloadR2ObjectToFile).not.toHaveBeenCalled()
  })

  it("on a deployment that makes withheld results private, no link is read from storage — first or as a 404 fallback", async () => {
    settings.withheldGoPrivate = true
    mocks.safeFetch.mockResolvedValueOnce(new Response("private", { status: 403 }))
    await expect(downloadFile(OWN, dest)).rejects.toThrow(/\(403\)/)
    mocks.safeFetch.mockResolvedValueOnce(new Response("gone", { status: 404 }))
    await expect(downloadFile(OWN, dest)).rejects.toThrow(/\(404\)/)
    expect(mocks.downloadR2ObjectToFile).not.toHaveBeenCalled()
  })

  it("a 404 at the link after storage already failed for that key does not read storage a second time", async () => {
    mocks.downloadR2ObjectToFile.mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
    mocks.safeFetch.mockResolvedValueOnce(new Response("gone", { status: 404 }))
    await expect(downloadFile(OWN, dest)).rejects.toThrow(`Failed to download: ${OWN} (404)`)
    expect(mocks.downloadR2ObjectToFile).toHaveBeenCalledOnce()
  })
})

describe("downloadFile — what it says when it runs long", () => {
  afterEach(() => { vi.useRealTimers() })

  it("a download over 120 s is logged: how long, how much, how fast, which way — the link without its query", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mocks.downloadR2ObjectToFile.mockImplementationOnce(async (_k: string, to: string) => {
      await fs.writeFile(to, Buffer.alloc(2048))
      vi.setSystemTime(Date.now() + 130_000)
    })
    await downloadFile(`${OWN}`, dest)
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("slow download"))
    expect(line).toMatch(/slow download finished: https:\/\/files\.example\.test\/tmp\/provider-input\/job-1\/fitted-1\.mp4 — 130 s, 2048 bytes, 0 kB\/s average, via storage$/)
    warn.mockRestore()
  })

  it("a signed link's query never reaches the log", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mocks.safeFetch.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 125_000)
      return new Response("x")
    })
    await downloadFile("https://provider.example.org/out.mp4?X-Signature=secret", dest)
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("slow download"))!
    expect(line).toContain("https://provider.example.org/out.mp4 —")
    expect(line).not.toContain("secret")
    expect(line).toMatch(/via http$/)
    warn.mockRestore()
  })

  it("big media: when a failed storage read used part of the ceiling, the timeout says so", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const limits = { ...BIG_MEDIA_DOWNLOAD_LIMITS, maxMs: 3_000 }
    let first = true
    mocks.downloadR2ObjectToFile.mockImplementation(async () => {
      if (first) vi.setSystemTime(Date.now() + 2_600)
      first = false
      throw new Error("connect ECONNREFUSED")
    })
    mocks.safeFetch.mockImplementationOnce((_u: string, init: { signal: AbortSignal }) => new Promise((_r, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason))
    }))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(downloadFile(OWN, dest, { limits })).rejects.toThrow(/over its 3 s overall ceiling, 3 s of it spent first on a storage read that failed/)
  })
})

describe("downloadFile — an install without storage is unchanged", () => {
  it("storage not configured: our public link goes over HTTP only", async () => {
    mocks.isStorageConfigured.mockReturnValue(false)
    await downloadFile(OWN, dest)
    expect(mocks.downloadR2ObjectToFile).not.toHaveBeenCalled()
    expect(mocks.safeFetch).toHaveBeenCalledOnce()
    expect(await written()).toBe("from-http")
  })

  it("no public base configured: nothing is ours, and storage is never asked", async () => {
    delete process.env.R2_PUBLIC_URL
    await downloadFile(OWN, dest)
    expect(mocks.isStorageConfigured).not.toHaveBeenCalled()
    expect(mocks.downloadR2ObjectToFile).not.toHaveBeenCalled()
    expect(mocks.safeFetch).toHaveBeenCalledOnce()
  })
})
