import type { NodaroClient } from "../client.js"
import { NodaroError, throwFromResponse } from "../errors.js"

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
   * Stream the live progress of a {@link MediaResource.downloadVideo} import
   * (`GET /v1/download-video/progress/:downloadId`, server-sent events) as an
   * async iterable. Yields a {@link DownloadVideoProgress} roughly every 500ms
   * until the download reaches `completed` (its event carries the stored
   * `videoUrl`) or `failed` (its event carries `error`), then ends. The progress
   * state expires server-side shortly after the download starts existing, so
   * start iterating promptly after `downloadVideo` returns.
   *
   * No request timeout is applied (a large import legitimately takes minutes) —
   * pass an `AbortSignal` to cancel from the caller.
   */
  async *downloadVideoProgress(
    downloadId: string,
    opts: { signal?: AbortSignal } = {},
  ): AsyncGenerator<DownloadVideoProgress, void, undefined> {
    const url = `${this.client.baseUrl}/v1/download-video/progress/${encodeURIComponent(downloadId)}`
    const token = await this.client.auth.getToken()
    const res = await this.client.fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: opts.signal,
    })
    if (!res.ok) {
      let errBody: Record<string, unknown> = {}
      try {
        errBody = (await res.json()) as Record<string, unknown>
      } catch {
        // Empty/non-JSON body — fall through with empty errBody
      }
      throwFromResponse(res.status, errBody)
    }
    if (!res.body) {
      throw new NodaroError("progress stream has no response body", "empty_stream", res.status)
    }

    // Minimal SSE parse: the route emits only `data: <json>\n\n` frames (no
    // event/id fields), so split on blank lines and JSON-parse the data lines.
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let sep: number
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue
            try {
              yield JSON.parse(line.slice(5).trim()) as DownloadVideoProgress
            } catch {
              // Skip malformed frames — the next tick re-reports full state.
            }
          }
        }
      }
    } finally {
      // Ends the HTTP request when the consumer breaks out of the loop early.
      reader.releaseLock()
      await res.body.cancel().catch(() => {})
    }
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

/**
 * One event from {@link MediaResource.downloadVideoProgress}. The stream ends
 * after a `completed` event (which carries the stored `videoUrl` + an optional
 * `thumbnailUrl`) or a `failed` event (which carries `error`).
 */
export interface DownloadVideoProgress {
  phase: "downloading" | "processing" | "uploading" | "completed" | "failed"
  /** Download percent (0–100). Section fetches report jumpy percents — display, don't sum. */
  percent: number
  /** The imported video's storage URL — set on the `completed` event. */
  videoUrl?: string
  /** Thumbnail storage URL — set on the `completed` event when one was captured. */
  thumbnailUrl?: string
  /** What went wrong — set on the `failed` event. */
  error?: string
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
