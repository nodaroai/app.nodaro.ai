import sharp from "sharp"
import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

// ============================================================
// Types
// ============================================================

export interface ImageMetadata {
  readonly width: number
  readonly height: number
  readonly format: string
}

export interface VideoMetadata {
  readonly width: number
  readonly height: number
  readonly durationSeconds: number
  readonly codec: string
}

export interface AudioMetadata {
  readonly durationSeconds: number
  readonly codec: string
  readonly sampleRate: number
}

export type FileMetadata = ImageMetadata | VideoMetadata | AudioMetadata

// ============================================================
// Image Thumbnail & Metadata
// ============================================================

/**
 * Generate a thumbnail for an image and extract metadata
 */
export async function processImage(
  buffer: Buffer,
): Promise<{ thumbnail: Buffer; metadata: ImageMetadata }> {
  const meta = await sharp(buffer).metadata()

  return {
    thumbnail: buffer,
    metadata: {
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      format: meta.format ?? "unknown",
    },
  }
}

// ============================================================
// Video Thumbnail & Metadata
// ============================================================

/**
 * Run ffprobe to extract video metadata
 */
function runFfprobe(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      [
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        filePath,
      ],
      { maxBuffer: 5 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`ffprobe failed: ${stderr || error.message}`))
        } else {
          resolve(stdout)
        }
      },
    )
  })
}

/**
 * Extract a single frame from a video at a given timestamp
 */
function extractFrame(videoPath: string, outputPath: string, timeSeconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-y",
        "-i", videoPath,
        "-ss", String(timeSeconds),
        "-vframes", "1",
        outputPath,
      ],
      { maxBuffer: 10 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`ffmpeg frame extraction failed: ${stderr || error.message}`))
        } else {
          resolve()
        }
      },
    )
  })
}

/**
 * Generate a thumbnail for a video and extract metadata
 */
export async function processVideo(
  buffer: Buffer,
): Promise<{ thumbnail: Buffer; metadata: VideoMetadata }> {
  const workDir = join(tmpdir(), `upload-video-${randomUUID()}`)
  await fs.mkdir(workDir, { recursive: true })

  const videoPath = join(workDir, "input.mp4")
  const framePath = join(workDir, "frame.png")

  try {
    await fs.writeFile(videoPath, buffer)

    // Extract metadata with ffprobe
    const probeJson = await runFfprobe(videoPath)
    const probe = JSON.parse(probeJson)

    const videoStream = (probe.streams ?? []).find(
      (s: Record<string, unknown>) => s.codec_type === "video"
    )

    const durationSeconds = parseFloat(probe.format?.duration ?? "0")
    const width = videoStream?.width ?? 0
    const height = videoStream?.height ?? 0
    const codec = videoStream?.codec_name ?? "unknown"

    // Extract the very first frame at original resolution (lossless PNG)
    await extractFrame(videoPath, framePath, 0)

    return {
      thumbnail: await fs.readFile(framePath),
      metadata: { width, height, durationSeconds, codec },
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Generate a thumbnail from a video URL (downloads, extracts first frame).
 * Stored at original resolution as JPEG — Cloudflare Image Resizing handles downsizing on the edge.
 */
export async function generateThumbnailFromUrl(videoUrl: string): Promise<Buffer> {
  const workDir = join(tmpdir(), `thumb-gen-${randomUUID()}`)
  await fs.mkdir(workDir, { recursive: true })

  const videoPath = join(workDir, "input.mp4")
  const framePath = join(workDir, "frame.png")

  try {
    // Download video to temp file
    const response = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`Failed to download video: ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(videoPath, buffer)

    // Extract the very first frame at original resolution (lossless PNG)
    await extractFrame(videoPath, framePath, 0)

    return await fs.readFile(framePath)
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ============================================================
// Audio Metadata (no thumbnail)
// ============================================================

/**
 * Extract audio metadata (duration, codec, sample rate)
 */
export async function processAudio(
  buffer: Buffer,
): Promise<{ metadata: AudioMetadata }> {
  const workDir = join(tmpdir(), `upload-audio-${randomUUID()}`)
  await fs.mkdir(workDir, { recursive: true })

  const audioPath = join(workDir, "input.bin")

  try {
    await fs.writeFile(audioPath, buffer)

    const probeJson = await runFfprobe(audioPath)
    const probe = JSON.parse(probeJson)

    const audioStream = (probe.streams ?? []).find(
      (s: Record<string, unknown>) => s.codec_type === "audio"
    )

    return {
      metadata: {
        durationSeconds: parseFloat(probe.format?.duration ?? "0"),
        codec: audioStream?.codec_name ?? "unknown",
        sampleRate: parseInt(audioStream?.sample_rate ?? "0", 10),
      },
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
