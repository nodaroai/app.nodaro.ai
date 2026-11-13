/**
 * A long recording with no length in its header (a 75-minute live-written VP8
 * WebM at 60 fps: 270,000 packets, a packet listing of about 9.9 MB — past
 * `runFfprobe`'s 5 MB buffer, where the first version of this reading refused
 * it as unreadable) is read to its end by the streamed packet scan, through
 * `probeClipLengthSec` — the one reading the charge and the render's check
 * both measure by (`video-utility-probe.e2e.test.ts` drives both sides on short
 * no-length files). Real ffmpeg and ffprobe: the fixture is encoded at test
 * time (32 × 32, realtime), which takes up to about a minute, so the file runs
 * in the Media E2E job (`backend/src/test/media-e2e-files.json`). It imports
 * the reading alone, so the job's inputs stay the probe's own.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { runFfmpeg, runFfprobe } from "../../providers/video/ffmpeg-utils.js"
import { probeClipLengthSec } from "../video-utility-probe.js"

const SECONDS = 4500
const FPS = 60

let dir: string
let long: string

beforeAll(async () => {
  dir = join(tmpdir(), `video-utility-probe-long-${randomUUID()}`)
  await fs.mkdir(dir, { recursive: true })
  long = join(dir, "long.webm")
  await runFfmpeg(
    ["-y", "-f", "lavfi", "-i", `color=c=black:s=32x32:r=${FPS}:d=${SECONDS}`, "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "20k", "-g", "600", "-f", "webm", "-live", "1", long],
    600_000,
  )
}, 600_000)

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe("a 75-minute recording with no length in its header", () => {
  it("really has no length in its header, and its packet listing is past a 5 MB buffer", async () => {
    const header = await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration:format=duration", "-of", "csv=p=0", long])
    expect(header.split("\n").map((l) => l.trim()).filter(Boolean).every((l) => l === "N/A")).toBe(true)
    await expect(runFfprobe(["-v", "error", "-select_streams", "0", "-show_entries", "packet=pts_time,dts_time,duration_time,flags", "-of", "csv=p=0", long])).rejects.toThrow(/maxBuffer/)
  }, 120_000)

  it("is read to its end: 4,500 s, on both readings the nodes use", async () => {
    expect(await probeClipLengthSec(long)).toBeCloseTo(SECONDS, 1)
    expect(await probeClipLengthSec(long, { reading: "video-stream" })).toBeCloseTo(SECONDS, 1)
  }, 120_000)
})
