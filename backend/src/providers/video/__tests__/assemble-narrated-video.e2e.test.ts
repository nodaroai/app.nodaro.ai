/**
 * Real-ffmpeg e2e test for the audio-led narrated-video assembler.
 *
 * DEVIATION from the task brief: the brief's Step 1 draft feeds `file://`
 * URLs into `assembleNarratedVideo({ blocks: [{ videoUrl, audioUrl }] })`.
 * `downloadFile` (ffmpeg-utils.ts) routes every URL through `safeFetch`
 * (lib/safe-fetch.ts), which throws on any non-http(s) protocol as a
 * deliberate SSRF guard — `file://` is rejected before any download is
 * attempted. Per the task's ambiguity resolution, the SSRF guard must NOT be
 * weakened for tests. No existing e2e ffmpeg test in this repo feeds local
 * fixtures through a local HTTP server (grepped `*.e2e.test.ts` under
 * `backend/src/providers` — none exist yet; `collage-layout.test.ts` only
 * covers pure layout math, not real ffmpeg). So this test exercises the
 * internal `assembleNarratedVideoFromLocalFiles` seam directly — the same
 * per-block fit/normalize/concat pipeline as `assembleNarratedVideo`, minus
 * the download step — which `assembleNarratedVideo` wraps with
 * `downloadFile` calls in the real implementation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { runFfmpeg, runFfprobe, getVideoDuration } from "../ffmpeg-utils.js"
import { assembleNarratedVideoFromLocalFiles } from "../assemble-narrated-video.js"

// Generates a solid-color silent clip and a sine-tone audio via ffmpeg lavfi.
async function makeClip(path: string, seconds: number, color: string) {
  await runFfmpeg(["-y", "-f", "lavfi", "-i", `color=c=${color}:s=320x240:d=${seconds}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", String(seconds), path])
}
// `opts.sampleRate`/`opts.channels` let a fixture simulate a TTS provider
// that returns audio at a non-standard rate (e.g. 24kHz mono) — the mix of
// rates across blocks (clip ambient / anullsrc @ 44100 / voice @ 24000) is
// exactly what the `-ar 44100 -ac 2` pin on the per-block encode (see
// assemble-narrated-video.ts::runBlockFit) exists to normalize before
// `-f concat -c copy` splices the block files together.
async function makeTone(path: string, seconds: number, opts?: { sampleRate?: number; channels?: number }) {
  const args = ["-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`]
  if (opts?.sampleRate) args.push("-ar", String(opts.sampleRate))
  if (opts?.channels) args.push("-ac", String(opts.channels))
  args.push("-c:a", "aac", "-t", String(seconds), path)
  await runFfmpeg(args)
}

// Probes a single stream's duration (in seconds), from CONTAINER metadata.
// Returns null when the stream doesn't exist (e.g. no audio track at all).
async function probeStreamDuration(path: string, selector: "a:0" | "v:0"): Promise<number | null> {
  const out = await runFfprobe([
    "-v", "error", "-select_streams", selector,
    "-show_entries", "stream=duration", "-of", "csv=p=0", path,
  ])
  const trimmed = out.trim()
  if (!trimmed) return null
  const val = parseFloat(trimmed)
  return Number.isNaN(val) ? null : val
}

// Decodes the audio track to raw PCM and measures its REAL duration.
// Required in addition to `probeStreamDuration`: when a MIDDLE block has no
// audio stream, ffmpeg's `-f concat` demuxer offsets the next segment's audio
// timestamps by that block's video duration (not by 0), so the container's
// declared audio stream duration ends up matching the video duration even
// though the actual decodable audio content is ~10s shorter (verified by hand
// against the pre-fix code: container `stream=duration` reported 31.03s/
// video vs 31.03s/audio — a clean false negative — while the decoded PCM was
// only 21.08s, i.e. concat silently dropped the audio-less block's span
// instead of leaving a gap). Returns null when there's no audio to decode.
async function probeDecodedAudioDuration(path: string, workDir: string): Promise<number | null> {
  const wavPath = join(workDir, `${randomUUID()}.wav`)
  try {
    await runFfmpeg(["-y", "-i", path, "-vn", "-acodec", "pcm_s16le", "-ar", "44100", wavPath])
  } catch {
    return null
  }
  try {
    const out = await runFfprobe([
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wavPath,
    ])
    const val = parseFloat(out.trim())
    return Number.isNaN(val) ? null : val
  } finally {
    await fs.rm(wavPath, { force: true }).catch(() => {})
  }
}

describe("assembleNarratedVideoFromLocalFiles (e2e)", () => {
  let dir: string
  beforeAll(async () => { dir = await fs.mkdtemp(join(tmpdir(), "anv-e2e-")) })
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}) })

  it("fits three blocks (pad, silent-passthrough MIDDLE, slow) and concatenates with uniform audio", async () => {
    // Block order is deliberate: the audio-less block sits in the MIDDLE.
    // With `-f concat -c copy`, a stream-less middle block corrupts audio
    // continuity for everything after it — this proves the fix handles that,
    // not just a trailing audio-less block.
    const clip1 = join(dir, "c1.mp4"); await makeClip(clip1, 10, "red")
    // 24kHz mono — simulates a TTS provider's native output rate, mixed in
    // alongside the 44100 anullsrc silence (block 2) and clip-ambient audio,
    // to prove the per-block -ar 44100 -ac 2 pin keeps the concat uniform.
    const voice1 = join(dir, "v1.m4a")
    await makeTone(voice1, 6, { sampleRate: 24000, channels: 1 })   // pad → block 10s
    const clip2 = join(dir, "c2.mp4"); await makeClip(clip2, 8, "blue") // silent passthrough, MIDDLE, 8s
    const clip3 = join(dir, "c3.mp4"); await makeClip(clip3, 10, "green")
    const voice3 = join(dir, "v3.m4a"); await makeTone(voice3, 13)  // slow → block 13s

    const out = await assembleNarratedVideoFromLocalFiles({
      blocks: [
        { videoPath: clip1, voicePath: voice1 },
        { videoPath: clip2 },
        { videoPath: clip3, voicePath: voice3 },
      ],
      trimEndFrames: 0, trimStartFrames: 0,
    })

    const total = await getVideoDuration(out)
    // 10 + 8 + 13 = 31s, allow ±1.5s for encoder/keyframe rounding
    expect(total).toBeGreaterThan(29.5)
    expect(total).toBeLessThan(32.5)

    // Core invariant under test: the final assembled file's audio stream
    // duration must track its video stream duration. A middle block with no
    // audio stream at all (the pre-fix bug) corrupts audio continuity for
    // everything after it once `-c copy` concatenates it in.
    const videoDur = await probeStreamDuration(out, "v:0")
    const audioDurContainer = await probeStreamDuration(out, "a:0")
    expect(videoDur).not.toBeNull()
    expect(audioDurContainer).not.toBeNull() // fails pre-fix if EVERY block ends up audio-less

    // The container-declared duration can itself be misleading around a
    // stream-less middle block (see probeDecodedAudioDuration's comment) —
    // decode to PCM for the real, authoritative content duration.
    const audioDurDecoded = await probeDecodedAudioDuration(out, dir)
    expect(audioDurDecoded).not.toBeNull()
    expect(Math.abs((audioDurDecoded as number) - (videoDur as number))).toBeLessThan(0.5)

    await fs.rm(out, { force: true }).catch(() => {})
  }, 120_000)
})
