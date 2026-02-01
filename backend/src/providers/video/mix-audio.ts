import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface MixAudioOptions {
  readonly audioUrls: readonly string[]
}

export async function mixAudio(options: MixAudioOptions): Promise<string> {
  const { audioUrls } = options
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

    await runFfmpeg([
      "-y",
      ...inputs,
      "-filter_complex", `amix=inputs=${inputPaths.length}:duration=longest`,
      outputPath,
    ])

    console.log(`[mixAudio] Output: ${outputPath}`)
    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
