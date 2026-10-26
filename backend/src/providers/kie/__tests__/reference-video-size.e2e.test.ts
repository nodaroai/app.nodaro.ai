// @test-reads-none only the temporary clips it renders itself
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { runFfmpeg, runFfprobe } from "../../video/ffmpeg-utils.js"
import { fitVideoSize, shrinkVideoArgs, KLING_4_REF_VIDEO_LIMIT } from "../reference-video-size.js"

/**
 * The shrink on real ffmpeg: the shape of the failing production clip
 * (2568×1080, sound, an empty chapter track) comes out 2048×860 with its sound
 * and nothing else; a portrait clip is sized by its height.
 */

function isFfmpegAvailable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

async function streams(path: string): Promise<Array<{ codec_type: string; codec_name?: string; width?: number; height?: number }>> {
  const out = await runFfprobe(["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", path])
  return (JSON.parse(out) as { streams: Array<{ codec_type: string; codec_name?: string; width?: number; height?: number }> }).streams
}

describe.skipIf(!isFfmpegAvailable())("shrinkVideoArgs (real ffmpeg)", () => {
  let dir: string

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "ref-video-size-"))
  })
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  async function source(name: string, size: string): Promise<string> {
    const meta = join(dir, `${name}.meta`)
    await fs.writeFile(meta, ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=\n")
    const path = join(dir, `${name}.mp4`)
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", `testsrc2=s=${size}:r=30:d=1`,
      "-f", "lavfi", "-i", "sine=f=440:r=44100:d=1",
      "-i", meta, "-map_chapters", "2",
      "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      path,
    ])
    return path
  }

  it("a 2568×1080 clip with a chapter track comes out 2048×860, H.264 + AAC, nothing else", async () => {
    const input = await source("wide", "2568x1080")
    expect((await streams(input)).map((s) => s.codec_type)).toContain("data")
    const output = join(dir, "wide-out.mp4")
    await runFfmpeg(shrinkVideoArgs(input, output, fitVideoSize(2568, 1080, KLING_4_REF_VIDEO_LIMIT)!))
    const out = await streams(output)
    expect(out.map((s) => s.codec_type)).toEqual(["video", "audio"])
    expect(out[0]).toMatchObject({ codec_name: "h264", width: 2048, height: 860 })
    expect(out[1]).toMatchObject({ codec_name: "aac" })
  }, 60_000)

  it("a portrait clip is sized by its height", async () => {
    const input = await source("tall", "1080x2568")
    const output = join(dir, "tall-out.mp4")
    await runFfmpeg(shrinkVideoArgs(input, output, fitVideoSize(1080, 2568, KLING_4_REF_VIDEO_LIMIT)!))
    expect((await streams(output))[0]).toMatchObject({ width: 860, height: 2048 })
  }, 60_000)
})
