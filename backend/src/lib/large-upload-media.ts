// @reads-none reads only the stored object (through a link) and the frame it writes to a temp work dir
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { cleanupWorkDir, createWorkDir, readProbeSource, ProbeSourceBlockedError } from "../providers/video/ffmpeg-utils.js"
import { runFfmpegReadingLinks } from "../providers/video/ffmpeg-reading-links.js"
import { r2Url } from "./storage.js"
import type { FileMetadata } from "../utils/thumbnail.js"

/**
 * What the large-upload lane (`routes/large-upload.ts`) learns about a file it
 * never held: the object is read where it lies — ffprobe and ffmpeg reach it
 * through a short-lived presigned GET, read through the probe guard like any
 * link — and only the header (and one frame) is fetched, never the whole file.
 */

/** One reading of the stored object: its length and the metadata `/v1/upload` records. */
export interface StoredMediaReading {
  /** Container duration (seconds); absent when the file does not declare one. */
  readonly durationSec?: number
  readonly metadata: FileMetadata
}

interface ProbeJson {
  readonly format?: { readonly duration?: string }
  readonly streams?: ReadonlyArray<{
    readonly codec_type?: string
    readonly codec_name?: string
    readonly width?: number
    readonly height?: number
    readonly sample_rate?: string
  }>
}

/** Parse one ffprobe JSON answer into a reading (exported for the unit test). */
export function parseStoredMediaProbe(json: string, category: "video" | "audio"): StoredMediaReading {
  const probe = JSON.parse(json) as ProbeJson
  const duration = parseFloat(probe.format?.duration ?? "")
  const durationSec = Number.isFinite(duration) && duration > 0 ? duration : undefined
  const streams = probe.streams ?? []
  if (category === "video") {
    const video = streams.find((s) => s.codec_type === "video")
    return {
      ...(durationSec !== undefined ? { durationSec } : {}),
      metadata: { width: video?.width ?? 0, height: video?.height ?? 0, durationSeconds: durationSec ?? 0, codec: video?.codec_name ?? "unknown" },
    }
  }
  const audio = streams.find((s) => s.codec_type === "audio")
  return {
    ...(durationSec !== undefined ? { durationSec } : {}),
    metadata: { durationSeconds: durationSec ?? 0, codec: audio?.codec_name ?? "unknown", sampleRate: parseInt(audio?.sample_rate ?? "0", 10) || 0 },
  }
}

async function probeOnce(src: string): Promise<string> {
  return readProbeSource(src, (input, probe) =>
    probe.run([
      "-v", "error",
      ...probe.inputArgs,
      "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,sample_rate",
      "-of", "json",
      input,
    ]),
  )
}

/**
 * Probe the stored object. Read through `readUrl` (the presigned GET); when
 * the guard refuses that address — a self-host whose storage endpoint is on a
 * private network — through the public storage URL instead, which the guard's
 * own-storage rule reads (a local copy of at most 2 GB). Throws when neither
 * can be read.
 */
export async function readStoredMedia(key: string, readUrl: string, category: "video" | "audio"): Promise<StoredMediaReading> {
  let json: string
  try {
    json = await probeOnce(readUrl)
  } catch (err) {
    if (!(err instanceof ProbeSourceBlockedError)) throw err
    json = await probeOnce(r2Url(key))
  }
  return parseStoredMediaProbe(json, category)
}

/** The first frame of the stored video as a PNG, read from `readUrl` through the probe guard. */
export async function storedVideoPoster(readUrl: string): Promise<Buffer> {
  const dir = await createWorkDir("large-upload-poster")
  try {
    const out = join(dir, "frame.png")
    await runFfmpegReadingLinks(["-y", "-i", readUrl, "-frames:v", "1", out])
    return await fs.readFile(out)
  } finally {
    await cleanupWorkDir(dir)
  }
}
