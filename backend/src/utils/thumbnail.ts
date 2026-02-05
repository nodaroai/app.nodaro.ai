import sharp from "sharp"
import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

// ============================================================
// Constants
// ============================================================

const THUMBNAIL_WIDTH = 320
const THUMBNAIL_HEIGHT = 320
const THUMBNAIL_QUALITY = 80

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
  const image = sharp(buffer)
  const meta = await image.metadata()

  const thumbnail = await sharp(buffer)
    .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: THUMBNAIL_QUALITY })
    .toBuffer()

  return {
    thumbnail,
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
        "-ss", String(timeSeconds),
        "-i", videoPath,
        "-vframes", "1",
        "-q:v", "3",
        outputPath,
      ],
      { maxBuffer: 5 * 1024 * 1024 },
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
  const framePath = join(workDir, "frame.jpg")

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

    // Extract frame at 1 second (or 0 if video is shorter)
    const seekTime = Math.min(1, durationSeconds * 0.1)
    await extractFrame(videoPath, framePath, seekTime)

    // Resize frame to thumbnail
    const frameBuffer = await fs.readFile(framePath)
    const thumbnail = await sharp(frameBuffer)
      .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: THUMBNAIL_QUALITY })
      .toBuffer()

    return {
      thumbnail,
      metadata: { width, height, durationSeconds, codec },
    }
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
