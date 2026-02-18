import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface MixAudioOptions {
  readonly audioUrls: readonly string[]
  readonly trackVolumes?: readonly number[]
}

export async function mixAudio(options: MixAudioOptions): Promise<string> {
  const { audioUrls, trackVolumes } = options
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
    const filterComplex = [
      ...volumeParts,
      `${mixInputs}amix=inputs=${inputPaths.length}:duration=longest[aout]`,
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
