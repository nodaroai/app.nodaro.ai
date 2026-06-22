import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface MixAudioOptions {
  readonly audioUrls: readonly string[]
  readonly trackVolumes?: readonly number[]
  /**
   * When true, the final `amix` uses `normalize=0` so the inputs are SUMMED
   * rather than averaged (ffmpeg's default divides every input by N, which
   * attenuates each track by ~−6dB for 2 inputs). Use this when the tracks are
   * time-disjoint or volume-controlled and must retain their leveled loudness
   * (e.g. voice-recast: per-speaker stems are silence elsewhere, so summing
   * reconstructs the original level). Default false = back-compat averaging.
   */
  readonly sumTracks?: boolean
}

export async function mixAudio(options: MixAudioOptions): Promise<string> {
  const { audioUrls, trackVolumes, sumTracks = false } = options
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
    const filterComplex = [
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
