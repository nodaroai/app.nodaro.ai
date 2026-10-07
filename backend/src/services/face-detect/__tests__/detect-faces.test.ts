/**
 * `detectFaces` — the toolkit member's guards, with ffmpeg, onnxruntime and
 * storage mocked (the real path is `detect-faces.parity.test.ts`).
 *
 *   - It refuses before any reservation: a bad request, a URL that is not our
 *     own proxy, or a host that cannot detect (no model, no native binary).
 *   - The window's decode AND its inference run inside ONE ffmpeg admission
 *     hold (#1860), reserving the declared peak for the thread counts that
 *     actually run — the decode child's from the box's quota (#1841), the
 *     session's from its own option.
 *   - It never hands back more than the speaker-track caps (P3.1) allow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Readable } from "node:stream"
import { EventEmitter } from "node:events"

const fx = vi.hoisted(() => ({
  slots: [] as Array<{ timeoutMs: number; peakMemoryMiB?: number; label?: string }>,
  spawns: [] as string[][],
  /** Frames the fake decoder writes (w × h BGR each). */
  frameCount: 4,
  width: 960,
  height: 540,
  /** Faces the fake session reports per frame. */
  facesPerFrame: 1,
  sessionError: undefined as Error | undefined,
  threads: { decode: 2, filter: 2, encode: 2 },
  /** The caps the member enforces (the real ones are pinned in face-detect-budget.test.ts). */
  caps: { maxBoxes: 100_000, maxBytes: 64 * 1024 * 1024 },
  /** CPU ms the fake admission burns BEFORE it grants the slot: other jobs'
   *  work while this call waits in the queue. */
  slotWaitBurnMs: 0,
}))

/** Spin this process's CPU for `ms` of CPU time (user + system). */
function burnCpu(ms: number): void {
  const start = process.cpuUsage()
  let spin = 0
  for (;;) {
    for (let i = 0; i < 10_000; i++) spin += Math.sqrt(i)
    const d = process.cpuUsage(start)
    if ((d.user + d.system) / 1000 >= ms) break
  }
  if (spin < 0) throw new Error("unreachable")
}

vi.mock("../face-detect-budget.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../face-detect-budget.js")>()),
  faceDetectCaps: () => fx.caps,
}))

vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({
  withFfmpegSlot: async (fn: () => Promise<unknown>, opts: { timeoutMs: number; peakMemoryMiB?: number; label?: string }) => {
    fx.slots.push(opts)
    if (fx.slotWaitBurnMs > 0) {
      // The admission wait yields, and other jobs in this process run meanwhile.
      await new Promise((resolve) => setImmediate(resolve))
      burnCpu(fx.slotWaitBurnMs)
    }
    return fn()
  },
  runFfprobe: async () => JSON.stringify({ streams: [{ width: fx.width, height: fx.height }], format: { start_time: "0.000000" } }),
  ffmpegFailureMessage: (stderr: string | undefined, fallback: string) => `ffmpeg failed: ${stderr || fallback}`,
}))

vi.mock("../../../providers/video/ffmpeg-process.js", () => ({
  spawnFfmpeg: (args: string[]) => {
    fx.spawns.push(args)
    const size = fx.width * fx.height * 3
    const frames = Array.from({ length: fx.frameCount }, () => Buffer.alloc(size, 7))
    const proc = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable; kill: () => boolean; exitCode: number | null }
    proc.stdout = Readable.from(frames)
    proc.stderr = Readable.from([])
    proc.exitCode = null
    proc.kill = () => true
    proc.stdout.on("end", () => setImmediate(() => { proc.exitCode = 0; proc.emit("close", 0, null) }))
    return proc
  },
}))

vi.mock("../../../providers/video/ffmpeg-threads.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/video/ffmpeg-threads.js")>()),
  ffmpegEffectiveThreads: () => fx.threads,
}))

/** A session whose outputs hold `fx.facesPerFrame` well-separated faces on stride 8. */
vi.mock("../yunet-session.js", async () => {
  const { YUNET_STRIDES } = await import("../yunet-decode.js")
  return {
    yunetSession: async () => {
      if (fx.sessionError) throw fx.sessionError
      return {
        detector: { id: "yunet:2023mar-dyn@test", version: "test" },
        intraOpThreads: 1,
        run: async (_input: Float32Array, pw: number, ph: number) => {
          const out: Record<string, Float32Array> = {}
          for (const st of YUNET_STRIDES) {
            const n = (pw / st) * (ph / st)
            out[`cls_${st}`] = new Float32Array(n)
            out[`obj_${st}`] = new Float32Array(n)
            out[`bbox_${st}`] = new Float32Array(4 * n)
            out[`kps_${st}`] = new Float32Array(10 * n)
          }
          // One tiny face per anchor, every other anchor on stride 8 — never overlapping.
          for (let k = 0; k < fx.facesPerFrame; k++) {
            const i = 2 * k
            if (i >= out.cls_8!.length) break
            out.cls_8![i] = 1
            out.obj_8![i] = 1
            out.bbox_8!.set([0.5, 0.5, Math.log(0.5), Math.log(0.5)], 4 * i)
          }
          return out
        },
      }
    },
  }
})

vi.mock("../../../lib/storage.js", () => ({
  r2KeyFromOurUrl: (url: string) => (url.startsWith("https://media.example/") ? url.slice("https://media.example/".length) : null),
}))

import { detectFaces, FaceDetectRequestError, FaceDetectCapError } from "../detect-faces.js"
import { FaceDetectorUnavailableError } from "../yunet-model.js"
import { FACE_DETECT_MAX_FRAMES_PER_CALL, faceDetectPeakMemoryMiB, faceDetectTimeoutMs } from "../face-detect-budget.js"
import { DeterministicJobError } from "../../../lib/deterministic-job-error.js"
import type { ProxySpanMap } from "../../media-proxy-span-map.js"

const URL_OK = "https://media.example/proxies/abc/video-v2@2fps-540p.mp4"
const MAP: ProxySpanMap = [{ proxyStartMs: 0, proxyEndMs: 600_000, sourceStartMs: 0, firstFrame: 0, frameCount: 1200 }]
const base = { proxyUrl: URL_OK, fps: 2, spanMap: MAP, fromFrame: 0, toFrame: 4, minScore: 0.7 }

beforeEach(() => {
  fx.slots = []
  fx.spawns = []
  fx.frameCount = 4
  fx.facesPerFrame = 1
  fx.sessionError = undefined
  fx.threads = { decode: 2, filter: 2, encode: 2 }
  fx.caps = { maxBoxes: 100_000, maxBytes: 64 * 1024 * 1024 }
  fx.slotWaitBurnMs = 0
  fx.width = 960
  fx.height = 540
})

describe("detectFaces refuses before it reserves anything", () => {
  const refusals: Array<[string, Partial<typeof base>]> = [
    ["a URL that is not our own stored proxy", { proxyUrl: "https://evil.example/x.mp4" }],
    ["a non-integer frame", { fromFrame: 0.5 }],
    ["an empty window", { fromFrame: 3, toFrame: 3 }],
    ["a window past the proxy's last frame", { fromFrame: 1190, toFrame: 1201 }],
    ["a window over the per-call frame cap", { fromFrame: 0, toFrame: FACE_DETECT_MAX_FRAMES_PER_CALL + 1 }],
    ["a bad fps", { fps: 0 }],
    ["a score outside (0, 1]", { minScore: 0 }],
    ["an empty span map", { spanMap: [] }],
  ]
  for (const [what, patch] of refusals) {
    it(what, async () => {
      const err = await detectFaces({ ...base, ...patch }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(FaceDetectRequestError)
      expect(err).toBeInstanceOf(DeterministicJobError)
      expect(fx.slots).toHaveLength(0)
      expect(fx.spawns).toHaveLength(0)
    })
  }

  it("a host whose detector cannot load (no model, no native binary) refuses with no admission and no decode", async () => {
    fx.sessionError = new FaceDetectorUnavailableError("onnxruntime-node did not load")
    await expect(detectFaces(base)).rejects.toBeInstanceOf(FaceDetectorUnavailableError)
    expect(fx.slots).toHaveLength(0)
    expect(fx.spawns).toHaveLength(0)
  })
})

describe("detectFaces runs inside one admission hold", () => {
  it("one hold per call, reserving the declared peak at the threads that run", async () => {
    const result = await detectFaces(base)
    expect(result.frames).toHaveLength(4)
    expect(fx.slots).toHaveLength(1)
    expect(fx.slots[0]!.label).toBe("face-detect")
    expect(fx.slots[0]!.peakMemoryMiB).toBe(faceDetectPeakMemoryMiB({ width: fx.width, height: fx.height }, 1, fx.threads))
    expect(fx.slots[0]!.timeoutMs).toBe(faceDetectTimeoutMs(4))
    expect(fx.spawns).toHaveLength(1)
  })

  it("the reservation follows the box's ffmpeg threads (#1841): more threads, a bigger reservation", async () => {
    await detectFaces(base)
    fx.threads = { decode: 8, filter: 8, encode: 8 }
    await detectFaces(base)
    expect(fx.slots[1]!.peakMemoryMiB!).toBeGreaterThan(fx.slots[0]!.peakMemoryMiB!)
  })

  it("decodes exactly the window's frames, to raw BGR, never autorotated", async () => {
    await detectFaces({ ...base, fromFrame: 0, toFrame: 4 })
    const args = fx.spawns[0]!
    expect(args).toContain("-noautorotate")
    expect(args.slice(args.indexOf("-frames:v"), args.indexOf("-frames:v") + 2)).toEqual(["-frames:v", "4"])
    expect(args.slice(args.indexOf("-pix_fmt"), args.indexOf("-pix_fmt") + 2)).toEqual(["-pix_fmt", "bgr24"])
    expect(args).toContain(URL_OK)
  })

  it("a proxy that ends before the window does is an error, not a short result", async () => {
    fx.frameCount = 3
    await expect(detectFaces(base)).rejects.toThrow(/3 of 4 frames/)
  })
})

describe("detectFaces reports the CPU of its own hold only", () => {
  it("CPU other work burns while the call waits for its slot is not counted in cpuMs", async () => {
    // Small frames: the window's own work is a few ms; the wait burns far more.
    fx.width = 96
    fx.height = 54
    fx.frameCount = 1
    fx.slotWaitBurnMs = 400
    const result = await detectFaces({ ...base, toFrame: 1 })
    expect(result.frames).toHaveLength(1)
    expect(result.cpuMs).toBeLessThan(fx.slotWaitBurnMs / 2)
  })
})

describe("detectFaces respects the speaker-track caps (P3.1)", () => {
  it("stops with a deterministic error once a call would hold more boxes than the per-source cap", async () => {
    fx.caps = { maxBoxes: 10, maxBytes: 64 * 1024 * 1024 }
    fx.facesPerFrame = 3 // 4 frames × 3 = 12 > 10
    const err = await detectFaces(base).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FaceDetectCapError)
    expect(err).toBeInstanceOf(DeterministicJobError)
    expect(String((err as Error).message)).toMatch(/boxes/)
  })

  it("refuses a result whose serialized size would pass the byte cap", async () => {
    fx.caps = { maxBoxes: 100_000, maxBytes: 200 }
    const err = await detectFaces(base).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FaceDetectCapError)
    expect(String((err as Error).message)).toMatch(/bytes/)
  })

  it("reports the box count it returns", async () => {
    fx.facesPerFrame = 3
    const result = await detectFaces(base)
    expect(result.boxCount).toBe(12)
    expect(result.frames.every((f) => f.boxes.length === 3)).toBe(true)
  })
})
