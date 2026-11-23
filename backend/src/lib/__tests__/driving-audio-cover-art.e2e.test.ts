/**
 * LTX 2.5 Fast audio-to-video's reading of a REAL file (decided 2026-11-23):
 * an M4A or MP3 that carries cover art is audio (the art is no picture) and is
 * read to its length, through the user-file probe and the endpoint's formats;
 * an MP4 with a real picture wired as audio is refused before the hold. Real
 * ffmpeg and ffprobe: the fixtures are written at test time with ffmpeg's own
 * encoders.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { runFfmpeg } from "../../providers/video/ffmpeg-utils.js"
import { mp3EncodeArgs } from "../../providers/video/mp3-encode.js"

// The reader downloads over the network; here it copies a local fixture. Everything else stays real.
vi.mock("../../providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../providers/video/ffmpeg-utils.js")>()
  const { promises: fsp } = await import("node:fs")
  return { ...actual, downloadFile: async (src: string, dest: string) => { await fsp.copyFile(new URL(src).pathname, dest) } }
})
vi.mock("../url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { measureDrivingAudio } from "../driving-audio-measure.js"

let dir: string
let m4aWithArt: string
let mp3WithArt: string
let mp4Video: string
const url = (path: string) => `https://fixtures.test${path}`

beforeAll(async () => {
  dir = join(tmpdir(), `driving-audio-cover-${randomUUID()}`)
  await fs.mkdir(dir, { recursive: true })
  const art = join(dir, "art.png")
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=1", "-frames:v", "1", art])
  m4aWithArt = join(dir, "song.m4a")
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3.5", "-i", art, "-map", "0:a", "-map", "1:v", "-c:a", "aac", "-c:v", "png", "-disposition:v", "attached_pic", m4aWithArt])
  mp3WithArt = join(dir, "song.mp3")
  // The platform's own MP3 encode (whole frames), then the art added as an ID3 picture without re-encoding.
  const bare = join(dir, "bare.mp3")
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3.5", ...mp3EncodeArgs(), bare])
  await runFfmpeg(["-y", "-i", bare, "-i", art, "-map", "0:a", "-map", "1:v", "-c:a", "copy", "-c:v", "png", "-disposition:v", "attached_pic", "-id3v2_version", "3", mp3WithArt])
  mp4Video = join(dir, "clip.mp4")
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=10:d=3.5", "-f", "lavfi", "-i", "sine=frequency=440:duration=3.5", "-c:v", "mpeg4", "-c:a", "aac", "-shortest", mp4Video])
}, 60_000)

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe("the driving clip's reading, real files", () => {
  it.each([["an M4A", () => m4aWithArt], ["an MP3", () => mp3WithArt]])("%s with cover art is audio, read to its length", async (_kind, file) => {
    const out = await measureDrivingAudio({ provider: "ltx-2.5-fast", audioUrl: url(file()), resolution: "720p" })
    expect(out).toMatchObject({ ok: true, billedSec: 4, creditId: "ltx-2.5-fast:4s:720p" })
    if (out.ok) expect(out.audioSec).toBeGreaterThan(3.4)
  }, 30_000)

  it("an MP4 with a real picture is refused before the hold", async () => {
    expect(await measureDrivingAudio({ provider: "ltx-2.5-fast", audioUrl: url(mp4Video) })).toMatchObject({ ok: false, code: "audio_has_video" })
  }, 30_000)
})
