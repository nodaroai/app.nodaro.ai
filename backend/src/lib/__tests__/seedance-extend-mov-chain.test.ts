import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// ---------------------------------------------------------------------------
// Finding the PREVIOUS extension's raw mov, so a chained extend references it
// in its own container, pixel format and sound (the whole point of asking
// Seedance 2.5 for mov at all), and cutting that reference down to the clip's
// last seconds.
//
// Every failure mode of the lookup must be SILENT: a missing job, a foreign
// URL, a job belonging to someone else, an mp4 raw extension, a KIE temp URL
// — all fall back to the 2s tail, which is the transport that works today.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  downloadFile: vi.fn(),
  runFfmpeg: vi.fn(),
  runFfprobe: vi.fn(),
  getVideoStreamDuration: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.from } }))

// The real config (the ffmpeg runner's admission reads it), with our R2 origin.
vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config.js")>()
  return {
    ...actual,
    config: { ...actual.config, R2_PUBLIC_URL: "https://r2.test.com", R2_BUCKET_NAME: "b" },
    hasCredits: () => true,
  }
})

// Spies over the real ffmpeg helpers: each test chooses canned answers or the real binaries.
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()
  return {
    ...actual,
    downloadFile: mocks.downloadFile,
    runFfmpeg: mocks.runFfmpeg,
    runFfprobe: mocks.runFfprobe,
    getVideoStreamDuration: mocks.getVideoStreamDuration,
  }
})

import { cutChainedMovTail, findChainedMovReference, isMovUrl } from "@/lib/seedance-extend-mov-chain.js"

const actualFfmpeg = await vi.importActual<typeof import("@/providers/video/ffmpeg-utils.js")>("@/providers/video/ffmpeg-utils.js")

const JOB_ID = "11111111-2222-3333-4444-555555555555"
const SOURCE = `https://r2.test.com/videos/${JOB_ID}.mp4`
const OUR_MOV = "https://r2.test.com/videos/abc-raw.mov"

function stubJob(outputData: unknown) {
  mocks.maybeSingle.mockResolvedValue({ data: outputData === null ? null : { output_data: outputData }, error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.eq.mockImplementation(() => ({ eq: mocks.eq, maybeSingle: mocks.maybeSingle }))
  mocks.select.mockImplementation(() => ({ eq: mocks.eq }))
  mocks.from.mockImplementation(() => ({ select: mocks.select }))
  stubJob({})
})

describe("isMovUrl", () => {
  it("is decided by the PATH, not the query string", () => {
    expect(isMovUrl("https://x.example/a.mov")).toBe(true)
    expect(isMovUrl("https://x.example/a.mov?token=abc&x=.mp4")).toBe(true)
    expect(isMovUrl("https://x.example/a.MOV")).toBe(true)
    expect(isMovUrl("https://x.example/a.mp4")).toBe(false)
    expect(isMovUrl("https://x.example/a.mp4?f=.mov")).toBe(false)
    expect(isMovUrl("not a url")).toBe(false)
    expect(isMovUrl("")).toBe(false)
  })
})

describe("findChainedMovReference", () => {
  it("returns the prior job's raw mov when it is one of OUR durable objects", async () => {
    stubJob({ rawExtensionUrl: OUR_MOV })
    await expect(findChainedMovReference(SOURCE, "user-1")).resolves.toBe(OUR_MOV)
    expect(mocks.from).toHaveBeenCalledWith("jobs")
    // Scoped to the caller: never chain off someone else's job row.
    expect(mocks.eq).toHaveBeenCalledWith("id", JOB_ID)
    expect(mocks.eq).toHaveBeenCalledWith("user_id", "user-1")
  })

  it("a foreign source URL is not looked up at all", async () => {
    await expect(findChainedMovReference("https://cdn.elsewhere.com/x.mp4", "user-1")).resolves.toBeUndefined()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("an R2 URL that is not a job-keyed video is not looked up", async () => {
    await expect(findChainedMovReference("https://r2.test.com/uploads/x.mp4", "user-1")).resolves.toBeUndefined()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("no such job ⇒ undefined", async () => {
    stubJob(null)
    await expect(findChainedMovReference(SOURCE, "user-1")).resolves.toBeUndefined()
  })

  it("an mp4 raw extension ⇒ undefined (nothing to gain)", async () => {
    stubJob({ rawExtensionUrl: "https://r2.test.com/videos/abc-raw.mp4" })
    await expect(findChainedMovReference(SOURCE, "user-1")).resolves.toBeUndefined()
  })

  it("a KIE temp URL ⇒ undefined — it will have expired", async () => {
    stubJob({ rawExtensionUrl: "https://kie.example.com/extension.mov" })
    await expect(findChainedMovReference(SOURCE, "user-1")).resolves.toBeUndefined()
  })

  it("a non-string / absent rawExtensionUrl ⇒ undefined", async () => {
    stubJob({ rawExtensionUrl: 42 })
    await expect(findChainedMovReference(SOURCE, "user-1")).resolves.toBeUndefined()
    stubJob({ thumbnailUrl: "x" })
    await expect(findChainedMovReference(SOURCE, "user-1")).resolves.toBeUndefined()
  })

  it("a source whose expiry blanked its raw clip ⇒ undefined, so the extend uses the tail", async () => {
    stubJob({ videoUrl: null, rawExtensionUrl: null, _cleaned: true })
    await expect(findChainedMovReference(SOURCE, "user-1")).resolves.toBeUndefined()
  })

  it("no user id ⇒ undefined, and no unscoped query is ever issued", async () => {
    stubJob({ rawExtensionUrl: OUR_MOV })
    await expect(findChainedMovReference(SOURCE, undefined)).resolves.toBeUndefined()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("a DB error is swallowed — the tail path still works", async () => {
    mocks.maybeSingle.mockRejectedValue(new Error("connection reset"))
    await expect(findChainedMovReference(SOURCE, "user-1")).resolves.toBeUndefined()
  })
})

describe("cutChainedMovTail", () => {
  const MOV_URL = "https://r2.test.com/videos/abc-raw.mov"
  /** ffprobe's answer for a Seedance 2.5 raw mov: 4:4:4 H.264 + PCM in QuickTime. */
  const PROBE_JSON = JSON.stringify({
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1280, height: 720, pix_fmt: "yuv444p", bit_rate: "12000000", color_space: "bt709", color_primaries: "bt709", color_transfer: "bt709", color_range: "tv" },
      { codec_type: "audio", codec_name: "pcm_s16le", bit_rate: "1536000" },
    ],
    format: { bit_rate: "13600000", duration: "10.100000", tags: { major_brand: "qt  " } },
  })
  const pair = (args: string[], flag: string) => args.slice(args.indexOf(flag), args.indexOf(flag) + 2)

  beforeEach(() => {
    mocks.downloadFile.mockResolvedValue(undefined)
    mocks.runFfmpeg.mockResolvedValue("")
    mocks.runFfprobe.mockResolvedValue(PROBE_JSON)
    // The picture ends before the container (the sound runs 60 ms past it).
    mocks.getVideoStreamDuration.mockResolvedValue(10.04)
  })

  it("cutChainedMovTail keeps a MOV, its pixel format and PCM, and its last 2 s", async () => {
    const out = await cutChainedMovTail(MOV_URL, 2, "/tmp/wd")

    expect(out.endsWith(".mov")).toBe(true)
    expect(out.startsWith("/tmp/wd/")).toBe(true)
    // Downloaded into the work dir and measured there, never over the network.
    expect(mocks.downloadFile).toHaveBeenCalledWith(MOV_URL, expect.stringMatching(/^\/tmp\/wd\//))
    const local = mocks.downloadFile.mock.calls[0]![1] as string
    expect(mocks.getVideoStreamDuration).toHaveBeenCalledWith(local)

    // Two passes at the source's own picture bitrate.
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2)
    const [pass1, pass2] = mocks.runFfmpeg.mock.calls.map((c) => c[0] as string[])
    for (const args of [pass1!, pass2!]) {
      // From the PICTURE's end (10.04 − 2), not the container's (10.1 − 2).
      expect(pair(args, "-ss")).toEqual(["-ss", "8.040"])
      expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"))
      expect(pair(args, "-t")).toEqual(["-t", "2"])
      expect(pair(args, "-pix_fmt")).toEqual(["-pix_fmt", "yuv444p"])
      expect(pair(args, "-b:v")).toEqual(["-b:v", "12000000"])
      expect(pair(args, "-colorspace")).toEqual(["-colorspace", "bt709"])
      expect(args).not.toContain("-crf")
    }
    expect(pass1).toContain("-an")
    expect(pair(pass1!, "-pass")).toEqual(["-pass", "1"])
    expect(pair(pass2!, "-pass")).toEqual(["-pass", "2"])
    expect(pair(pass2!, "-c:a")).toEqual(["-c:a", "copy"])
    // A copied sound starts at the cut, not at the keyframe before it.
    expect(pair(pass2!, "-copypriorss")).toEqual(["-copypriorss", "0"])
    expect(pass2![pass2!.length - 1]).toBe(out)
    // Admitted at the clip's own size.
    expect(mocks.runFfmpeg.mock.calls[1]![2]).toEqual({ peakMemoryMiB: expect.any(Number) })
  })

  it("a picture shorter than the cut is sent whole", async () => {
    mocks.getVideoStreamDuration.mockResolvedValue(1.5)
    await cutChainedMovTail(MOV_URL, 2, "/tmp/wd")
    expect(pair(mocks.runFfmpeg.mock.calls[1]![0] as string[], "-ss")).toEqual(["-ss", "0.000"])
  })

  it("an unreadable bitrate falls back to the visually lossless constant quality, in one pass", async () => {
    mocks.runFfprobe.mockResolvedValue(JSON.stringify({
      streams: [{ codec_type: "video", pix_fmt: "yuv444p" }, { codec_type: "audio", codec_name: "pcm_s16le" }],
      format: { duration: "10.1", tags: { major_brand: "qt  " } },
    }))
    await cutChainedMovTail(MOV_URL, 2, "/tmp/wd")
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(1)
    const args = mocks.runFfmpeg.mock.calls[0]![0] as string[]
    expect(pair(args, "-crf")).toEqual(["-crf", "14"])
    expect(args).not.toContain("-pass")
  })
})

function isFfmpegAvailable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!isFfmpegAvailable())("cutChainedMovTail (real ffmpeg)", () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "chain-mov-cut-"))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  beforeEach(() => {
    mocks.downloadFile.mockImplementation((src: string, dest: string) => copyFile(src, dest))
    mocks.runFfmpeg.mockImplementation(actualFfmpeg.runFfmpeg)
    mocks.runFfprobe.mockImplementation(actualFfmpeg.runFfprobe)
    mocks.getVideoStreamDuration.mockImplementation(actualFfmpeg.getVideoStreamDuration)
  })

  it("the cut is a 2 s 4:4:4 + PCM MOV whose sound starts with its picture", async () => {
    // A 6.5 s picture with a keyframe every 2 s (so the cut at 4.5 s seeks
    // into a GOP) and 7 s of PCM running past it.
    const src = join(dir, "raw.mov")
    await actualFfmpeg.runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc=duration=6.5:size=320x240:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=7:sample_rate=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv444p", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
      "-c:a", "pcm_s16le",
      src,
    ])
    const workDir = await mkdtemp(join(dir, "wd-"))

    const out = await cutChainedMovTail(src, 2, workDir)

    expect(out.endsWith(".mov")).toBe(true)
    const probe = JSON.parse(await actualFfmpeg.runFfprobe([
      "-v", "error",
      "-show_entries", "stream=codec_type,codec_name,pix_fmt,nb_frames:format_tags=major_brand",
      "-of", "json", out,
    ])) as { streams: Array<Record<string, string>>; format: { tags: { major_brand: string } } }
    const v = probe.streams.find((s) => s.codec_type === "video")!
    const a = probe.streams.find((s) => s.codec_type === "audio")!
    expect(probe.format.tags.major_brand.trim()).toBe("qt")
    expect(v.pix_fmt).toBe("yuv444p")
    // The picture's last 2 s: 48 frames at 24 fps.
    expect(Number(v.nb_frames)).toBe(48)
    expect(a.codec_name).toBe("pcm_s16le")
    // About 2 s of samples (96 000 at 48 kHz), without the keyframe's pre-roll on top.
    expect(Number(a.nb_frames)).toBeGreaterThan(48_000 * 1.95)
    expect(Number(a.nb_frames)).toBeLessThan(48_000 * 2.05)
    const firstAudioPts = await actualFfmpeg.runFfprobe([
      "-v", "error", "-select_streams", "a:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0",
      "-read_intervals", "%+#1", out,
    ])
    expect(Number(firstAudioPts.trim().split("\n")[0]?.replace(/,$/, ""))).toBeGreaterThanOrEqual(0)
  }, 60_000)
})
