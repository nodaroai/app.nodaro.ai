/**
 * Shot Cuts' frames cap (`measureShotCuts`), with the probe, the scan and ffmpeg
 * replaced: frames are saved for up to 1,000 shots in ONE frames decode; one
 * shot more is refused (deterministic, refunded) before that decode. Times alone
 * have no cap. The real output is proven by `shot-cuts.e2e.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const fake = vi.hoisted(() => ({
  shots: 0,
  calls: [] as string[][],
  dirs: [] as string[],
}))

vi.mock("../ffmpeg-utils.js", () => ({
  BIG_MEDIA_DOWNLOAD_LIMITS: { tag: "big-media" },
  createWorkDir: async (prefix: string) => {
    const d = await (await import("node:fs")).promises.mkdtemp(join(tmpdir(), `${prefix}-`))
    fake.dirs.push(d)
    return d
  },
  cleanupWorkDir: async (d: string) => {
    await (await import("node:fs")).promises.rm(d, { recursive: true, force: true })
  },
  downloadFile: async (_url: string, dest: string) => {
    await (await import("node:fs")).promises.writeFile(dest, "src")
  },
  // The frames decode: one empty PNG per selected frame (no pixels needed here).
  runFfmpeg: async (args: string[]) => {
    fake.calls.push([...args])
    const out = args[args.length - 1]!
    const n = Number(args[args.indexOf("-frames:v") + 1])
    const { promises: f } = await import("node:fs")
    for (let i = 1; i <= n; i++) await f.writeFile(out.replace("%06d", String(i).padStart(6, "0")), "")
    return ""
  },
}))
vi.mock("../video-mask.js", () => ({ maskGeometryPeakMemoryMiB: () => 512 }))
vi.mock("../../../services/scene-cut-frames.js", () => ({
  SCENE_CUTS_INPUT_ARGS: ["-protocol_whitelist", "file"],
  probeSceneCutsClip: async () => ({ width: 320, height: 180, durationSec: 1800 }),
  // `fake.shots` shots, ten frames each, at 25 fps.
  detectShotCuts: async () => ({
    cuts: Array.from({ length: fake.shots - 1 }, (_, i) => ({ sec: ((i + 1) * 10) / 25, frame: (i + 1) * 10 })),
    frameCount: fake.shots * 10,
    firstFrameTimeS: 0,
    lastFrameSec: (fake.shots * 10 - 1) / 25,
  }),
}))

import { measureShotCuts, SHOT_CUTS_MAX_FRAME_SHOTS } from "../shot-cuts.js"
import { cleanupWorkDir } from "../ffmpeg-utils.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"

beforeEach(() => {
  fake.calls.length = 0
})
afterEach(async () => {
  for (const d of fake.dirs.splice(0)) await fs.rm(d, { recursive: true, force: true })
})

describe("Shot Cuts' frames cap", () => {
  it("is 1,000 shots", () => {
    expect(SHOT_CUTS_MAX_FRAME_SHOTS).toBe(1_000)
  })

  it("1,000 shots with frames: every shot's first and last frame, 2,000 PNGs, in one decode", async () => {
    fake.shots = 1_000
    const out = await measureShotCuts({ videoUrl: "https://v", frames: true })
    try {
      expect(out.shots).toHaveLength(1_000)
      expect(out.framePaths!.size).toBe(2_000)
      expect(fake.calls).toHaveLength(1)
      expect(fake.calls[0]![fake.calls[0]!.indexOf("-frames:v") + 1]).toBe("2000")
    } finally {
      await cleanupWorkDir(out.workDir)
    }
  }, 60_000)

  it("1,001 shots with frames: refused (deterministic) before the frames decode", async () => {
    fake.shots = 1_001
    const err = await measureShotCuts({ videoUrl: "https://v", frames: true }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toMatch(/1001 shots; first and last frames are saved for up to 1000 shots/)
    expect(fake.calls).toHaveLength(0)
  })

  it("1,001 shots without frames: the times alone have no cap", async () => {
    fake.shots = 1_001
    const out = await measureShotCuts({ videoUrl: "https://v" })
    try {
      expect(out.shots).toHaveLength(1_001)
      expect(out.framePaths).toBeUndefined()
    } finally {
      await cleanupWorkDir(out.workDir)
    }
  })
})
