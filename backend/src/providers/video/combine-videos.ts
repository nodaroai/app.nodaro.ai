import { promises as fs } from "node:fs"
import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface CombineOptions {
  readonly videoUrls: readonly string[]
  readonly transition: "cut" | "fade" | "dissolve"
  readonly transitionDuration: number
}

export async function combineVideos(options: CombineOptions): Promise<string> {
  const { videoUrls, transition, transitionDuration } = options
  const workDir = await createWorkDir("combine")

  try {
    const inputPaths: string[] = []
    for (let i = 0; i < videoUrls.length; i++) {
      const inputPath = join(workDir, `input_${i}.mp4`)
      console.log(`[combineVideos] Downloading video ${i + 1}/${videoUrls.length}`)
      await downloadFile(videoUrls[i], inputPath)
      inputPaths.push(inputPath)
    }

    const outputPath = join(workDir, "output.mp4")

    if (transition === "cut") {
      const listPath = join(workDir, "filelist.txt")
      const listContent = inputPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
      await fs.writeFile(listPath, listContent)

      await runFfmpeg([
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listPath,
        "-c", "copy",
        outputPath,
      ])
    } else {
      const inputs: string[] = []
      for (let i = 0; i < inputPaths.length; i++) {
        inputs.push("-i", inputPaths[i])
      }

      if (inputPaths.length === 2) {
        const filterParts: string[] = [
          `[0:v][1:v]xfade=transition=${transition === "dissolve" ? "fade" : transition}:duration=${transitionDuration}:offset=0[outv]`,
          `[0:a][1:a]acrossfade=d=${transitionDuration}[outa]`,
        ]

        await runFfmpeg([
          "-y",
          ...inputs,
          "-filter_complex", filterParts.join(";"),
          "-map", "[outv]",
          "-map", "[outa]",
          "-c:v", "libx264",
          "-preset", "fast",
          outputPath,
        ]).catch(async () => {
          await runFfmpeg([
            "-y",
            ...inputs,
            "-filter_complex",
            `[0:v][1:v]xfade=transition=${transition === "dissolve" ? "fade" : transition}:duration=${transitionDuration}:offset=0[outv]`,
            "-map", "[outv]",
            "-c:v", "libx264",
            "-preset", "fast",
            "-an",
            outputPath,
          ])
        })
      } else {
        const listPath = join(workDir, "filelist.txt")
        const listContent = inputPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
        await fs.writeFile(listPath, listContent)

        await runFfmpeg([
          "-y",
          "-f", "concat",
          "-safe", "0",
          "-i", listPath,
          "-c", "copy",
          outputPath,
        ])
      }
    }

    console.log(`[combineVideos] Output: ${outputPath}`)
    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
