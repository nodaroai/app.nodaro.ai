/**
 * POST /v1/video-scene-cuts (routes/video-scene-cuts.ts): internal only — the
 * plugin's worker-side child request (`tk.http.workerRequest` with a parent
 * job) is the one caller it serves; every other caller is refused before
 * anything is downloaded. Free and synchronous: the clip's cuts in seconds
 * from its first frame, measured with real ffmpeg here.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } },
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

/** The address → local file the stand-in download copies (no network). */
const files = new Map<string, string>()
const download = vi.fn(async (url: string, dest: string, _opts?: { maxBytes?: number }) => {
  const from = files.get(url)
  if (!from) throw new Error(`HTTP 404: ${url}`)
  await copyFile(from, dest)
})
/** The probe as it runs (real ffprobe), or a stand-in answer for one test. */
const probeArgs: string[][] = []
let probeAnswer: string | null = null
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()
  return {
    ...real,
    downloadFile: (url: string, dest: string, opts?: { maxBytes?: number }) => download(url, dest, opts),
    runFfprobe: (args: readonly string[]) => (probeArgs.push([...args]), probeAnswer !== null ? Promise.resolve(probeAnswer) : real.runFfprobe(args)),
  }
})

import { videoSceneCutsRoutes, SCENE_CUTS_INPUT_ARGS, SCENE_CUTS_MAX_BYTES } from "../video-scene-cuts.js"
import { withJobSubmissionContext } from "../../lib/job-submission-context.js"

const USER = "00000000-0000-4000-8000-000000000001"
const PARENT = "00000000-0000-4000-8000-0000000000aa"
const THREE_SHOTS = "https://example.com/three.mp4"
const ONE_SHOT = "https://example.com/one.mp4"
const NOT_A_VIDEO = "https://example.com/notes.mp4"
const TOO_LONG = "https://example.com/long.mp4"
let app: FastifyInstance
let dir: string

/** A clip of `inputs` (lavfi sources) one after another, 24 fps. */
function clip(path: string, inputs: string[]): void {
  execFileSync("ffmpeg", [
    "-v", "error", "-y", ...inputs.flatMap((i) => ["-f", "lavfi", "-i", i]),
    "-filter_complex", `${inputs.map((_, k) => `[${k}]`).join("")}concat=n=${inputs.length}:v=1`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", path,
  ])
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "video-scene-cuts-"))
  // Red 1 s, blue 1.5 s, green 1 s: cuts at 1 s and 2.5 s, 3.5 s long.
  clip(join(dir, "three.mp4"), ["color=red:s=160x90:r=24:d=1", "color=blue:s=160x90:r=24:d=1.5", "color=green:s=160x90:r=24:d=1"])
  clip(join(dir, "one.mp4"), ["color=red:s=160x90:r=24:d=2"])
  execFileSync("sh", ["-c", `printf 'not a video' > "${join(dir, "notes.mp4")}"`])
  // 301 s at one tiny frame a second: past the 300 s limit, quick to make.
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=red:s=16x16:r=1:d=301", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(dir, "long.mp4")])
  files.set(TOO_LONG, join(dir, "long.mp4"))
  files.set(THREE_SHOTS, join(dir, "three.mp4"))
  files.set(ONE_SHOT, join(dir, "one.mp4"))
  files.set(NOT_A_VIDEO, join(dir, "notes.mp4"))
}, 60_000)

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  download.mockClear()
  probeArgs.length = 0
  probeAnswer = null
  app = Fastify({ logger: false })
  // A stand-in for the auth hook: the credential kind the test names, as the user it names.
  app.addHook("preHandler", async (req) => {
    const kind = req.headers["x-test-auth"]
    if (typeof kind === "string") {
      req.userId = USER
      req.authKind = kind as never
    }
  })
  await app.register(async (i) => { await videoSceneCutsRoutes(i) })
  await app.ready()
})

afterEach(async () => { await app.close() })

const post = (payload: Record<string, unknown>, auth: string) =>
  app.inject({ method: "POST", url: "/v1/video-scene-cuts", payload, headers: { "x-test-auth": auth } })
/** As the plugin's `tk.http.workerRequest` reaches it: internal, with a parent job in the server-only scope. */
const asChild = (payload: Record<string, unknown>) =>
  withJobSubmissionContext({ userId: USER, method: "POST", url: "/v1/video-scene-cuts", parentJobId: PARENT, trustedPluginCaller: true }, () =>
    post(payload, "internal"),
  )

describe("POST /v1/video-scene-cuts — who may call it", () => {
  it.each(["jwt", "api_token", "app_token", "billing_key"])("refuses a %s caller 403, before downloading anything", async (kind) => {
    const res = await post({ videoUrl: THREE_SHOTS }, kind)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(download).not.toHaveBeenCalled()
  })

  it("refuses a bare internal call, and a trusted plugin request with no parent job", async () => {
    expect((await post({ videoUrl: THREE_SHOTS }, "internal")).statusCode).toBe(403)
    const res = await withJobSubmissionContext({ userId: USER, method: "POST", url: "/v1/video-scene-cuts", trustedPluginCaller: true }, () =>
      post({ videoUrl: THREE_SHOTS }, "internal"),
    )
    expect(res.statusCode).toBe(403)
    expect(download).not.toHaveBeenCalled()
  })

  it("refuses an anonymous caller", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/video-scene-cuts", payload: { videoUrl: THREE_SHOTS } })).statusCode).toBe(403)
  })
})

describe("POST /v1/video-scene-cuts — a child step (real ffmpeg)", () => {
  it("answers the cuts of a three-shot clip in seconds from its first frame, and its length, within a frame", async () => {
    const res = await asChild({ videoUrl: THREE_SHOTS })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { cutsSec: number[]; durationSec: number }
    expect(Object.keys(body).sort()).toEqual(["cutsSec", "durationSec"])
    expect(body.cutsSec).toHaveLength(2)
    expect(body.cutsSec[0]).toBeCloseTo(1, 1)
    expect(body.cutsSec[1]).toBeCloseTo(2.5, 1)
    expect(Math.abs(body.durationSec - 3.5)).toBeLessThanOrEqual(1 / 24 + 1e-6)
    // The download is capped.
    expect(download).toHaveBeenCalledWith(THREE_SHOTS, expect.any(String), { maxBytes: SCENE_CUTS_MAX_BYTES })
  }, 60_000)

  it("answers no cut for a single shot", async () => {
    const res = await asChild({ videoUrl: ONE_SHOT })
    expect(res.statusCode).toBe(200)
    expect(res.json().cutsSec).toEqual([])
    expect(res.json().durationSec).toBeCloseTo(2, 1)
  }, 60_000)

  it("refuses a bad body 400: no address, not a web address, another key", async () => {
    for (const body of [{}, { videoUrl: "not a url" }, { videoUrl: THREE_SHOTS, extra: 1 }]) {
      const res = await asChild(body)
      expect(res.statusCode, JSON.stringify(body)).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(download).not.toHaveBeenCalled()
  })

  it("refuses 400 a clip it cannot download, or a file that is not a video", async () => {
    const missing = await asChild({ videoUrl: "https://example.com/missing.mp4" })
    expect(missing.statusCode).toBe(400)
    expect(missing.json().error.code).toBe("video_unreadable")
    const text = await asChild({ videoUrl: NOT_A_VIDEO })
    expect(text.statusCode).toBe(400)
    expect(text.json().error.code).toBe("video_unreadable")
  }, 60_000)

  it("probes the local copy only, through a fixed list of containers", async () => {
    await asChild({ videoUrl: ONE_SHOT })
    expect(probeArgs).toHaveLength(1)
    expect(probeArgs[0]!.slice(2, 6)).toEqual([...SCENE_CUTS_INPUT_ARGS])
    expect(SCENE_CUTS_INPUT_ARGS).toEqual(["-protocol_whitelist", "file", "-format_whitelist", "mov,mp4,m4a,matroska,webm"])
  }, 60_000)

  it("refuses 400 a clip over 300 s before decoding it", async () => {
    const res = await asChild({ videoUrl: TOO_LONG })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_duration_exceeds_limit")
  }, 60_000)

  it("refuses 400 a video whose length cannot be read", async () => {
    probeAnswer = JSON.stringify({ streams: [{ width: 160, height: 90 }], format: {} })
    const res = await asChild({ videoUrl: ONE_SHOT })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_video_duration")
  }, 60_000)

  it("refuses 400 a clip past the byte cap (the capped download fails)", async () => {
    download.mockImplementationOnce(async (_url: string, _dest: string, opts?: { maxBytes?: number }) => {
      throw new Error(`Download exceeds ${opts?.maxBytes} bytes`)
    })
    const res = await asChild({ videoUrl: THREE_SHOTS })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_unreadable")
    expect(download).toHaveBeenCalledWith(THREE_SHOTS, expect.any(String), { maxBytes: SCENE_CUTS_MAX_BYTES })
  })
})
