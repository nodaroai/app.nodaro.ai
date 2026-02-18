import { execFile } from "node:child_process"
import { createWriteStream } from "node:fs"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

export async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) {
    throw new Error(`Failed to download: ${url} (${response.status})`)
  }
  const nodeStream = Readable.fromWeb(response.body as import("stream/web").ReadableStream)
  await pipeline(nodeStream, createWriteStream(dest))
}

export function runFfmpeg(args: readonly string[]): Promise<string> {
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

export function runFfprobe(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("ffprobe", args as string[], { maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`ffprobe failed: ${stderr || error.message}`))
      } else {
        resolve(stdout)
      }
    })
  })
}

export async function getVideoDuration(filePath: string): Promise<number> {
  const output = await runFfprobe([
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    filePath,
  ])
  const duration = parseFloat(output.trim())
  if (Number.isNaN(duration) || duration <= 0) {
    throw new Error(`Could not determine duration for: ${filePath}`)
  }
  return duration
}

export async function createWorkDir(prefix: string): Promise<string> {
  const workDir = join(tmpdir(), `${prefix}-${randomUUID()}`)
  await fs.mkdir(workDir, { recursive: true })
  return workDir
}

export async function cleanupWorkDir(workDir: string): Promise<void> {
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
}
