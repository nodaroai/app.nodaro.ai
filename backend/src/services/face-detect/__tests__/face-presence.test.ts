/**
 * `detectFacePresence` — does a clip show a face at all (decided 2026-10-12,
 * R2)? A few frames spread across the clip, decoded by the same launcher and
 * run through the same YuNet session Speaker Frames uses, inside ONE admission
 * hold. It answers `present`, `none`, or `unknown` — and a host that cannot
 * detect, or a decode that gave too few frames to judge, is `unknown`, which
 * never refuses a run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Readable } from "node:stream"
import { EventEmitter } from "node:events"

const fx = vi.hoisted(() => ({
  slots: [] as Array<{ timeoutMs: number; peakMemoryMiB?: number; label?: string }>,
  spawns: [] as string[][],
  /** Frames each fake decode writes (w × h BGR each); 0 = ffmpeg produced nothing. */
  framesPerSpawn: 1,
  /** Spawns (1-based) that fail with a non-zero exit. */
  failSpawns: new Set<number>(),
  /** Faces the fake session reports, per call (1-based): a frame number → faces. */
  facesAt: (_call: number): number => 0,
  sessionError: undefined as Error | undefined,
  calls: 0,
}))

vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({
  withFfmpegSlot: async (fn: () => Promise<unknown>, opts: { timeoutMs: number; peakMemoryMiB?: number; label?: string }) => {
    fx.slots.push(opts)
    return fn()
  },
  runFfprobe: async () => "{}",
  ffmpegFailureMessage: (stderr: string | undefined, fallback: string) => `ffmpeg failed: ${stderr || fallback}`,
}))

vi.mock("../../../providers/video/ffmpeg-process.js", () => ({
  spawnFfmpeg: (args: string[]) => {
    fx.spawns.push(args)
    const n = fx.spawns.length
    const vf = args[args.indexOf("-vf") + 1] ?? ""
    const m = /scale=(\d+):(\d+)/.exec(vf)
    const size = Number(m?.[1] ?? 0) * Number(m?.[2] ?? 0) * 3
    const failing = fx.failSpawns.has(n)
    const frames = Array.from({ length: failing ? 0 : fx.framesPerSpawn }, () => Buffer.alloc(size, 7))
    const proc = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable; kill: () => boolean; exitCode: number | null }
    proc.stdout = Readable.from(frames)
    proc.stderr = Readable.from([])
    proc.exitCode = null
    proc.kill = () => true
    const code = fx.failSpawns.has(n) ? 1 : 0
    proc.stdout.on("end", () => setImmediate(() => { proc.exitCode = code; proc.emit("close", code, null) }))
    return proc
  },
}))

vi.mock("../../../providers/video/ffmpeg-threads.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/video/ffmpeg-threads.js")>()),
  ffmpegEffectiveThreads: () => ({ decode: 2, filter: 2, encode: 2 }),
}))

vi.mock("../yunet-session.js", async () => {
  const { YUNET_STRIDES } = await import("../yunet-decode.js")
  return {
    yunetSession: async () => {
      if (fx.sessionError) throw fx.sessionError
      return {
        detector: { id: "yunet:test", version: "test" },
        intraOpThreads: 1,
        run: async (_input: Float32Array, pw: number, ph: number) => {
          fx.calls++
          const faces = fx.facesAt(fx.calls)
          const out: Record<string, Float32Array> = {}
          for (const st of YUNET_STRIDES) {
            const n = (pw / st) * (ph / st)
            out[`cls_${st}`] = new Float32Array(n)
            out[`obj_${st}`] = new Float32Array(n)
            out[`bbox_${st}`] = new Float32Array(4 * n)
            out[`kps_${st}`] = new Float32Array(10 * n)
          }
          for (let k = 0; k < faces; k++) {
            const i = 2 * k
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

import { detectFacePresence, FACE_PRESENCE_SAMPLES } from "../face-presence.js"
import { FaceDetectorUnavailableError } from "../yunet-model.js"

const clip = { durationMs: 80_000, width: 3840, height: 2160 }

beforeEach(() => {
  fx.slots = []
  fx.spawns = []
  fx.framesPerSpawn = 1
  fx.failSpawns = new Set()
  fx.facesAt = () => 0
  fx.sessionError = undefined
  fx.calls = 0
})

describe("detectFacePresence", () => {
  it("samples frames spread across the clip, each seeked on its own, scaled down and auto-rotated", async () => {
    await detectFacePresence("/tmp/clip.mp4", clip)
    expect(fx.spawns).toHaveLength(FACE_PRESENCE_SAMPLES)
    const seeks = fx.spawns.map((a) => Number(a[a.indexOf("-ss") + 1]))
    seeks.forEach((s, i) => expect(s).toBeCloseTo((clip.durationMs * (i + 0.5)) / FACE_PRESENCE_SAMPLES / 1000, 3))
    for (const args of fx.spawns) {
      expect(args).not.toContain("-noautorotate")
      expect(args[args.indexOf("-frames:v") + 1]).toBe("1")
      expect(args[args.indexOf("-vf") + 1]).toBe("scale=960:540")
    }
  })

  it("answers none when it looked at the sampled frames and found no face", async () => {
    expect(await detectFacePresence("/tmp/clip.mp4", clip)).toBe("none")
    expect(fx.calls).toBe(FACE_PRESENCE_SAMPLES)
  })

  it("answers present at the first face, without decoding the rest", async () => {
    fx.facesAt = (call) => (call === 3 ? 1 : 0)
    expect(await detectFacePresence("/tmp/clip.mp4", clip)).toBe("present")
    expect(fx.spawns).toHaveLength(3)
  })

  it("runs the whole probe inside one admission hold", async () => {
    await detectFacePresence("/tmp/clip.mp4", clip)
    expect(fx.slots).toHaveLength(1)
    expect(fx.slots[0]!.label).toBe("face-presence")
    expect(fx.slots[0]!.peakMemoryMiB).toBeGreaterThan(0)
  })

  it("keeps a portrait source's shape and never enlarges a small one", async () => {
    await detectFacePresence("/tmp/c.mp4", { durationMs: 20_000, width: 720, height: 1280 })
    expect(fx.spawns[0]![fx.spawns[0]!.indexOf("-vf") + 1]).toBe("scale=304:540")
    fx.spawns = []
    await detectFacePresence("/tmp/c.mp4", { durationMs: 20_000, width: 320, height: 180 })
    expect(fx.spawns[0]![fx.spawns[0]!.indexOf("-vf") + 1]).toBe("scale=320:180")
  })

  it("is unknown on a host that cannot detect, and decodes nothing", async () => {
    fx.sessionError = new FaceDetectorUnavailableError("no model")
    expect(await detectFacePresence("/tmp/clip.mp4", clip)).toBe("unknown")
    expect(fx.slots).toHaveLength(0)
    expect(fx.spawns).toHaveLength(0)
  })

  it("is unknown when too few frames decoded to judge, never none", async () => {
    fx.framesPerSpawn = 0
    expect(await detectFacePresence("/tmp/clip.mp4", clip)).toBe("unknown")
    fx.spawns = []
    fx.framesPerSpawn = 1
    // Six of the eight decodes fail with nothing written: two frames is too few to call a clip faceless.
    fx.failSpawns = new Set([1, 2, 3, 4, 5, 6])
    expect(await detectFacePresence("/tmp/clip.mp4", clip)).toBe("unknown")
  })

  it("is unknown without a usable size or length", async () => {
    expect(await detectFacePresence("/tmp/clip.mp4", { durationMs: 20_000 })).toBe("unknown")
    expect(await detectFacePresence("/tmp/clip.mp4", { durationMs: 0, width: 1920, height: 1080 })).toBe("unknown")
    expect(fx.spawns).toHaveLength(0)
  })
})
