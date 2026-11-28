// @test-reads-none reads only the temp clips it writes
/**
 * An editing step's source reads exactly as long as the preview its run was
 * priced on (decided 2026-11-22): the two are encoded through one chain, only
 * the picture's quality differs. Measured on real files with the readings the
 * charge checks use (`probeClipReading`: the container's length and the video
 * stream's). Skips without ffmpeg / libx265; the HDR chain needs zscale (CI's
 * pinned build has it, Homebrew's does not), so it is measured here on a
 * 10-bit SDR clip, whose chain is the same apart from the tone map.
 */
import { execFileSync } from "node:child_process"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { scaledTimeout } from "../../../../../tools/vitest/ci-limits.mjs"
import { runFfmpeg } from "../ffmpeg-utils.js"
import { encodeBrowserSafePreview, encodeEditingSource } from "../browser-safe-preview.js"
import { probeMatched } from "../matched-encode.js"
import { probeClipReading } from "../../../lib/video-utility-probe.js"

function has(kind: "-encoders" | "-filters", name: string): boolean {
  try {
    return new RegExp(`\\s${name}\\s`).test(execFileSync("ffmpeg", ["-hide_banner", kind], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))
  } catch {
    return false
  }
}
const x265Available = has("-encoders", "libx264") && has("-encoders", "libx265")

let dir = ""
beforeAll(async () => { dir = await fs.mkdtemp(join(tmpdir(), "editing-source-length-")) })
afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe.skipIf(!x265Available)("an editing step's source and the preview read alike", () => {
  it("the same container and video-stream lengths, the same frames, 8-bit H.264 4:2:0", { timeout: scaledTimeout(60_000) }, async () => {
    const original = join(dir, "original.mp4")
    // 2.3 s at 24 fps with 48 kHz sound that runs a little past the picture, as a generation's often does.
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=2.3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2.4:sample_rate=48000",
      "-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
      "-c:a", "aac", original,
    ])
    const probe = await probeMatched(original)
    const preview = await encodeBrowserSafePreview(original, join(dir, "preview.mp4"), probe)
    const source = await encodeEditingSource(original, join(dir, "source.mp4"), probe, { timeoutMs: 60_000 })
    for (const reading of ["container", "video-stream"] as const) {
      const [p, s] = await Promise.all([probeClipReading(preview, { reading }), probeClipReading(source, { reading })])
      expect(s.sec, reading).toBeCloseTo(p.sec, 3)
      expect(s.fps, reading).toBe(p.fps)
    }
    const read = await probeMatched(source)
    expect(read).toMatchObject({ videoCodec: "h264", pixFmt: "yuv420p", width: 320, height: 180 })
    // The same input class as the preview (decided 2026-11-22): every step
    // that reads it chooses the encode it chose for the preview, so no file it
    // delivers is heavier than it was. Only the picture's own bitrate differs.
    const p = await probeMatched(preview)
    const classOf = (m: typeof p) => ({
      videoCodec: m.videoCodec, pixFmt: m.pixFmt, width: m.width, height: m.height, nominalFpsRational: m.nominalFpsRational,
      colorPrimaries: m.colorPrimaries, colorTransfer: m.colorTransfer, colorSpace: m.colorSpace, colorRange: m.colorRange,
      audioCodec: m.audioCodec, quickTime: m.quickTime,
    })
    expect(classOf(read)).toEqual(classOf(p))
    expect(Math.abs((read.audioBitRate ?? 0) - (p.audioBitRate ?? 0))).toBeLessThan(0.1 * (p.audioBitRate ?? 1))
  })
})
