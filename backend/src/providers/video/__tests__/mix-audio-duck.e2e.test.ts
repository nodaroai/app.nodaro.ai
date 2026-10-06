/**
 * Real-ffmpeg e2e for Mix Audio ducking (mix-audio.ts): a music bed mixed with
 * a voice that speaks for a while and then stops must dip UNDER the voice and
 * come back after it — and must not be cut off when the voice track ends
 * before the bed does (`sidechaincompress` ends its output with its sidechain;
 * the pad in the graph is what stops that).
 *
 * The voice is an 880 Hz tone, the bed a 220 Hz tone, so the bed's own level
 * can be read inside the mix through a band-pass around 220 Hz.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ffmpegAvailable, mp3EncoderAvailable } from "./apply-edl-e2e-helpers.js"

// The provider downloads its inputs; here a "URL" is already a local path.
vi.mock("../ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ffmpeg-utils.js")>()),
  downloadFile: async (url: string, dest: string) => fs.copyFile(url, dest),
}))

import { runFfmpeg, runFfmpegCapture, getVideoDuration } from "../ffmpeg-utils.js"
import { mixAudio } from "../mix-audio.js"

/** Mean level (dBFS) of the 220 Hz bed inside `file` between `from` and `to` seconds. */
async function bedLevel(file: string, from: number, to: number): Promise<number> {
  const { stderr } = await runFfmpegCapture([
    "-hide_banner", "-ss", String(from), "-to", String(to), "-i", file,
    "-af", "bandpass=f=220:width_type=h:w=100,volumedetect", "-f", "null", "-",
  ])
  const m = stderr.match(/mean_volume: (-?[\d.]+) dB/)
  if (!m) throw new Error(`no mean_volume in: ${stderr.slice(-300)}`)
  return parseFloat(m[1])
}

describe.skipIf(!mp3EncoderAvailable)("mixAudio duck (e2e, real ffmpeg)", () => {
  let dir: string
  const p = (name: string) => join(dir, name)
  beforeAll(async () => {
    expect(ffmpegAvailable).toBe(true)
    dir = await fs.mkdtemp(join(tmpdir(), "mix-audio-duck-e2e-"))
    // Voice: speaks from 1 s to 3 s, then the file is silent up to 6 s — shorter than the bed.
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "sine=f=880:r=44100:d=2",
      "-af", "volume=4,adelay=1000:all=1,apad=whole_dur=6", p("voice.wav"),
    ])
    // Bed: 8 s of a steady tone.
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=f=220:r=44100:d=8", "-af", "volume=2", p("bed.wav")])
    // A voice file that ends right after it speaks (3 s), well before the bed.
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=f=880:r=44100:d=2", "-af", "volume=4,adelay=1000:all=1", p("voice-short.wav")])
  }, 60_000)
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}) })

  it("without duck the bed stays level through the voice (the control)", async () => {
    const out = await mixAudio({ audioUrls: [p("voice.wav"), p("bed.wav")] })
    // (Plain amix re-weights its remaining inputs once the 6 s voice file ends, so stop short of 6 s.)
    const speaking = await bedLevel(out, 1.5, 2.8)
    const after = await bedLevel(out, 4, 5.8)
    expect(Math.abs(speaking - after)).toBeLessThan(1)
  }, 60_000)

  it("pulls the bed down under the voice and restores it after", async () => {
    const plain = await mixAudio({ audioUrls: [p("voice.wav"), p("bed.wav")], sumTracks: true })
    const ducked = await mixAudio({ audioUrls: [p("voice.wav"), p("bed.wav")], duck: { under: 0 } })

    const bedFull = await bedLevel(plain, 5, 7.5)
    const bedUnderVoice = await bedLevel(ducked, 1.6, 2.8)
    const bedAfter = await bedLevel(ducked, 5, 7.5)
    const bedBefore = await bedLevel(ducked, 0.1, 0.8)

    // Attenuated under the voice: at least 10 dB down on the undisturbed bed …
    expect(bedFull - bedUnderVoice).toBeGreaterThan(10)
    // … and back at full level once the voice has stopped and the release has run.
    expect(Math.abs(bedFull - bedAfter)).toBeLessThan(1.5)
    // The bed is untouched before the voice starts.
    expect(Math.abs(bedFull - bedBefore)).toBeLessThan(1.5)
  }, 60_000)

  it("a harder `amount` dips the bed further", async () => {
    const soft = await mixAudio({ audioUrls: [p("voice.wav"), p("bed.wav")], duck: { under: 0, amount: 30 } })
    const hard = await mixAudio({ audioUrls: [p("voice.wav"), p("bed.wav")], duck: { under: 0, amount: 90 } })
    expect(await bedLevel(hard, 1.6, 2.8)).toBeLessThan(await bedLevel(soft, 1.6, 2.8) - 3)
  }, 60_000)

  it("does not cut the bed off when the voice track ends first", async () => {
    const out = await mixAudio({ audioUrls: [p("voice-short.wav"), p("bed.wav")], duck: { under: 0 } })
    expect(await getVideoDuration(out)).toBeGreaterThan(7.8)
    // And the bed is back to full level in the stretch the voice file no longer covers.
    const plain = await mixAudio({ audioUrls: [p("voice-short.wav"), p("bed.wav")], sumTracks: true })
    expect(Math.abs((await bedLevel(plain, 5, 7.5)) - (await bedLevel(out, 5, 7.5)))).toBeLessThan(1.5)
  }, 60_000)

  it("ducks every other track when there are three, leaving the key alone", async () => {
    const out = await mixAudio({ audioUrls: [p("bed.wav"), p("voice.wav"), p("bed.wav")], duck: { under: 1 } })
    const plain = await mixAudio({ audioUrls: [p("bed.wav"), p("voice.wav"), p("bed.wav")], sumTracks: true })
    expect((await bedLevel(plain, 1.6, 2.8)) - (await bedLevel(out, 1.6, 2.8))).toBeGreaterThan(10)
  }, 60_000)
})
