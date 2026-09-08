import { createWriteStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createWorkDir, cleanupWorkDir, runFfmpeg } from "../providers/video/ffmpeg-utils.js"
import { boundedPublicChunks } from "./safe-fetch-bytes.js"

/** Capture a source the caller has already authorized. Downloads are public
 * HTTP only, streamed to disk under the normal 500 MiB video-upload ceiling.
 * No job, credits or storage write occurs here; retainImage polices the result. */
export async function readPublicVideoFrame(input: { videoUrl: string; timeSec: number }): Promise<Buffer> {
  if (!Number.isFinite(input.timeSec) || input.timeSec < 0) throw new Error("Invalid source frame timestamp")
  const directory = await createWorkDir("retained-source-frame")
  try {
    const source = join(directory, "source-video")
    const output = join(directory, "frame.png")
    await pipeline(Readable.from(boundedPublicChunks(input.videoUrl, {
      maxBytes: 500 * 1024 * 1024, timeoutMs: 120_000, label: "Video",
    })), createWriteStream(source, { flags: "wx", mode: 0o600 }))
    // Container allowlisting excludes playlists/concat scripts; ffmpeg cannot
    // follow a malicious media file into network protocols or remote manifests.
    // MOV external data references remain disabled (the demuxer's default).
    await runFfmpeg([
      "-y", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,avi",
      "-max_pixels", "100000000", "-ss", String(input.timeSec), "-i", source,
      "-map", "0:v:0", "-an", "-sn", "-dn", "-frames:v", "1", "-c:v", "png", "-update", "1", output,
    ], 60_000)
    const size = (await stat(output)).size
    if (!size || size > 25 * 1024 * 1024) throw new Error("The extracted frame exceeds the image size limit")
    return await readFile(output)
  } finally { await cleanupWorkDir(directory) }
}
