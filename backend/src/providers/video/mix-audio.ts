import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"
import { resolveDuck, type MixAudioDuck, type ResolvedDuck } from "../../lib/mix-audio-duck.js"

interface MixAudioOptions {
  readonly audioUrls: readonly string[]
  readonly trackVolumes?: readonly number[]
  /**
   * When true, the final `amix` uses `normalize=0` so the inputs are SUMMED
   * rather than averaged (ffmpeg's default divides every input by N, which
   * attenuates each track by ~−6dB for 2 inputs). Use this when the tracks are
   * time-disjoint or volume-controlled and must retain their leveled loudness
   * (e.g. voice-changer-pro: per-speaker stems are silence elsewhere, so summing
   * reconstructs the original level). Default false = back-compat averaging.
   */
  readonly sumTracks?: boolean
  /**
   * Ducking: every track EXCEPT `duck.under` dips whenever track `under` is
   * loud (sidechain compression) and rises back in its pauses — a music bed
   * under speech. The duck path always sums (`normalize=0`) behind the same
   * brickwall limiter as `sumTracks`: averaging would halve the voice the bed
   * is supposed to sit under. Without `duck` the graph is unchanged.
   */
  readonly duck?: MixAudioDuck
}

/** The linear amplitude `sidechaincompress` takes for a threshold in dBFS. */
function thresholdLinear(db: number): number {
  return Number(Math.pow(10, db / 20).toFixed(6))
}

/**
 * The ducked mix: the key track feeds the mix as itself AND, padded, the
 * sidechain of one compressor per other track. The pad is load-bearing —
 * `sidechaincompress` ends its output when the sidechain ends, so a key that
 * stops before the bed would otherwise cut the bed off with it.
 */
function duckedGraph(trackCount: number, volumeParts: string[], duck: ResolvedDuck): string {
  const key = duck.under
  const others: number[] = []
  for (let i = 0; i < trackCount; i++) if (i !== key) others.push(i)

  const compress = `threshold=${thresholdLinear(duck.thresholdDb)}:ratio=${duck.ratio}:attack=${duck.attackMs}:release=${duck.releaseMs}:makeup=1`
  const sidechainLabels = others.map((_, j) => `[s${key}_${j}]`).join("")
  const parts = [
    ...volumeParts,
    `[a${key}]asplit=${1 + others.length}[k${key}]${sidechainLabels}`,
    ...others.flatMap((i, j) => [
      `[s${key}_${j}]apad[p${key}_${j}]`,
      `[a${i}][p${key}_${j}]sidechaincompress=${compress}[d${i}]`,
    ]),
  ]
  // Mix inputs stay in the caller's track order, so the output keeps the
  // format of the first track exactly as the plain mix does.
  const mixInputs = Array.from({ length: trackCount }, (_, i) => (i === key ? `[k${i}]` : `[d${i}]`)).join("")
  return [
    ...parts,
    `${mixInputs}amix=inputs=${trackCount}:duration=longest:normalize=0,alimiter=level=disabled:limit=0.95[aout]`,
  ].join(";")
}

export async function mixAudio(options: MixAudioOptions): Promise<string> {
  const { audioUrls, trackVolumes, sumTracks = false, duck } = options
  if (duck && (duck.under < 0 || duck.under >= audioUrls.length)) {
    throw new Error(`mixAudio: duck.under (${duck.under}) is not one of the ${audioUrls.length} input tracks`)
  }
  const workDir = await createWorkDir("mix-audio")

  try {
    const inputPaths: string[] = []
    for (let i = 0; i < audioUrls.length; i++) {
      const ext = audioUrls[i].includes(".wav") ? "wav" : audioUrls[i].includes(".aac") ? "aac" : "mp3"
      const inputPath = join(workDir, `input_${i}.${ext}`)
      console.log(`[mixAudio] Downloading audio ${i + 1}/${audioUrls.length}`)
      await downloadFile(audioUrls[i], inputPath)
      inputPaths.push(inputPath)
    }

    const outputPath = join(workDir, "output.mp3")
    const inputs: string[] = []
    for (const p of inputPaths) {
      inputs.push("-i", p)
    }

    const volumeParts = inputPaths.map((_, i) => {
      const vol = (trackVolumes?.[i] ?? 100) / 100
      return `[${i}:a]volume=${vol}[a${i}]`
    })
    const mixInputs = inputPaths.map((_, i) => `[a${i}]`).join("")
    const amix = `amix=inputs=${inputPaths.length}:duration=longest${sumTracks ? ":normalize=0" : ""}`
    // Summing (normalize=0) can push peaks past 0 dBFS; a transparent brickwall
    // limiter (level=disabled → no make-up gain) caps clipping peaks without
    // touching quieter audio. Only applied on the sum path.
    const limit = sumTracks ? ",alimiter=level=disabled:limit=0.95" : ""
    const filterComplex = duck
      ? duckedGraph(inputPaths.length, volumeParts, resolveDuck(duck))
      : [
          ...volumeParts,
          `${mixInputs}${amix}${limit}[aout]`,
        ].join(";")

    await runFfmpeg([
      "-y",
      ...inputs,
      "-filter_complex", filterComplex,
      "-map", "[aout]",
      outputPath,
    ])

    console.log(`[mixAudio] Output: ${outputPath}`)
    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
