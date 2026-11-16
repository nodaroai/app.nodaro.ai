import { describe, it, expect, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({
  probe: vi.fn(),
  download: vi.fn(),
  runFfmpeg: vi.fn(),
  decode: vi.fn(),
  upload: vi.fn(),
}))

vi.mock("../../video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeMediaFormatAndDuration: m.probe,
  downloadFile: m.download,
  runFfmpeg: m.runFfmpeg,
  createWorkDir: async () => "/tmp/ref-audio-convert-test",
  cleanupWorkDir: async () => undefined,
}))
vi.mock("../../video/decoded-audio-length.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  decodeAudioToPcm: m.decode,
}))
vi.mock("../../../lib/job-scratch.js", () => ({ uploadJobScratchFile: m.upload }))

import { convertsReferenceAudio, prepareReferenceAudioUrls } from "../reference-audio-convert.js"

const MP3 = "https://cdn.example.com/a.mp3"
const M4A = "https://cdn.example.com/b.m4a"

beforeEach(() => {
  vi.clearAllMocks()
  m.download.mockResolvedValue(undefined)
  m.runFfmpeg.mockResolvedValue(undefined)
  m.decode.mockResolvedValue({ overCap: false, samples: 441_000, seconds: 10 })
  m.upload.mockResolvedValue("https://scratch.example.com/converted.mp3")
})

/**
 * Seedance 2.5 Flash takes reference audio as WAV or MP3; any other clip is
 * converted to MP3 before it is sent (decided 2026-11-16). Every other model's
 * audio goes as it came.
 */
describe("reference audio conversion", () => {
  it("converts only on a model whose rule says so", () => {
    expect(convertsReferenceAudio("seedance-2-5-flash")).toBe(true)
    expect(convertsReferenceAudio("seedance-2-5")).toBe(false)
    expect(convertsReferenceAudio("vidu-q4")).toBe(false)
  })

  it("sends a WAV or MP3 clip as it came, and converts any other one to MP3 in the job's scratch folder", async () => {
    m.probe.mockImplementation(async (url: string) => (url === MP3 ? { formatNames: ["mp3"] } : { formatNames: ["mov", "mp4", "m4a"] }))
    const sent = await prepareReferenceAudioUrls("seedance-2-5-flash", [MP3, M4A])
    expect(sent).toEqual([MP3, "https://scratch.example.com/converted.mp3"])
    expect(m.download).toHaveBeenCalledTimes(1)
    expect(m.download.mock.calls[0]![0]).toBe(M4A)
    expect(m.upload).toHaveBeenCalledWith(expect.stringMatching(/converted\.mp3$/), "provider-audio-converted", "mp3", "audio/mpeg")
    const args = m.runFfmpeg.mock.calls[0]![0] as string[]
    expect(args.at(-1)).toMatch(/converted\.mp3$/)
  })

  it("never touches another model's audio", async () => {
    const sent = await prepareReferenceAudioUrls("seedance-2-5", [M4A])
    expect(sent).toEqual([M4A])
    expect(m.probe).not.toHaveBeenCalled()
  })

  it("a clip that cannot be decoded fails the run (sanitized), never sent as it came", async () => {
    m.probe.mockResolvedValue({ formatNames: ["ogg"] })
    m.decode.mockResolvedValue(undefined)
    await expect(prepareReferenceAudioUrls("seedance-2-5-flash", [M4A])).rejects.toThrow(/Video generation failed/)
    expect(m.upload).not.toHaveBeenCalled()
  })

  it("a probe that cannot run is never trusted: even an .mp3 address is converted", async () => {
    m.probe.mockRejectedValue(new Error("ffprobe failed"))
    expect(await prepareReferenceAudioUrls("seedance-2-5-flash", [MP3])).toEqual(["https://scratch.example.com/converted.mp3"])
    expect(m.download).toHaveBeenCalledTimes(1)
  })

  it("a converted clip outside 2-30 s, or past the decode cap, fails the run and is never sent", async () => {
    m.probe.mockResolvedValue({ formatNames: ["ogg"] })
    for (const decoded of [{ overCap: true }, { overCap: false, samples: 44_100 * 31, seconds: 31 }, { overCap: false, samples: 44_100, seconds: 1 }]) {
      m.upload.mockClear()
      m.decode.mockResolvedValue(decoded)
      await expect(prepareReferenceAudioUrls("seedance-2-5-flash", [M4A])).rejects.toThrow(/Video generation failed/)
      expect(m.upload).not.toHaveBeenCalled()
    }
  })
})
