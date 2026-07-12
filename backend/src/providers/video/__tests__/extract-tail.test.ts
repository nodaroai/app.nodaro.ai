/**
 * Real-ffmpeg test for `extractTailToFile` (`../extract-tail.ts`).
 *
 * This repo's other real-ffmpeg tests (`trim-edge-frames.e2e.test.ts`,
 * `assemble-narrated-video.e2e.test.ts`) assume ffmpeg is present — CI
 * installs it via a dedicated step in `.github/workflows/ci.yml` — and don't
 * skip-guard (grepped this repo for `ffmpegAvailable`/`skipIf`/`which
 * ffmpeg`: no existing precedent). This test adds a minimal, synchronous
 * availability check so a local run without ffmpeg on PATH skips cleanly
 * instead of failing with a confusing spawn error.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { runFfmpeg, runFfprobe } from "../ffmpeg-utils.js"
import { extractTailToFile } from "../extract-tail.js"

function isFfmpegAvailable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

const ffmpegAvailable = isFfmpegAvailable()

describe.skipIf(!ffmpegAvailable)("extractTailToFile (real ffmpeg)", () => {
  let dir: string

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "extract-tail-test-"))
  })

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  it("re-encodes the last N seconds: correct duration, decodable first frame, h264/yuv420p video", async () => {
    const src = join(dir, `${randomUUID()}.mp4`)

    // 5s test pattern video + 5s sine-tone audio, muxed into one clip.
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc=duration=5:size=320x240:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-shortest",
      src,
    ])

    const out = await extractTailToFile(src, 1.0)
    expect(out).toBe(`${src}.tail.mp4`)

    // Output duration must be ~1s (0.9-1.1s tolerance).
    const durationOut = await runFfprobe([
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out,
    ])
    const duration = parseFloat(durationOut.trim())
    expect(duration).toBeGreaterThanOrEqual(0.9)
    expect(duration).toBeLessThanOrEqual(1.1)

    // First frame must decode cleanly — a stream-copy trim that snapped to a
    // keyframe outside the requested window can otherwise emit a file that
    // fails to decode from its start.
    expect(() =>
      execFileSync("ffmpeg", ["-i", out, "-frames:v", "1", "-f", "null", "-"], { stdio: "ignore" }),
    ).not.toThrow()

    // Video stream must be h264/yuv420p — proves it was RE-ENCODED, not
    // stream-copied (the source is already h264/yuv420p, so a stream-copy
    // would trivially "pass" a codec check; the duration + decode assertions
    // above are what actually distinguish re-encode from copy).
    const streamOut = await runFfprobe([
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,pix_fmt",
      "-of", "csv=p=0",
      out,
    ])
    const [codec, pixFmt] = streamOut.trim().toLowerCase().split(",")
    expect(codec).toBe("h264")
    expect(pixFmt).toBe("yuv420p")
  }, 60_000)
})
