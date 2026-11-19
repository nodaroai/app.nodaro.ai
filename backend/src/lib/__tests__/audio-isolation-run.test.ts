/**
 * One Audio Isolation run (`runAudioIsolation`): the ElevenLabs key first,
 * then one download under the 500 MB limit, the length read again from that
 * copy by the reader that priced it, and the MEDIA deciding what is sent — a
 * video's sound only (written to FLAC), never the video; an audio in a
 * container ElevenLabs takes, as it came. The download, the probes, ffmpeg and
 * the provider call are stood in for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  sec: 8 as number,
  streams: { hasVideo: false, hasAudio: true },
  formatNames: ["mp3"] as string[],
  downloadError: undefined as Error | undefined,
  keyMissing: false,
  calls: [] as string[],
}))

vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  BIG_MEDIA_DOWNLOAD_LIMITS: { maxBytes: 1 },
  createWorkDir: vi.fn(async () => "/tmp/iso-work"),
  cleanupWorkDir: vi.fn(async () => {}),
  downloadFile: vi.fn(async (_url: string, dest: string, opts: { maxBytes?: number }) => {
    state.calls.push(`download ${dest} max=${opts.maxBytes}`)
    if (state.downloadError) throw state.downloadError
  }),
  probeMediaStreams: vi.fn(async () => state.streams),
  probeMediaFormatAndDuration: vi.fn(async () => ({ formatNames: state.formatNames })),
  runFfmpeg: vi.fn(async (args: string[]) => {
    state.calls.push(`ffmpeg ${args.join(" ")}`)
    return ""
  }),
}))
vi.mock("../../providers/video/ffmpeg-memory-model.js", () => ({ audioPeakMemoryMiB: () => 400 }))
vi.mock("../video-utility-probe.js", () => ({ probeSoundLengthSec: vi.fn(async () => state.sec) }))
vi.mock("../config.js", () => ({
  config: { get ELEVENLABS_API_KEY() { return state.keyMissing ? "" : "k" } },
}))
vi.mock("../nodaro-connect-cache.js", () => ({ isNodaroConnectedCached: () => false }))
vi.mock("../../providers/elevenlabs/audio-isolation.js", () => ({
  directAudioIsolation: vi.fn(async (path: string, opts: { audioSec: number; sourceContentType: string }) => {
    state.calls.push(`isolate ${path} ${opts.sourceContentType} ${opts.audioSec}`)
    return { buffer: Buffer.from("x"), contentType: "audio/mpeg", extension: "mp3" }
  }),
}))

import { runAudioIsolation, sentAsIsContentType } from "../audio-isolation-run.js"
import { isDeterministicJobError } from "../deterministic-job-error.js"

beforeEach(() => {
  state.sec = 8
  state.streams = { hasVideo: false, hasAudio: true }
  state.formatNames = ["mp3"]
  state.downloadError = undefined
  state.keyMissing = false
  state.calls = []
})

describe("runAudioIsolation", () => {
  it("an MP3 is downloaded once under 500 MB and sent as it came", async () => {
    const out = await runAudioIsolation({ audioUrl: "https://cdn.test/a.mp3", heldUnits: 1 })
    expect(state.calls).toEqual([
      `download /tmp/iso-work/source max=${500 * 1024 * 1024}`,
      "isolate /tmp/iso-work/source audio/mpeg 8",
    ])
    expect(out).toMatchObject({ sentSec: 8, converted: false })
  })

  it("a video sends only its sound: the first audio track written to FLAC, never the video file", async () => {
    state.streams = { hasVideo: true, hasAudio: true }
    state.formatNames = ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"]
    const out = await runAudioIsolation({ audioUrl: "https://cdn.test/clip.mp4", heldUnits: 1 })
    expect(state.calls[1]).toBe("ffmpeg -nostdin -v error -y -i /tmp/iso-work/source -map 0:a:0 -vn -c:a flac /tmp/iso-work/audio.flac")
    expect(state.calls[2]).toBe("isolate /tmp/iso-work/audio.flac audio/flac 8")
    expect(out.converted).toBe(true)
  })

  it("an audio-only M4A is sent as it came; a WebM recording is sent as FLAC", async () => {
    state.formatNames = ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"]
    await runAudioIsolation({ audioUrl: "https://cdn.test/a.m4a", heldUnits: 1 })
    expect(state.calls.at(-1)).toBe("isolate /tmp/iso-work/source audio/mp4 8")
    state.calls = []
    state.formatNames = ["matroska", "webm"]
    await runAudioIsolation({ audioUrl: "https://cdn.test/a.webm", heldUnits: 1 })
    expect(state.calls.at(-1)).toBe("isolate /tmp/iso-work/audio.flac audio/flac 8")
    expect(sentAsIsContentType(["wav"])).toBe("audio/wav")
    expect(sentAsIsContentType(["matroska", "webm"])).toBeUndefined()
  })

  it("a keyless install fails with the house refusal before anything is downloaded", async () => {
    state.keyMissing = true
    const err = await runAudioIsolation({ audioUrl: "https://cdn.test/a.mp3", heldUnits: 1 }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: "provider_key_missing" })
    expect((err as Error).message).toMatch(/^Audio Isolation: needs ELEVENLABS_API_KEY/)
    // The connection does not run this node: the sentence never offers it as cover.
    expect((err as Error).message).toMatch(/not covered by the nodaro\.ai connection/)
    expect((err as Error).message).not.toMatch(/or connect nodaro\.ai/)
    expect(state.calls).toEqual([])
  })

  it("a file over 500 MB is refused, deterministic, nothing sent", async () => {
    state.downloadError = new Error("Download exceeds 500 MB: https://cdn.test/a.wav")
    const err = await runAudioIsolation({ audioUrl: "https://cdn.test/a.wav", heldUnits: 1 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toMatch(/500 MB/)
    expect(state.calls.some((c) => c.startsWith("isolate"))).toBe(false)
  })

  it("a copy that reads longer than the run holds is refused, deterministic, nothing sent", async () => {
    state.sec = 25
    const err = await runAudioIsolation({ audioUrl: "https://cdn.test/a.mp3", heldUnits: 2 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toMatch(/longer than when the run was priced/)
    expect(state.calls.some((c) => c.startsWith("isolate"))).toBe(false)
  })

  it("a copy past 30 minutes is refused; a file with no audio track is refused", async () => {
    state.sec = 1900
    await expect(runAudioIsolation({ audioUrl: "https://cdn.test/a.mp3" })).rejects.toThrow(/30 minutes/)
    state.sec = 8
    state.streams = { hasVideo: true, hasAudio: false }
    await expect(runAudioIsolation({ audioUrl: "https://cdn.test/a.mp4", heldUnits: 1 })).rejects.toThrow(/no audio track/)
  })
})
