/**
 * Every lane that stores a user's video bytes rewrites a moov-last MP4/MOV with
 * the index in front BEFORE the first write — on real ffmpeg, through the real
 * routes. Storage, the database, Redis and the thumbnailer are replaced; the
 * box walk, the stream copy and the verification are not.
 *
 * Covered here: POST /v1/upload (web + SDK), PUT /v1/upload-proxy/:token (the
 * MCP prepare_*_upload verbs), POST /v1/upload-page/:token (the browser
 * handoff and the in-chat widget). The multi-GB URL-import lane has its own
 * cases in lib/__tests__/media-url-import.test.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const launcher = vi.hoisted(() => ({ fail: false, launched: 0 }))
vi.mock("../../providers/video/ffmpeg-cancellable.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../providers/video/ffmpeg-cancellable.js")>()
  return {
    ...actual,
    runFfmpegCancellable: (...args: Parameters<typeof actual.runFfmpegCancellable>) =>
      (launcher.launched++, launcher.fail) ? Promise.reject(new Error("ffmpeg unavailable")) : actual.runFfmpegCancellable(...args),
  }
})

// The UPLOAD_FASTSTART_ENABLED kill switch: on by default, flipped per test.
const killSwitch = vi.hoisted(() => ({ enabled: true }))
vi.mock("../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/config.js")>()),
  uploadFaststartEnabled: () => killSwitch.enabled,
}))

const stored = vi.hoisted(() => ({ puts: [] as Array<{ Key: string; Body: Buffer; ContentType: string }> }))
vi.mock("../../lib/storage.js", () => ({
  s3: { send: vi.fn(async (cmd: { input: { Key: string; Body: Buffer; ContentType: string } }) => { stored.puts.push(cmd.input) }) },
  withObjectAcl: <T>(x: T) => x,
}))
// `claimed` is what Redis says about the single-use nonce (`exists` = the peek, `set` NX = the claim).
const nonce = vi.hoisted(() => ({ claimed: false, existsThrows: false }))
vi.mock("../../lib/queue.js", () => ({
  redis: {
    set: vi.fn(async () => (nonce.claimed ? null : "OK")),
    exists: vi.fn(async () => {
      if (nonce.existsThrows) throw new Error("redis down")
      return nonce.claimed ? 1 : 0
    }),
  },
}))
vi.mock("../../lib/supabase.js", () => ({
  supabase: { from: vi.fn(() => ({ insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: "asset-1" }, error: null }) })) })) })) },
}))
vi.mock("../../utils/file-validation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/file-validation.js")>()),
  reserveStorageIfWithinLimit: vi.fn().mockResolvedValue(true),
  checkStorageQuota: vi.fn(),
  refundStorage: vi.fn(),
}))
vi.mock("../../utils/thumbnail.js", () => ({
  processImage: vi.fn(),
  processAudio: vi.fn(),
  processVideo: vi.fn().mockResolvedValue({ thumbnail: Buffer.from("png"), metadata: { width: 320, height: 240, durationSeconds: 3, codec: "h264" } }),
}))

import { reserveStorageIfWithinLimit } from "../../utils/file-validation.js"
import { runFfmpeg } from "../../providers/video/ffmpeg-utils.js"
import { ffmpegAvailable } from "../../providers/video/__tests__/video-overlay-e2e-fixtures.js"
import { probeMp4LayoutInBuffer } from "../../utils/mp4-boxes.js"
import { clearUploadPolicies, registerUploadPolicy } from "../../lib/upload-policy.js"
import { signUploadToken } from "../upload-proxy.js"
import { uploadRoutes } from "../upload.js"
import { uploadProxyRoutes } from "../upload-proxy.js"
import { uploadHandoffRoutes } from "../upload-handoff.js"

it.runIf(!!process.env.CI)("CI has ffmpeg — this file never skips there", () => {
  expect(ffmpegAvailable).toBe(true)
})

const USER = "00000000-0000-4000-8000-000000000001"

function multipart(file: Buffer, filename: string, mimetype: string): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----faststart-test-boundary"
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`)
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return { payload: Buffer.concat([head, file, tail]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } }
}

describe.skipIf(!ffmpegAvailable)("upload lanes — faststart", () => {
  let dir: string
  let moovLast: Buffer
  let faststart: Buffer
  let moovLastMov: Buffer
  let app: FastifyInstance

  const makeVideo = async (name: string, movflags: string[], format: "mp4" | "mov" = "mp4"): Promise<Buffer> => {
    const path = join(dir, name)
    await runFfmpeg([
      "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=d=2:s=320x240:r=25", "-f", "lavfi", "-i", "sine=d=2",
      "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", ...movflags, "-f", format, path,
    ], 60_000)
    return fs.readFile(path)
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "upload-faststart-"))
    moovLast = await makeVideo("last.mp4", [])
    faststart = await makeVideo("fast.mp4", ["-movflags", "+faststart"])
    moovLastMov = await makeVideo("last.mov", [], "mov")
    // app.ts raises maxParamLength for the same ~330-char signed tokens.
    app = Fastify({ logger: false, routerOptions: { maxParamLength: 2048 } })
    app.addHook("preHandler", async (req) => { req.userId = USER })
    await app.register(uploadRoutes)
    await app.register(uploadProxyRoutes)
    await app.register(uploadHandoffRoutes)
    await app.ready()
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await fs.rm(dir, { recursive: true, force: true })
  })

  beforeEach(() => {
    stored.puts.length = 0
    launcher.fail = false
    launcher.launched = 0
    nonce.claimed = false
    nonce.existsThrows = false
    killSwitch.enabled = true
    vi.mocked(reserveStorageIfWithinLimit).mockClear()
  })
  afterEach(() => clearUploadPolicies())

  const videoPut = () => stored.puts.find((p) => p.ContentType.startsWith("video/"))!

  it("fixture sanity", async () => {
    expect((await probeMp4LayoutInBuffer(moovLast)).layout).toBe("moov-last")
    expect((await probeMp4LayoutInBuffer(faststart)).layout).toBe("faststart")
  })

  describe("POST /v1/upload", () => {
    it("stores a moov-last MP4 faststart, and reports, reserves and records the FINAL length", async () => {
      const seen: number[] = []
      registerUploadPolicy({ id: "spy", check: (i) => { seen.push(i.buffer?.length ?? -1); return { allow: true } } })
      const { payload, headers } = multipart(moovLast, "obs.mp4", "video/mp4")
      const res = await app.inject({ method: "POST", url: "/v1/upload", payload, headers })
      expect(res.statusCode).toBe(200)
      const put = videoPut()
      expect((await probeMp4LayoutInBuffer(put.Body)).layout).toBe("faststart")
      expect(put.Body.equals(moovLast)).toBe(false) // really rewritten (same length: boxes only moved)
      const data = res.json().data
      expect(data.sizeBytes).toBe(put.Body.length)
      expect(data.category).toBe("video")
      expect(vi.mocked(reserveStorageIfWithinLimit)).toHaveBeenCalledWith(USER, put.Body.length)
      expect(seen).toEqual([put.Body.length]) // the upload policy saw the final bytes
    })

    it("a QuickTime MOV stays a MOV", async () => {
      const { payload, headers } = multipart(moovLastMov, "clip.mov", "video/quicktime")
      const res = await app.inject({ method: "POST", url: "/v1/upload", payload, headers })
      expect(res.statusCode).toBe(200)
      const probe = await probeMp4LayoutInBuffer(videoPut().Body)
      expect(probe).toMatchObject({ layout: "faststart", majorBrand: "qt  " })
    })

    it("stores an already-faststart file byte for byte", async () => {
      const { payload, headers } = multipart(faststart, "fast.mp4", "video/mp4")
      const res = await app.inject({ method: "POST", url: "/v1/upload", payload, headers })
      expect(res.statusCode).toBe(200)
      expect(videoPut().Body.equals(faststart)).toBe(true)
    })

    it("stores the file exactly as sent when the remux fails", async () => {
      launcher.fail = true
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const { payload, headers } = multipart(moovLast, "obs.mp4", "video/mp4")
      const res = await app.inject({ method: "POST", url: "/v1/upload", payload, headers })
      expect(res.statusCode).toBe(200)
      expect(videoPut().Body.equals(moovLast)).toBe(true)
      expect(res.json().data.sizeBytes).toBe(moovLast.length)
      expect(warn.mock.calls.some((c) => String(c[0]).includes("[faststart] upload"))).toBe(true)
      warn.mockRestore()
    })
  })

  describe("PUT /v1/upload-proxy/:token (MCP prepare_video_upload)", () => {
    const token = (mime: string) =>
      signUploadToken({ userId: USER, key: "uploads/video/u/abc.mp4", mime, exp: Date.now() + 60_000, purpose: "proxy" })

    it("stores a moov-last MP4 faststart and reports the final length", async () => {
      const res = await app.inject({ method: "PUT", url: `/v1/upload-proxy/${token("video/mp4")}`, payload: moovLast, headers: { "content-type": "video/mp4" } })
      expect(res.statusCode).toBe(200)
      const put = stored.puts[0]!
      expect(put.Key).toBe("uploads/video/u/abc.mp4") // the key the caller was promised
      expect((await probeMp4LayoutInBuffer(put.Body)).layout).toBe("faststart")
      expect(res.json().bytes).toBe(put.Body.length)
    })

    it("leaves a non-video upload alone", async () => {
      const png = Buffer.from("not really a png, but not a video either")
      const res = await app.inject({ method: "PUT", url: `/v1/upload-proxy/${token("image/png")}`, payload: png, headers: { "content-type": "image/png" } })
      expect(res.statusCode).toBe(200)
      expect(stored.puts[0]!.Body.equals(png)).toBe(true)
    })

    it("stores as sent when the remux fails", async () => {
      launcher.fail = true
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const res = await app.inject({ method: "PUT", url: `/v1/upload-proxy/${token("video/mp4")}`, payload: moovLast, headers: { "content-type": "video/mp4" } })
      expect(res.statusCode).toBe(200)
      expect(stored.puts[0]!.Body.equals(moovLast)).toBe(true)
      vi.restoreAllMocks()
    })
  })

  describe("POST /v1/upload-page/:token (browser handoff / in-chat widget)", () => {
    const token = (kind: "video" | "image") =>
      signUploadToken({ userId: USER, key: `uploads/handoff/${kind}/u/abc`, mime: "", exp: Date.now() + 60_000, purpose: "handoff", kind })

    it("stores a moov-last video faststart at the predetermined key", async () => {
      const { payload, headers } = multipart(moovLast, "obs.mp4", "video/mp4")
      const res = await app.inject({ method: "POST", url: `/v1/upload-page/${token("video")}`, payload, headers })
      expect(res.statusCode).toBe(200)
      const put = stored.puts[0]!
      expect(put.Key).toBe("uploads/handoff/video/u/abc")
      expect((await probeMp4LayoutInBuffer(put.Body)).layout).toBe("faststart")
      expect(res.json()).toMatchObject({ ok: true, bytes: put.Body.length })
    })

    it("stores as sent when the remux fails", async () => {
      launcher.fail = true
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const { payload, headers } = multipart(moovLast, "obs.mp4", "video/mp4")
      const res = await app.inject({ method: "POST", url: `/v1/upload-page/${token("video")}`, payload, headers })
      expect(res.statusCode).toBe(200)
      expect(stored.puts[0]!.Body.equals(moovLast)).toBe(true)
      vi.restoreAllMocks()
    })
  })

  describe("a replayed handoff link", () => {
    const token = () =>
      signUploadToken({ userId: USER, key: "uploads/handoff/video/u/abc", mime: "", exp: Date.now() + 60_000, purpose: "handoff", kind: "video" })

    it("409s before any remux starts, so replays cost no CPU, disk or remux slot", async () => {
      nonce.claimed = true
      const { payload, headers } = multipart(moovLast, "obs.mp4", "video/mp4")
      const res = await app.inject({ method: "POST", url: `/v1/upload-page/${token()}`, payload, headers })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("token_already_used")
      expect(launcher.launched).toBe(0)
      expect(stored.puts).toHaveLength(0)
    })

    it("a fresh link still remuxes and is claimed after validation", async () => {
      const { payload, headers } = multipart(moovLast, "obs.mp4", "video/mp4")
      const res = await app.inject({ method: "POST", url: `/v1/upload-page/${token()}`, payload, headers })
      expect(res.statusCode).toBe(200)
      expect(launcher.launched).toBe(1)
    })

    it("a policy deny leaves the link reusable (the peek does not burn it)", async () => {
      registerUploadPolicy({ id: "deny", check: () => ({ allow: false, reason: "no" }) })
      const { redis } = await import("../../lib/queue.js")
      vi.mocked(redis.set).mockClear()
      const { payload, headers } = multipart(moovLast, "obs.mp4", "video/mp4")
      const res = await app.inject({ method: "POST", url: `/v1/upload-page/${token()}`, payload, headers })
      expect(res.statusCode).toBe(422)
      expect(redis.set).not.toHaveBeenCalled()
    })

    it("fails open when Redis cannot answer the peek, like the claim does", async () => {
      nonce.existsThrows = true
      const { payload, headers } = multipart(moovLast, "obs.mp4", "video/mp4")
      const res = await app.inject({ method: "POST", url: `/v1/upload-page/${token()}`, payload, headers })
      expect(res.statusCode).toBe(200)
    })
  })

  describe("UPLOAD_FASTSTART_ENABLED=false (kill switch)", () => {
    beforeEach(() => { killSwitch.enabled = false })

    it("POST /v1/upload stores a moov-last MP4 exactly as sent, without starting ffmpeg", async () => {
      const { payload, headers } = multipart(moovLast, "obs.mp4", "video/mp4")
      const res = await app.inject({ method: "POST", url: "/v1/upload", payload, headers })
      expect(res.statusCode).toBe(200)
      expect(videoPut().Body.equals(moovLast)).toBe(true)
      expect(res.json().data.sizeBytes).toBe(moovLast.length)
    })

    it("the proxy PUT stores it exactly as sent", async () => {
      const token = signUploadToken({ userId: USER, key: "uploads/video/u/abc.mp4", mime: "video/mp4", exp: Date.now() + 60_000, purpose: "proxy" })
      const res = await app.inject({ method: "PUT", url: `/v1/upload-proxy/${token}`, payload: moovLast, headers: { "content-type": "video/mp4" } })
      expect(res.statusCode).toBe(200)
      expect(stored.puts[0]!.Body.equals(moovLast)).toBe(true)
    })

    it("the handoff page stores it exactly as sent", async () => {
      const token = signUploadToken({ userId: USER, key: "uploads/handoff/video/u/abc", mime: "", exp: Date.now() + 60_000, purpose: "handoff", kind: "video" })
      const { payload, headers } = multipart(moovLast, "obs.mp4", "video/mp4")
      const res = await app.inject({ method: "POST", url: `/v1/upload-page/${token}`, payload, headers })
      expect(res.statusCode).toBe(200)
      expect(stored.puts[0]!.Body.equals(moovLast)).toBe(true)
    })

    it("with the switch on again the rewrite is back", async () => {
      killSwitch.enabled = true
      const { payload, headers } = multipart(moovLast, "obs.mp4", "video/mp4")
      const res = await app.inject({ method: "POST", url: "/v1/upload", payload, headers })
      expect(res.statusCode).toBe(200)
      expect((await probeMp4LayoutInBuffer(videoPut().Body)).layout).toBe("faststart")
    })
  })
})
