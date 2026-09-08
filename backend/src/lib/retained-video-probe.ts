import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

/** Inspect a bounded, local copy only. Playlists, external URLs and MOV data
 * references cannot turn retention into a second download or filesystem reader. */
export async function probeRetainedVideo(body: Buffer): Promise<{
  width: number; height: number; durationMs: number; contentType: "video/mp4" | "video/webm"
}> {
  const dir = await mkdtemp(join(tmpdir(), "retained-video-"))
  try {
    const path = join(dir, "source")
    await writeFile(path, body, { flag: "wx", mode: 0o600 })
    const { stdout } = await promisify(execFile)("ffprobe", [
      "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm",
      "-show_entries", "format=format_name,duration:stream=codec_type,width,height,duration", "-of", "json", path,
    ], { timeout: 30_000, maxBuffer: 128 * 1024 })
    const parsed = JSON.parse(stdout) as {
      format?: { format_name?: string; duration?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>
    }
    const streams = parsed.streams?.filter((stream) => stream.codec_type === "video") ?? []
    const stream = streams[0], format = parsed.format?.format_name?.split(",") ?? []
    const width = stream?.width, height = stream?.height
    const durationMs = Math.round(Number(parsed.format?.duration ?? stream?.duration) * 1000)
    if (streams.length !== 1 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || !width || !height || width < 1 || height < 1 || width * height > 100_000_000
      || !Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 2_147_483_647) throw new Error("Unsupported retained video")
    const contentType = format.includes("mov") ? "video/mp4" : format.includes("webm") ? "video/webm" : undefined
    if (!contentType) throw new Error("Unsupported retained video container")
    return { width, height, durationMs, contentType }
  } finally { await rm(dir, { recursive: true, force: true }) }
}
