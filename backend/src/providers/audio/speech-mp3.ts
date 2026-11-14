// @reads-none reads only the MP3 it encodes into a work dir
import { promises as fs } from "node:fs"
import { join } from "node:path"
import type { TtsOutputFormat } from "@nodaro/shared/models"
import { runFfmpeg, createWorkDir, cleanupWorkDir } from "../video/ffmpeg-utils.js"

/**
 * The MP3 each MP3 speech format names (`codec_samplerate_bitrate`): 44.1 kHz
 * at a constant 128 or 192 kbit/s — what the ElevenLabs models deliver for
 * the same request, so a speech model that renders WAV (Gemini, on KIE) hands
 * back the same file. The channel count is the source's (mono).
 */
const MP3_BITRATES: Readonly<Partial<Record<TtsOutputFormat, string>>> = {
  mp3_44100_128: "128k",
  mp3_44100_192: "192k",
}

/** Whether `format` is an MP3 the converter makes; false for `wav_24000` (passed through as rendered). */
export function isMp3SpeechFormat(format: TtsOutputFormat): boolean {
  return Object.hasOwn(MP3_BITRATES, format)
}

/**
 * Encode a WAV as the MP3 `format` names. ffmpeg through the shared runner
 * (its slot and memory admission); the work dir is removed either way.
 */
export async function wavToMp3(wav: Buffer, format: TtsOutputFormat): Promise<Buffer> {
  const bitrate = MP3_BITRATES[format]
  if (!bitrate) throw new Error(`${format} is not an MP3 speech format`)
  const workDir = await createWorkDir("speech-mp3")
  try {
    const input = join(workDir, "speech.wav")
    const output = join(workDir, "speech.mp3")
    await fs.writeFile(input, wav)
    await runFfmpeg(["-y", "-i", input, "-vn", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", bitrate, output])
    return await fs.readFile(output)
  } finally {
    await cleanupWorkDir(workDir)
  }
}
