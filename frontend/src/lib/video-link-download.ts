/**
 * The app runner's download of a Video URL input's post link — the same rules
 * the Video URL node's controller (`video-link-ingest.ts`) applies on the
 * canvas, with no workflow store behind it, because a published app's page has
 * no node to write to: the caller (`useVideoLinkDownload`) holds the state.
 *
 *  - a YouTube link is probed first (`fetchVideoMetadata`); a video shorter than
 *    `AUTO_DOWNLOAD_MAX_SEC` downloads whole at up to 1080 rows, a longer one
 *    (or one whose length cannot be read) ASKS — an episode is never fetched
 *    whole on its own. A live stream cannot be downloaded;
 *  - every other platform downloads whole, at once;
 *  - the person's answer (`whole`, or a `section` they typed) skips the probe and
 *    comes ONLY from the chooser's buttons: `auto` is the default, always;
 *  - a section is cut exactly (nothing after the download trims it);
 *  - a download with no sound fails, and is retried without that check only
 *    when the person asks (`allowSilent`).
 *
 * The server's account-wide cap on running downloads (`busy`) and its stall
 * watchdogs are the server's; this only reports what it is told.
 */
import { isSocialVideoUrl, YOUTUBE_HOSTS } from "@nodaro/shared"
import { fetchVideoMetadata, startVideoDownload, type StartVideoDownloadOptions, type VideoDownloadSection } from "@/lib/api"
import { followVideoDownload } from "@/lib/video-download-stream"
import { AUTO_DOWNLOAD_MAX_SEC, YOUTUBE_MAX_HEIGHT, classifyDownloadError, type DownloadErrorCode } from "@/lib/video-link"

export type VideoLinkDownloadMode = "auto" | "whole" | "section"

export interface VideoLinkDownloadRequest {
  readonly mode?: VideoLinkDownloadMode
  readonly section?: VideoDownloadSection
  /** Accept a file with no sound — the explicit second try after a no-audio failure. */
  readonly allowSilent?: boolean
}

export type LinkDownloadEvent =
  | { readonly kind: "checking" }
  | { readonly kind: "progress"; readonly percent: number; readonly phase: "downloading" | "processing" | "uploading" }

export type LinkDownloadOutcome =
  | { readonly status: "completed"; readonly videoUrl: string; readonly thumbnailUrl?: string }
  | { readonly status: "needs-choice"; readonly durationSec: number | null }
  | { readonly status: "failed"; readonly code: DownloadErrorCode; readonly raw: string }
  | { readonly status: "aborted" }

export interface VideoLinkDownloadHooks {
  onEvent(event: LinkDownloadEvent): void
  readonly signal: AbortSignal
}

export async function downloadVideoLink(
  url: string,
  request: VideoLinkDownloadRequest,
  { onEvent, signal }: VideoLinkDownloadHooks,
): Promise<LinkDownloadOutcome> {
  const mode = request.mode ?? "auto"
  const section = mode === "section" ? request.section : undefined
  const isYouTube = isSocialVideoUrl(url, YOUTUBE_HOSTS)
  const fail = (code: DownloadErrorCode, raw: string): LinkDownloadOutcome => ({ status: "failed", code, raw })

  if (mode === "section" && !section) return fail("generic", "No part of the video was chosen")

  if (isYouTube && mode === "auto") {
    onEvent({ kind: "checking" })
    const meta = await fetchVideoMetadata(url)
    if (signal.aborted) return { status: "aborted" }
    if (meta.isLive) return fail("live", "This is a live stream")
    if (meta.durationSec === null || meta.durationSec >= AUTO_DOWNLOAD_MAX_SEC) {
      return { status: "needs-choice", durationSec: meta.durationSec }
    }
  }

  const options: StartVideoDownloadOptions = {
    ...(isYouTube ? { maxHeight: YOUTUBE_MAX_HEIGHT } : {}),
    ...(section ? { section, exactSection: true } : {}),
    ...(request.allowSilent ? { requireAudio: false } : {}),
  }

  // One fresh start is allowed after the server forgets a download it was
  // given (a deploy restarts the process that held it) — never a loop.
  for (let startsLeft = 2; startsLeft > 0; startsLeft--) {
    if (signal.aborted) return { status: "aborted" }
    let downloadId: string
    try {
      downloadId = (await startVideoDownload(url, options)).downloadId
    } catch (err) {
      const raw = err instanceof Error ? err.message : ""
      return fail(classifyDownloadError(raw), raw)
    }
    onEvent({ kind: "progress", percent: 0, phase: "downloading" })
    const outcome = await followVideoDownload(downloadId, {
      onProgress: (p) => onEvent({ kind: "progress", percent: p.percent, phase: p.phase }),
      signal,
    })
    if (outcome.status === "aborted" || signal.aborted) return { status: "aborted" }
    if (outcome.status === "completed") {
      return { status: "completed", videoUrl: outcome.videoUrl, ...(outcome.thumbnailUrl ? { thumbnailUrl: outcome.thumbnailUrl } : {}) }
    }
    if (outcome.status === "failed") return fail(classifyDownloadError(outcome.error), outcome.error ?? "")
    if (outcome.status === "lost") return fail("connection", "Connection lost")
    // expired — the server no longer knows it. Start over, once.
  }
  return fail("connection", "Download expired")
}
