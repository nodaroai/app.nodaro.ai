import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

export async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download: ${url} (${response.status})`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(dest, buffer)
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

export async function createWorkDir(prefix: string): Promise<string> {
  const workDir = join(tmpdir(), `${prefix}-${randomUUID()}`)
  await fs.mkdir(workDir, { recursive: true })
  return workDir
}

export async function cleanupWorkDir(workDir: string): Promise<void> {
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
}
