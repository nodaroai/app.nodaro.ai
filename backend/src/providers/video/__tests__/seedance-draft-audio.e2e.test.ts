// @test-reads-none reads only the clips it renders with ffmpeg into its own temp dir
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

const uploaded = vi.hoisted(() => ({
  streams: [] as Array<{ hasVideo: boolean; hasAudio: boolean; duration: number }>,
  /** When set, the "uploaded" file is copied here, so a test can probe the stored result. */
  keepAs: undefined as string | undefined,
}))
vi.mock("../../../workers/shared.js", async () => {
  const { probeMediaStreams, getVideoStreamDuration } = await import("../ffmpeg-utils.js")
  return {
    uploadVideoMaybeWatermark: async () => {
      uploaded.streams.push({ hasVideo: true, hasAudio: false, duration: 0 })
      return { videoUrl: "https://r2.example/hd-as-rendered.mp4" }
    },
    watermarkLocalVideoAndUpload: async (path: string) => {
      const s = await probeMediaStreams(path)
      if (uploaded.keepAs) await (await import("node:fs")).promises.copyFile(path, uploaded.keepAs)
      uploaded.streams.push({ hasVideo: s.hasVideo, hasAudio: s.hasAudio, duration: await getVideoStreamDuration(path) })
      return { videoUrl: "https://r2.example/hd.mp4" }
    },
  }
})

import { runFfmpeg } from "../ffmpeg-utils.js"
import { mp3EncodeArgs } from "../mp3-encode.js"
import { applyDraftAudioMux } from "../../../lib/seedance-draft-audio-apply.js"
import { generateVideoAudioMergeRecipe, voiceTrackMuxRecipe } from "../../../lib/seedance-draft-audio.js"
import { addVoiceLineIfSilent, LipSyncVoiceLineError } from "../../../lib/lip-sync-voice-line.js"
import { runFfprobe, getVideoDuration, probeVideoStream, probeVideoFrameCount } from "../ffmpeg-utils.js"

describe.skipIf(!mp3EncoderAvailable)("Seedance draft finalize audio mux (e2e, real ffmpeg)", () => {
  let dir: string
  const p = (name: string) => join(dir, name)
  beforeAll(async () => {
    expect(ffmpegAvailable).toBe(true)
    dir = await fs.mkdtemp(join(tmpdir(), "seedance-draft-audio-e2e-"))
    // The "1080p" finalize: a silent 3 s picture (small, for speed).
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=192x108:r=24:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", p("hd-silent.mp4")])
    // The draft's voice track and a stored (already muxed) draft clip.
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=f=440:r=44100:d=3", ...mp3EncodeArgs(), p("voice.mp3")])
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

/**
 * Real-ffmpeg e2e: a Lip Sync whose model was sent the voice as reference audio
 * and returned a clip with no audio stream gets the caller's voice line
 * (decided 2026-11-17). The upload is replaced by a copy of the merged file,
 * so the stored result itself is probed.
 */
describe.skipIf(!mp3EncoderAvailable)("Lip Sync voice line on a silent clip (e2e, real ffmpeg)", () => {
  let dir: string
  const p = (name: string) => join(dir, name)
  const audioCodecs = async (path: string) => (await runFfprobe(["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name", "-of", "csv=p=0", path])).trim()
  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "lip-sync-voice-line-e2e-"))
    // The provider's clip: 4 s of picture, no audio stream.
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=192x108:r=24:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", p("talk-silent.mp4")])
    // The same clip when the provider did carry audio.
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "testsrc2=s=192x108:r=24:d=4", "-f", "lavfi", "-i", "sine=f=660:r=44100:d=4",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", p("talk-voiced.mp4"),
    ])
    // A voice line longer than the clip (6.5 s) and one shorter (1.5 s).
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=f=440:r=44100:d=6.5", ...mp3EncodeArgs(), p("voice-long.mp3")])
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=f=440:r=44100:d=1.5", ...mp3EncodeArgs(), p("voice-short.mp3")])
  }, 60_000)
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}) })

  /** `voice`: a file in the work dir, a `missing:` link (the download fails), or none. */
  const add = async (video: string, voice: string | undefined) => {
    uploaded.streams = []
    uploaded.keepAs = p(`stored-${voice}.mp4`)
    const voiceUrl = voice === undefined || voice.startsWith("missing:") ? voice : p(voice)
    try {
      return await addVoiceLineIfSilent({ videoUrl: p(video), voiceUrl, jobId: "job-ls", userId: "u", watermark: false })
    } finally {
      uploaded.keepAs = undefined
    }
  }

  it.each(["voice-long.mp3", "voice-short.mp3"])("%s: the stored clip is the picture, untouched, with the voice as long as the picture", async (voice) => {
    expect(await add("talk-silent.mp4", voice)).toEqual({ kind: "muxed", stored: { videoUrl: "https://r2.example/hd.mp4" } })
    const stored = p(`stored-${voice}.mp4`)
    expect(uploaded.streams[0]).toMatchObject({ hasVideo: true, hasAudio: true })
    // The picture is copied: same codec, same frames, same length.
    expect(await probeVideoStream(stored)).toEqual(await probeVideoStream(p("talk-silent.mp4")))
    expect(await probeVideoFrameCount(stored)).toBe(await probeVideoFrameCount(p("talk-silent.mp4")))
    expect(uploaded.streams[0]!.duration).toBeCloseTo(4, 1)
    // One AAC stream, and the file ends with the picture: a longer line is
    // cut there, a shorter one is followed by silence.
    expect(await audioCodecs(stored)).toBe("aac")
    expect(await getVideoDuration(stored)).toBeGreaterThan(3.9)
    expect(await getVideoDuration(stored)).toBeLessThan(4.1)
    const audioSec = parseFloat(await runFfprobe(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration", "-of", "csv=p=0", stored]))
    expect(audioSec).toBeGreaterThan(3.9)
    expect(audioSec).toBeLessThan(4.1)
  }, 60_000)

  it("a clip that already has an audio stream is left alone: nothing is merged or stored here", async () => {
    expect(await add("talk-voiced.mp4", "voice-long.mp3")).toEqual({ kind: "has-audio" })
    expect(uploaded.streams).toEqual([])
  }, 60_000)

  it("a clip that cannot be probed is left to be delivered as it came (fail-open): nothing merged or stored here", async () => {
    expect(await add("no-such-clip.mp4", "voice-long.mp3")).toEqual({ kind: "probe-failed" })
    expect(uploaded.streams).toEqual([])
  }, 60_000)

  it("the stored clip's index is at the front (faststart): moov before mdat", async () => {
    await add("talk-silent.mp4", "voice-long.mp3")
    const bytes = await fs.readFile(p("stored-voice-long.mp3.mp4"))
    expect(bytes.indexOf("moov")).toBeGreaterThan(0)
    expect(bytes.indexOf("moov")).toBeLessThan(bytes.indexOf("mdat"))
  }, 60_000)

  it.each([
    ["a file that is not media", "corrupt.mp3"],
    ["a file with no audio stream", "talk-silent.mp4"],
  ])("a voice line that cannot be read (%s) leaves the clip to be delivered as it came: nothing stored, no error", async (_why, voice) => {
    await fs.writeFile(p("corrupt.mp3"), "not audio")
    expect(await add("talk-silent.mp4", voice)).toEqual({ kind: "voice-unreadable" })
    expect(uploaded.streams).toEqual([])
  }, 60_000)

  it.each([
    ["a download that fails without a refusal status", "missing://voice.mp3"],
    ["no voice line at all", undefined],
  ])("a silent clip whose voice cannot be added for another reason (%s) fails the step with a plain (refunding) error, nothing stored", async (_why, voice) => {
    const err = await add("talk-silent.mp4", voice).then(() => undefined, (e: unknown) => e)
    expect(err).toBeInstanceOf(LipSyncVoiceLineError)
    expect((err as { postProcessing?: unknown }).postProcessing).toBeUndefined()
    expect(uploaded.streams).toEqual([])
  }, 60_000)
})
