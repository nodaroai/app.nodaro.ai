/**
 * Trim, Loop and Combine Videos measure each clip before they are priced. On a
 * self-host, this install's own storage sits behind the app's origin on a
 * loopback or private address, which the probe's link guard refuses while the
 * render downloads it (`safeFetch` exempts that subtree): such a file — and
 * only such a file, strictly in the subtree — is downloaded (at most 2 GiB)
 * and probed on disk. A link the guard allows is probed where it is and never
 * downloaded to be measured, even when its probe fails (Cloud's public
 * storage); a link outside the subtree that the guard refuses stays refused.
 * Only a refusal of the ADDRESS opens the download: a host whose DNS lookup
 * fails is a retryable refusal, never a download (on Cloud the storage host is
 * public, and a DNS blip must not turn into a 2 GiB download on the API).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"

const m = vi.hoisted(() => ({
  ProbeSourceBlockedError: class ProbeSourceBlockedError extends Error {
    constructor(readonly reason: "address" | "host" | "dns" | "link", message: string) {
      super(message)
    }
  },
  assertSafeProbeSource: vi.fn(async (_src: string) => undefined),
  probeVideoSource: vi.fn(async (_src: string) => ({ width: 640, height: 360, durationSeconds: 12 })),
  downloadFile: vi.fn(async (_url: string, _dest: string, _opts?: { maxBytes?: number; timeoutMs?: number; signal?: AbortSignal }) => undefined),
  createWorkDir: vi.fn(async (_name: string) => "/tmp/measure"),
  cleanupWorkDir: vi.fn(async (_dir: string) => undefined),
}))
vi.mock("../../providers/video/ffmpeg-utils.js", () => m)
// The one clip reading both sides measure by (lib/video-utility-probe.ts), driven by the probe above.
vi.mock("../video-utility-probe.js", () => ({
  probeClipLengthSec: vi.fn(async (src: string, _opts?: Record<string, unknown>) => (await m.probeVideoSource(src)).durationSeconds),
  ClipUnreadableError: class ClipUnreadableError extends Error {},
}))

import { OWN_STORAGE_MEASURE_MAX_BYTES, measureVideoUtilityCharge } from "../video-utility-length.js"

const SELF_HOST = "http://localhost:3000/storage/nodaro-assets"
const CLOUD = "https://media.example.com"
const OWN = `${SELF_HOST}/videos/clip.mp4`
const PUBLIC = "https://cdn.example/clip.mp4"
const PRIVATE = "http://127.0.0.1:9000/other/clip.mp4"
const blocked = (src: string) => src.startsWith("http://localhost") || src.startsWith("http://127.")
const trim = (videoUrl: string) => ({ videoUrl, trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0 })
const UNREADABLE = { ok: false, code: "invalid_video_duration", message: "Could not read the video. The file may be corrupted or an unsupported format." }
const savedStorage = process.env.R2_PUBLIC_URL

beforeEach(() => {
  vi.clearAllMocks()
  process.env.R2_PUBLIC_URL = SELF_HOST
  // The probe's link guard refuses loopback and private addresses; a local path it reads.
  m.assertSafeProbeSource.mockImplementation(async (src: string) => {
    if (blocked(src)) throw new m.ProbeSourceBlockedError("address", `probeVideoSource: blocked private/reserved IP for ${src}`)
  })
  m.probeVideoSource.mockImplementation(async () => ({ width: 640, height: 360, durationSeconds: 12 }))
})

afterAll(() => {
  if (savedStorage === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = savedStorage
})

describe("measuring a clip in this install's own storage (a self-host)", () => {
  it("a file the guard refuses inside the own-storage subtree is downloaded (capped at 2 GiB) and measured on disk (12 s → 3 units)", async () => {
    await expect(measureVideoUtilityCharge("trim-video", trim(OWN))).resolves.toEqual({ ok: true, secs: [12], units: 3 })
    expect(OWN_STORAGE_MEASURE_MAX_BYTES).toBe(2 * 1024 ** 3)
    // No client waiting (a workflow, a pipeline): the render's own download bound.
    // (Its signal is the measure's own stop: a failing sibling clip.)
    expect(m.downloadFile).toHaveBeenCalledWith(OWN, "/tmp/measure/input", { maxBytes: OWN_STORAGE_MEASURE_MAX_BYTES, timeoutMs: 120_000, signal: expect.any(AbortSignal) })
    expect(m.probeVideoSource).toHaveBeenLastCalledWith("/tmp/measure/input")
    expect(m.cleanupWorkDir).toHaveBeenCalledWith("/tmp/measure")
  })

  it("on a route, the download gets what is left of the request's deadline, and stops with its client", async () => {
    const gone = new AbortController()
    await measureVideoUtilityCharge("trim-video", trim(OWN), { deadlineAt: Date.now() + 40_000, signal: gone.signal })
    const opts = m.downloadFile.mock.calls[0]![2]!
    expect(opts.timeoutMs).toBeGreaterThan(39_000)
    expect(opts.timeoutMs).toBeLessThanOrEqual(40_000)
    // Its signal follows the client's: the client going away stops it.
    expect(opts.signal?.aborted).toBe(false)
    gone.abort()
    expect(opts.signal?.aborted).toBe(true)
  })

  it("a deadline spent while the guard looked the host up is out of time before the download: 503 probe_timeout, nothing downloaded", async () => {
    const realNow = Date.now()
    let now = realNow
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now)
    m.assertSafeProbeSource.mockImplementation(async (src: string) => {
      now += 5_000 // the lookup outlasts the deadline
      if (blocked(src)) throw new m.ProbeSourceBlockedError("address", `probeVideoSource: blocked private/reserved IP for ${src}`)
    })
    try {
      await expect(measureVideoUtilityCharge("trim-video", trim(OWN), { deadlineAt: realNow + 1_000 })).resolves.toEqual({
        ok: false,
        code: "probe_timeout",
        message: "Timed out reading the video — run it again.",
      })
      expect(m.downloadFile).not.toHaveBeenCalled()
    } finally {
      clock.mockRestore()
    }
  })

  it("the first clip to fail stops the reads beside it, and the answer is that clip's own failure", async () => {
    const { probeClipLengthSec } = await import("../video-utility-probe.js")
    let stoppedSibling: AbortSignal | undefined
    vi.mocked(probeClipLengthSec).mockImplementation(async (src, opts) => {
      const signal = opts?.signal
      if (src.endsWith("/a.mp4")) {
        // A long read that only ends when it is stopped.
        stoppedSibling = signal
        return new Promise<number>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("ffprobe killed"))))
      }
      throw new Error("probeVideoSource failed to parse")
    })
    try {
      const measured = await measureVideoUtilityCharge("combine-videos", { videoUrls: ["https://cdn.example/a.mp4", "https://cdn.example/b.mp4"] })
      expect(measured).toEqual({ ok: false, code: "invalid_video_duration", message: "Could not read clip 2 of 2. The file may be corrupted or an unsupported format." })
      expect(stoppedSibling?.aborted).toBe(true)
    } finally {
      vi.mocked(probeClipLengthSec).mockImplementation(async (src: string) => (await m.probeVideoSource(src)).durationSeconds)
    }
  })

  it("a clip still in its guard lookup is stopped by a sibling's failure: the sibling's refusal comes at once", async () => {
    const HANGS = "https://hangs.example/a.mp4"
    const CORRUPT = "https://cdn.example/b.mp4"
    m.assertSafeProbeSource.mockImplementation((src: string) => (src === HANGS ? new Promise<undefined>(() => undefined) : Promise.resolve(undefined)))
    m.probeVideoSource.mockImplementation(async (src: string) => {
      if (src === CORRUPT) throw new Error("Invalid data found when processing input")
      return { width: 640, height: 360, durationSeconds: 12 }
    })
    const started = Date.now()
    const measured = await measureVideoUtilityCharge("combine-videos", { videoUrls: [HANGS, CORRUPT] }, { deadlineAt: Date.now() + 10_000 })
    expect(measured).toEqual({ ok: false, code: "invalid_video_duration", message: "Could not read clip 2 of 2. The file may be corrupted or an unsupported format." })
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it("a guard lookup that hangs past the deadline is answered in time as out of time", async () => {
    m.assertSafeProbeSource.mockImplementation(() => new Promise(() => undefined))
    await expect(measureVideoUtilityCharge("trim-video", trim(PUBLIC), { deadlineAt: Date.now() + 50 })).resolves.toMatchObject({ ok: false, code: "probe_timeout" })
    expect(m.probeVideoSource).not.toHaveBeenCalled()
  })

  it("an own-storage read stopped by its timeout (an AbortError caused by a TimeoutError, as a storage read rejects) is out of time, retryable", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })
    m.downloadFile.mockRejectedValueOnce(Object.assign(new Error("The operation was aborted"), { name: "AbortError", cause: timeout }))
    await expect(measureVideoUtilityCharge("trim-video", trim(OWN))).resolves.toMatchObject({ ok: false, code: "probe_timeout" })
    expect(m.cleanupWorkDir).toHaveBeenCalledWith("/tmp/measure")
  })

  it("an abort for any other reason is not out of time: unreadable", async () => {
    m.downloadFile.mockRejectedValueOnce(Object.assign(new Error("The operation was aborted"), { name: "AbortError", cause: new Error("closed") }))
    await expect(measureVideoUtilityCharge("trim-video", trim(OWN))).resolves.toEqual(UNREADABLE)
  })

  it("a file over the cap is refused as unreadable, its copy cleaned up", async () => {
    m.downloadFile.mockRejectedValueOnce(new Error("Download exceeds 2048 MB"))
    await expect(measureVideoUtilityCharge("trim-video", trim(OWN))).resolves.toEqual(UNREADABLE)
    expect(m.cleanupWorkDir).toHaveBeenCalledWith("/tmp/measure")
  })

  it("a private address outside the subtree is refused, with nothing downloaded", async () => {
    await expect(measureVideoUtilityCharge("trim-video", trim(PRIVATE))).resolves.toEqual(UNREADABLE)
    expect(m.downloadFile).not.toHaveBeenCalled()
  })

  it.each([
    ["an escaped slash", `${SELF_HOST}/..%2f..%2fadmin/clip.mp4`],
    ["an escaped backslash", `${SELF_HOST}/videos%5c..%5cclip.mp4`],
    ["a dot segment", `${SELF_HOST}/../other/clip.mp4`],
    ["a sibling prefix", `${SELF_HOST}-evil/clip.mp4`],
  ])("%s is not strictly in the subtree: refused, never downloaded", async (_label, url) => {
    await expect(measureVideoUtilityCharge("trim-video", trim(url))).resolves.toEqual(UNREADABLE)
    expect(m.downloadFile).not.toHaveBeenCalled()
  })

  it("an own-storage file that is not a readable video is refused, and its copy cleaned up", async () => {
    m.probeVideoSource.mockImplementation(async () => {
      throw new Error("probeVideoSource failed to parse")
    })
    const measured = await measureVideoUtilityCharge("combine-videos", { videoUrls: [PUBLIC, OWN] })
    expect(measured).toEqual({ ok: false, code: "invalid_video_duration", message: "Could not read clip 1 of 2. The file may be corrupted or an unsupported format." })
    expect(m.cleanupWorkDir).toHaveBeenCalled()
  })
})

describe("a link the guard allows is probed where it is, never downloaded", () => {
  it("a public link (12 s ×2 → 5 units)", async () => {
    await expect(measureVideoUtilityCharge("loop-video", { videoUrl: PUBLIC, mode: "repeat", repeatCount: 2 })).resolves.toEqual({ ok: true, secs: [12], units: 5 })
    expect(m.downloadFile).not.toHaveBeenCalled()
  })

  it("the link is checked once: the probe is told it was (no second DNS lookup)", async () => {
    const { probeClipLengthSec } = await import("../video-utility-probe.js")
    await measureVideoUtilityCharge("trim-video", trim(PUBLIC))
    expect(m.assertSafeProbeSource).toHaveBeenCalledTimes(1)
    expect(probeClipLengthSec).toHaveBeenCalledWith(PUBLIC, expect.objectContaining({ sourceChecked: true }))
  })

  it("Cloud: a DNS failure on the storage host is retryable (503 source_unreachable) and never downloads", async () => {
    process.env.R2_PUBLIC_URL = CLOUD
    m.assertSafeProbeSource.mockRejectedValue(new m.ProbeSourceBlockedError("dns", "probeVideoSource: blocked — DNS resolution failed for media.example.com"))
    await expect(measureVideoUtilityCharge("trim-video", trim(`${CLOUD}/videos/clip.mp4`))).resolves.toEqual({
      ok: false,
      code: "source_unreachable",
      message: "Could not reach the video — run it again.",
    })
    expect(m.downloadFile).not.toHaveBeenCalled()
  })

  it("a host that does not exist (a typo) is refused for good, saying so: 400, not a retryable 503, no download", async () => {
    m.assertSafeProbeSource.mockRejectedValue(new m.ProbeSourceBlockedError("host", "probeVideoSource: blocked — DNS resolution failed for cdn.exmaple.com"))
    await expect(measureVideoUtilityCharge("trim-video", trim("https://cdn.exmaple.com/a.mp4"))).resolves.toEqual({
      ok: false,
      code: "invalid_video_duration",
      message: "Could not read the video: its host was not found. Check the link.",
    })
    expect(m.downloadFile).not.toHaveBeenCalled()
  })

  it("ffprobe's own lookup failing right after the guard resolved the host is retryable (503 source_unreachable)", async () => {
    m.probeVideoSource.mockRejectedValue(new Error("ffprobe failed: [tcp @ 0x1] Failed to resolve hostname cdn.example: Temporary failure in name resolution"))
    await expect(measureVideoUtilityCharge("trim-video", trim(PUBLIC))).resolves.toMatchObject({ ok: false, code: "source_unreachable" })
  })

  it("a lookup failure on another host (a redirect target the guard never resolved) is not retryable: unreadable", async () => {
    m.probeVideoSource.mockRejectedValue(new Error("ffprobe failed: [tcp @ 0x1] Failed to resolve hostname dead.example: Temporary failure in name resolution"))
    await expect(measureVideoUtilityCharge("trim-video", trim(PUBLIC))).resolves.toEqual(UNREADABLE)
  })

  it("a self-host's own storage whose DNS fails is retryable too, not downloaded", async () => {
    m.assertSafeProbeSource.mockRejectedValue(new m.ProbeSourceBlockedError("dns", "probeVideoSource: blocked — DNS resolution failed for localhost"))
    await expect(measureVideoUtilityCharge("trim-video", trim(OWN))).resolves.toMatchObject({ ok: false, code: "source_unreachable" })
    expect(m.downloadFile).not.toHaveBeenCalled()
  })

  it("Cloud: storage on a public origin is 'own storage' too, and an unreadable file there is refused with no download", async () => {
    process.env.R2_PUBLIC_URL = CLOUD
    m.probeVideoSource.mockRejectedValue(new Error("probeVideoSource failed to parse"))
    await expect(measureVideoUtilityCharge("trim-video", trim(`${CLOUD}/videos/broken.mp4`))).resolves.toEqual(UNREADABLE)
    expect(m.downloadFile).not.toHaveBeenCalled()
  })
})
