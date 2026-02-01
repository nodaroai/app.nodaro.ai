import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

interface CombineOptions {
  readonly videoUrls: readonly string[]
  readonly transition: "cut" | "fade" | "dissolve"
  readonly transitionDuration: number
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download: ${url} (${response.status})`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(dest, buffer)
}

function runFfmpeg(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args as string[], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`ffmpeg failed: ${stderr || error.message}`))
      } else {
        resolve(stdout)
      }
    })
  })
}

export async function combineVideos(options: CombineOptions): Promise<string> {
  const { videoUrls, transition, transitionDuration } = options
  const workDir = join(tmpdir(), `combine-${randomUUID()}`)
  await fs.mkdir(workDir, { recursive: true })

  try {
    // Download all videos
    const inputPaths: string[] = []
    for (let i = 0; i < videoUrls.length; i++) {
      const inputPath = join(workDir, `input_${i}.mp4`)
      console.log(`[combineVideos] Downloading video ${i + 1}/${videoUrls.length}`)
      await downloadFile(videoUrls[i], inputPath)
      inputPaths.push(inputPath)
    }

    const outputPath = join(workDir, "output.mp4")

    if (transition === "cut") {
      // Simple concatenation using concat demuxer
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
      // For fade/dissolve, re-encode with crossfade filter
      // Build filter complex for crossfade between each pair
      const filterParts: string[] = []
      const inputs: string[] = []

      for (let i = 0; i < inputPaths.length; i++) {
        inputs.push("-i", inputPaths[i])
      }

      if (inputPaths.length === 2) {
        filterParts.push(
          `[0:v][1:v]xfade=transition=${transition === "dissolve" ? "fade" : transition}:duration=${transitionDuration}:offset=0[outv]`
        )
        // For audio, crossfade if present
        filterParts.push(
          `[0:a][1:a]acrossfade=d=${transitionDuration}[outa]`
        )

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
          // Retry without audio crossfade (some videos may not have audio)
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
        // For 3+ videos with transitions, fall back to simple concat
        // (complex xfade chains are fragile)
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
    // Cleanup on error
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}
