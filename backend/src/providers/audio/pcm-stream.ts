/**
 * The shared PCM stream: a local file's audio decoded to mono float samples at
 * 8 kHz (the speech band), high-passed at 120 Hz, streamed chunk by chunk under
 * a shared ffmpeg slot. Audio Sync correlates it; Speaker Map measures levels
 * on it. Moved out of audio-sync.ts unchanged.
 */
import { spawnFfmpeg } from "../video/ffmpeg-process.js"
import { ffmpegFailureMessage, withFfmpegSlot } from "../video/ffmpeg-utils.js"
import { INPUT_SEEK_MARGIN_SEC } from "../video/apply-edl-budget.js"

/** Every stream is decoded at this rate: speech lives below 4 kHz. */
export const PCM_SAMPLE_RATE = 8_000

/**
 * Stream a local file's audio as mono float PCM at 8 kHz (speech band) under a
 * shared ffmpeg slot, calling `onSamples` per chunk — so a 3-hour source never
 * sits in memory whole. `startSec`/`durationSec` seek to a window. `label`
 * names the decode in the slot's queue (the caller's step).
 */
export async function streamPcm(
  path: string,
  win: { readonly startSec?: number; readonly durationSec?: number },
  timeoutMs: number,
  onSamples: (x: Float32Array) => void,
  label: string,
): Promise<void> {
  // A window seeks like apply-edl does (INPUT_SEEK_MARGIN_SEC early), then
  // trims on DECODED timestamps: an AAC input (every media proxy is AAC) seeked
  // straight to the window start came back 2–9 ms off, and differently per seek,
  // while the same seek-then-trim puts the window on the clock the render reads.
  const start = Math.max(0, win.startSec ?? 0)
  const seek = Math.max(0, start - INPUT_SEEK_MARGIN_SEC)
  const trim = start > 0 || win.durationSec !== undefined
    ? `atrim=start=${(start - seek).toFixed(6)}${win.durationSec !== undefined ? `:duration=${win.durationSec.toFixed(6)}` : ""},asetpts=PTS-STARTPTS,`
    : ""
  const args = [
    "-hide_banner", "-nostats", "-v", "error",
    ...(seek > 0 ? ["-ss", seek.toFixed(3)] : []),
    "-i", path,
    "-vn", "-ac", "1", "-ar", String(PCM_SAMPLE_RATE), "-af", `${trim}highpass=f=120`,
    "-f", "f32le", "pipe:1",
  ]
  await withFfmpegSlot(() => new Promise<void>((resolve, reject) => {
    const proc = spawnFfmpeg(args, { stdio: ["ignore", "pipe", "pipe"] })
    let stderr = ""
    let carry = Buffer.alloc(0)
    const watchdog = setTimeout(() => proc.kill("SIGKILL"), timeoutMs)
    proc.stdout.on("data", (chunk: Buffer) => {
      const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk
      const whole = buf.length - (buf.length % 4)
      if (whole > 0) {
        const aligned = Buffer.from(buf.subarray(0, whole)) // own the bytes: 4-aligned for the view
        onSamples(new Float32Array(aligned.buffer, aligned.byteOffset, whole / 4))
      }
      carry = Buffer.from(buf.subarray(whole))
    })
    proc.stderr.on("data", (c: Buffer) => { stderr = (stderr + c.toString()).slice(-8_000) })
    proc.on("error", (err) => { clearTimeout(watchdog); reject(err) })
    proc.on("close", (code, signal) => {
      clearTimeout(watchdog)
      if (code === 0) resolve()
      else reject(new Error(ffmpegFailureMessage(stderr, signal ? `killed (${signal}) after ${timeoutMs} ms` : `exit ${code}`)))
    })
  }), { timeoutMs, label })
}
