import { describe, expect, it } from "vitest"
import { AAC_FRAME_SAMPLES, AAC_LOWEST_SAMPLE_RATE_HZ, measuredWireLengthSec, recordingDecodeOverhangSec } from "@nodaro/render-rules"

/**
 * An AAC recording decodes in whole 1024-sample frames, past the container
 * length its upload recorded (measured on the pinned ffmpeg: an M4A whose
 * container reads 5.000 s decodes to 5.0155 s at 44.1 kHz, 5.0133 s at 48 kHz,
 * 5.0347 s at 24 kHz). A step that bills every started second of the decoded
 * audio with no grace (Lip Sync on OmniHuman 2.0) quotes such a recording one
 * AAC frame longer (decided 2026-11-14).
 */
const audio = (data: Record<string, unknown>) => ({ id: "a", type: "upload-audio", data })

describe("recordingDecodeOverhangSec", () => {
  it("an AAC recording: one frame at its recorded rate", () => {
    expect(recordingDecodeOverhangSec(audio({ url: "https://cdn.example/a.m4a", metadata: { durationSeconds: 5, codec: "aac", sampleRate: 48000 } }))).toBeCloseTo(1024 / 48000, 12)
    expect(recordingDecodeOverhangSec(audio({ url: "https://cdn.example/a.m4a", metadata: { durationSeconds: 5, codec: "aac", sampleRate: 44100 } }))).toBeCloseTo(1024 / 44100, 12)
  })

  it("an AAC recording whose rate was not recorded: a frame at the lowest rate AAC has, the longest frame", () => {
    expect(AAC_FRAME_SAMPLES).toBe(1024)
    expect(recordingDecodeOverhangSec(audio({ url: "https://cdn.example/a.m4a", metadata: { durationSeconds: 5, codec: "aac" } }))).toBeCloseTo(1024 / AAC_LOWEST_SAMPLE_RATE_HZ, 12)
  })

  it.each([
    ["an M4A", "https://cdn.example/a.m4a"],
    ["an MP4", "https://cdn.example/a.mp4"],
    ["a raw AAC", "https://cdn.example/a.aac?sig=1"],
  ])("a recording whose codec was not recorded, in %s container: one frame", (_what, url) => {
    expect(recordingDecodeOverhangSec(audio({ url, metadata: { durationSeconds: 5, sampleRate: 48000 } }))).toBeCloseTo(1024 / 48000, 12)
  })

  it("the container read from the file's type when the link names none", () => {
    expect(recordingDecodeOverhangSec(audio({ url: "https://cdn.example/blob", mimeType: "audio/mp4", metadata: { durationSeconds: 5, sampleRate: 48000 } }))).toBeCloseTo(1024 / 48000, 12)
  })

  it.each([
    ["an MP3 (codec recorded)", { url: "https://cdn.example/a.mp3", metadata: { durationSeconds: 5, codec: "mp3", sampleRate: 44100 } }],
    ["a WAV (codec recorded)", { url: "https://cdn.example/a.wav", metadata: { durationSeconds: 5, codec: "pcm_s16le", sampleRate: 44100 } }],
    ["an MP3 (codec not recorded)", { url: "https://cdn.example/a.mp3", metadata: { durationSeconds: 5 } }],
    ["a WAV (codec not recorded)", { url: "https://cdn.example/a.wav", metadata: { durationSeconds: 5 } }],
    ["a recording in an M4A whose recorded codec is not AAC (ALAC)", { url: "https://cdn.example/a.m4a", metadata: { durationSeconds: 5, codec: "alac" } }],
    ["a link that names no container", { url: "https://cdn.example/audio", metadata: { durationSeconds: 5 } }],
  ])("nothing for %s", (_what, data) => {
    expect(recordingDecodeOverhangSec(audio(data))).toBe(0)
  })

  it("a video upload: its recorded codec is the picture's, so its sound is read by its container", () => {
    const video = (url: string) => ({ id: "v", type: "upload-video", data: { url, metadata: { codec: "h264" }, generatedResults: [{ url, duration: 10 }] } })
    expect(recordingDecodeOverhangSec(video("https://cdn.example/v.mp4"))).toBeCloseTo(1024 / AAC_LOWEST_SAMPLE_RATE_HZ, 12)
    expect(recordingDecodeOverhangSec(video("https://cdn.example/v.webm"))).toBe(0)
  })

  it("never for a node that is not a recording", () => {
    expect(recordingDecodeOverhangSec({ type: "text-to-speech", data: { url: "https://cdn.example/t.m4a" } })).toBe(0)
  })
})

describe("the measured walk reads a recording at its decoded length only when asked (decodedAudioLength)", () => {
  // At 16 kHz a frame is 0.064 s: 0.014 s of it is past the 0.05 s the charge forgives (CLIP_PRICE_GRACE_SEC).
  const at16k = audio({ url: "https://cdn.example/a.m4a", metadata: { durationSeconds: 5, codec: "aac", sampleRate: 16000 } })
  const nodes = [at16k, { id: "ls", type: "lip-sync", data: {} }]
  const edges = [{ source: "a", target: "ls", targetHandle: "audio" }]
  const residual = 1024 / 16000 - 0.05
  it("asked: the frame past the charge's grace, carried through the steps after it", () => {
    expect(measuredWireLengthSec("a", nodes, edges, new Set(["ls"]), { plannedClipSlackSec: 0.1, decodedAudioLength: true })).toBeCloseTo(5 + residual, 12)
    const viaVoice = [...nodes, { id: "v", type: "voice-changer", data: {} }]
    const viaEdges = [{ source: "a", target: "v", targetHandle: "audio" }, { source: "v", target: "ls", targetHandle: "audio" }]
    expect(measuredWireLengthSec("v", viaVoice, viaEdges, new Set(["v", "ls"]), { plannedClipSlackSec: 0.1, decodedAudioLength: true })).toBeCloseTo(5 + residual + 0.1, 12)
  })
  it("a frame the charge already forgives (48 kHz: 0.021 s) adds nothing", () => {
    const at48k = [audio({ url: "https://cdn.example/a.m4a", metadata: { durationSeconds: 5, codec: "aac", sampleRate: 48000 } }), nodes[1]!]
    expect(measuredWireLengthSec("a", at48k, edges, new Set(["ls"]), { plannedClipSlackSec: 0.1, decodedAudioLength: true })).toBe(5)
  })
  it("not asked: the recorded length, as every other step reads it", () => {
    expect(measuredWireLengthSec("a", nodes, edges, new Set(["ls"]), { plannedClipSlackSec: 0.1 })).toBe(5)
  })
})
