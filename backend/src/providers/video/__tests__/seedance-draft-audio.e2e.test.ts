/**
 * Real-ffmpeg e2e: a Seedance draft's 1080p finalize re-applies the draft's
 * post-render audio mux (decided 2026-10-12). The 1080p picture comes back
 * SILENT from the provider for a voiced (audio-driven) draft; after the mux it
 * must carry the voice. Each recipe kind is run on real files; the upload is
 * replaced by a probe of the merged file.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ffmpegAvailable, mp3EncoderAvailable } from "./apply-edl-e2e-helpers.js"

// The provider downloads its inputs; here a "URL" is already a local path.
vi.mock("../ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ffmpeg-utils.js")>()),
  downloadFile: async (url: string, dest: string) => {
    if (url.startsWith("missing:")) throw new Error("404 gone")
    await fs.copyFile(url, dest)
  },
}))

const uploaded = vi.hoisted(() => ({ streams: [] as Array<{ hasVideo: boolean; hasAudio: boolean; duration: number }> }))
vi.mock("../../../workers/shared.js", async () => {
  const { probeMediaStreams, getVideoStreamDuration } = await import("../ffmpeg-utils.js")
  return {
    uploadVideoMaybeWatermark: async () => {
      uploaded.streams.push({ hasVideo: true, hasAudio: false, duration: 0 })
      return "https://r2.example/hd-as-rendered.mp4"
    },
    watermarkLocalVideoAndUpload: async (path: string) => {
      const s = await probeMediaStreams(path)
      uploaded.streams.push({ hasVideo: s.hasVideo, hasAudio: s.hasAudio, duration: await getVideoStreamDuration(path) })
      return "https://r2.example/hd.mp4"
    },
  }
})

import { runFfmpeg } from "../ffmpeg-utils.js"
import { applyDraftAudioMux } from "../../../lib/seedance-draft-audio-apply.js"
import { generateVideoAudioMergeRecipe, voiceTrackMuxRecipe } from "../../../lib/seedance-draft-audio.js"

describe.skipIf(!mp3EncoderAvailable)("Seedance draft finalize audio mux (e2e, real ffmpeg)", () => {
  let dir: string
  const p = (name: string) => join(dir, name)
  beforeAll(async () => {
    expect(ffmpegAvailable).toBe(true)
    dir = await fs.mkdtemp(join(tmpdir(), "seedance-draft-audio-e2e-"))
    // The "1080p" finalize: a silent 3 s picture (small, for speed).
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=192x108:r=24:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", p("hd-silent.mp4")])
    // The draft's voice track and a stored (already muxed) draft clip.
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=f=440:r=44100:d=3", "-c:a", "libmp3lame", p("voice.mp3")])
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "testsrc2=s=96x54:r=24:d=3", "-f", "lavfi", "-i", "sine=f=660:r=44100:d=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", p("draft-stored.mp4"),
    ])
    // A stored draft cut SHORTER than its take (a Smart Loop Cut / trim): 2 s of a 3 s take.
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "testsrc2=s=96x54:r=24:d=2", "-f", "lavfi", "-i", "sine=f=660:r=44100:d=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", p("draft-trimmed.mp4"),
    ])
  }, 60_000)
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}) })

  const run = async (mux: Parameters<typeof applyDraftAudioMux>[0]["mux"], draftVideoUrl?: string) => {
    uploaded.streams = []
    const res = await applyDraftAudioMux({ videoUrl: p("hd-silent.mp4"), mux, draftVideoUrl, jobId: "job-hd", userId: "u", watermark: false, sleep: async () => {} })
    return { ...uploaded.streams[0]!, warning: res.warning }
  }

  it("a voiced draft's finalize carries the voice track", async () => {
    const out = await run(voiceTrackMuxRecipe(p("voice.mp3")))
    expect(out).toMatchObject({ hasVideo: true, hasAudio: true })
    expect(out.duration).toBeGreaterThan(2.9)
  }, 60_000)

  it("an audioUrl-merged draft's finalize carries the merged audio", async () => {
    const out = await run(generateVideoAudioMergeRecipe(p("voice.mp3"), false))
    expect(out).toMatchObject({ hasVideo: true, hasAudio: true })
  }, 60_000)

  it("a recipe whose audio source is gone falls back to the stored draft's audio", async () => {
    const out = await run(voiceTrackMuxRecipe("missing://track.mp3"), p("draft-stored.mp4"))
    expect(out).toMatchObject({ hasVideo: true, hasAudio: true })
  }, 60_000)

  it("a copy from a stored draft with NO audio stream delivers the picture as rendered, no warning, no error", async () => {
    const out = await run({ kind: "copy-draft-audio", draftVideoUrl: p("hd-silent.mp4") })
    expect(out).toMatchObject({ hasAudio: false })
    expect(out.warning).toBeUndefined()
  }, 60_000)

  it("a recipe that cannot be applied at all (unreadable source, silent fallback) delivers silent with the warning", async () => {
    await fs.writeFile(p("corrupt.mp3"), "not audio")
    const out = await run(voiceTrackMuxRecipe(p("corrupt.mp3")))
    expect(out).toMatchObject({ hasAudio: false })
    expect(out.warning?.code).toBe("draft_audio_not_reapplied")
  }, 60_000)

  it("a copy from a stored draft SHORTER than the take delivers the picture silent WITH the warning (no truncated audio)", async () => {
    const out = await run({ kind: "copy-draft-audio", draftVideoUrl: p("draft-trimmed.mp4") })
    expect(out).toMatchObject({ hasAudio: false })
    expect(out.warning?.code).toBe("draft_audio_not_reapplied")
  }, 60_000)

  it("the legacy copy recipe carries the stored draft's audio", async () => {
    const out = await run({ kind: "copy-draft-audio", draftVideoUrl: p("draft-stored.mp4") })
    expect(out).toMatchObject({ hasVideo: true, hasAudio: true })
  }, 60_000)
})
