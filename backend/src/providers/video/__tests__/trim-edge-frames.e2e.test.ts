/**
 * Real-ffmpeg e2e test for `trimEdgeFrames` (ffmpeg-utils.ts).
 *
 * ffmpeg-utils.test.ts mocks `node:child_process` globally (fast, hermetic
 * unit coverage of the probe/skip/re-encode branches — see its "trimEdgeFrames"
 * describe block), so it can't exercise the real duration math end to end.
 * This file mirrors the lavfi fixture-generation idiom from
 * assemble-narrated-video.e2e.test.ts to prove the helper actually shortens a
 * real clip by ~frames/fps against genuine ffmpeg/ffprobe binaries.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { runFfmpeg, getVideoDuration, trimEdgeFrames } from "../ffmpeg-utils.js"

// Generates a solid-color silent clip via ffmpeg lavfi (same idiom as the
// narrated-video assembler's e2e fixture).
async function makeClip(path: string, seconds: number, fps: number, color: string) {
  await runFfmpeg([
    "-y", "-f", "lavfi", "-i", `color=c=${color}:s=320x240:r=${fps}:d=${seconds}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", String(seconds), path,
  ])
}

describe("trimEdgeFrames (e2e)", () => {
  let dir: string
  beforeAll(async () => { dir = await fs.mkdtemp(join(tmpdir(), "trim-edge-e2e-")) })
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}) })

  it("reduces clip duration by ~framesToTrim/fps when trimming the end", async () => {
    const fps = 24
    const framesToTrim = 24 // ~1s at 24fps
    const src = join(dir, `${randomUUID()}.mp4`)
    await makeClip(src, 6, fps, "red")

    const originalDuration = await getVideoDuration(src)
    const out = join(dir, `${randomUUID()}.mp4`)
    const result = await trimEdgeFrames(src, out, 0, framesToTrim)

    expect(result).toBe(out)
    const trimmedDuration = await getVideoDuration(out)
    const expectedDuration = originalDuration - framesToTrim / fps
    // Allow small tolerance for encoder/keyframe rounding.
    expect(Math.abs(trimmedDuration - expectedDuration)).toBeLessThan(0.5)
    expect(trimmedDuration).toBeLessThan(originalDuration)
  }, 60_000)

  it("reduces clip duration by ~(startFrames+endFrames)/fps when trimming both ends", async () => {
    const fps = 24
    const trimStartFrames = 24
    const trimEndFrames = 24
    const src = join(dir, `${randomUUID()}.mp4`)
    await makeClip(src, 8, fps, "blue")

    const originalDuration = await getVideoDuration(src)
    const out = join(dir, `${randomUUID()}.mp4`)
    await trimEdgeFrames(src, out, trimStartFrames, trimEndFrames)

    const trimmedDuration = await getVideoDuration(out)
    const expectedDuration = originalDuration - (trimStartFrames + trimEndFrames) / fps
    expect(Math.abs(trimmedDuration - expectedDuration)).toBeLessThan(0.5)
  }, 60_000)

  it("returns the source path unchanged when the trim would exceed the clip's real duration", async () => {
    const fps = 24
    const src = join(dir, `${randomUUID()}.mp4`)
    await makeClip(src, 1, fps, "green") // 1s clip

    const out = join(dir, `${randomUUID()}.mp4`)
    // Request trimming 2s worth of frames off a 1s clip — must skip, not error.
    const result = await trimEdgeFrames(src, out, fps * 2, 0)

    expect(result).toBe(src)
    await expect(fs.access(out)).rejects.toThrow() // outputPath was never written
  }, 60_000)
})
