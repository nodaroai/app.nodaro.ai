import type { NodaroClient } from "../client.js"

/**
 * Media ingestion + trimming — the source-preparation steps a Voice Changer Pro
 * flow (or any pipeline) needs before it has a clip to work on: pull a social
 * video into storage, copy a remote URL into storage, trim a video/audio to a
 * range, and probe a video's metadata. Each generation-style op returns a job id
 * to poll (`jobs.get(jobId)`); `videoMetadata` is a direct read.
 */
export class MediaResource {
  constructor(private client: NodaroClient) {}

  /**
   * Download a social video (YouTube / TikTok / Instagram / X / Facebook) into
   * your storage (`POST /v1/download-video`). `maxHeight` caps the resolution
   * (default "best"); `sectionStartSec` + `sectionEndSec` (both-or-neither) fetch
   * ONLY that time range instead of the whole video. Returns a `downloadId`;
   * progress streams from `GET /v1/download-video/progress/:downloadId`
   * (server-sent events) and the finished file lands in your library.
   */
  downloadVideo(input: {
    url: string
    maxHeight?: number
    sectionStartSec?: number
    sectionEndSec?: number
  }): Promise<{ downloadId: string }> {
    return this.client.request<{ downloadId: string }>("POST", "/v1/download-video", { body: input })
  }

  /**
   * Copy an external media URL into your Nodaro storage (`POST /v1/save-to-storage`)
   * — a server-side fetch, so nothing round-trips through the client. Poll
   * `jobs.get(jobId)`.
   */
  saveToStorage(input: { mediaUrl: string; filename?: string; mediaType?: "image" | "video" | "audio" }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/save-to-storage", { body: input })
  }

  /**
   * Trim a video to a range (`POST /v1/trim-video`). Give the range in whichever
   * unit fits: `startTime`/`endTime` seconds, `trim*Frames`, `trim*Seconds`, or
   * `keepFirst`/`keepLastSeconds`. Poll `jobs.get(jobId)`.
   */
  trimVideo(input: {
    videoUrl: string
    startTime?: number
    endTime?: number
    trimStartFrames?: number
    trimEndFrames?: number
    trimStartSeconds?: number
    trimEndSeconds?: number
    keepFirstSeconds?: number
    keepLastSeconds?: number
  }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/trim-video", { body: input })
  }

  /**
   * Trim (and extract) audio from a video or audio source
   * (`POST /v1/trim-audio`) to `[startTime, endTime]` seconds, in `audioFormat`
   * (`mp3` default / `wav` / `aac`). Poll `jobs.get(jobId)`.
   */
  trimAudio(input: {
    videoUrl?: string
    audioUrl?: string
    audioFormat?: "mp3" | "wav" | "aac"
    startTime?: number
    endTime?: number
  }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/trim-audio", { body: input })
  }

  /**
   * Probe a social video's metadata (`POST /v1/video-metadata`) — duration,
   * dimensions, title, live status — WITHOUT downloading it. A direct read, not a
   * job. Use it to decide whether to trim before importing.
   */
  videoMetadata(input: { url: string }): Promise<VideoMetadata> {
    return this.client.request<VideoMetadata>("POST", "/v1/video-metadata", { body: input })
  }
}

/** Result of {@link MediaResource.videoMetadata}. Fields are best-effort — a probe may omit some. */
export interface VideoMetadata {
  durationSec?: number | null
  width?: number | null
  height?: number | null
  title?: string | null
  isLive?: boolean
  [key: string]: unknown
}
