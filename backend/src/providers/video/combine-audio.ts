import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface AudioSegment {
  readonly url: string
  readonly startTime?: number  // seconds, optional
  readonly endTime?: number    // seconds, optional
}

interface CombineAudioOptions {
  readonly segments: readonly AudioSegment[]
}

export async function combineAudio(options: CombineAudioOptions): Promise<string> {
  const { segments } = options
  if (segments.length === 0) throw new Error("No audio segments provided")

  const workDir = await createWorkDir("combine-audio")
  try {
    // Download all segments
    const audioPaths: string[] = []
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const ext = seg.url.includes(".wav") ? "wav" : "mp3"
      const rawPath = join(workDir, `raw_${i}.${ext}`)
      const trimPath = join(workDir, `seg_${i}.wav`)
      console.log(`[combineAudio] Downloading segment ${i}: ${seg.url}`)
      await downloadFile(seg.url, rawPath)

      // Trim if startTime or endTime specified
      const trimArgs: string[] = ["-y", "-i", rawPath]
      if (seg.startTime != null && seg.startTime > 0) {
        trimArgs.push("-ss", String(seg.startTime))
      }
      if (seg.endTime != null) {
        trimArgs.push("-to", String(seg.endTime))
      }
      trimArgs.push("-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", trimPath)
      await runFfmpeg(trimArgs)
      audioPaths.push(trimPath)
    }

    // Write concat list file
    const listPath = join(workDir, "list.txt")
    const { writeFile } = await import("node:fs/promises")
    const listContent = audioPaths.map((p) => `file '${p}'`).join("\n")
    await writeFile(listPath, listContent, "utf-8")

    const outputPath = join(workDir, "output.mp3")
    await runFfmpeg([
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c:a", "libmp3lame",
      "-q:a", "2",
      outputPath,
    ])

    console.log(`[combineAudio] Output: ${outputPath}`)
    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
