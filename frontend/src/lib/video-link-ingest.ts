/**
 * The Video URL node's download controller — the one place that turns a pasted
 * link into a stored video file, the way Recast and Studio do.
 *
 * It lives at MODULE level, keyed by node id, on purpose. The node's card and
 * its settings panel both drive the same node, and either can unmount while a
 * download runs (deselect the node, scroll it off the canvas) — a download tied
 * to a component's lifetime died with it and left the node "downloading"
 * forever. Here a download belongs to the node: both surfaces call in, neither
 * owns it, and `resumeVideoLinkIngest` re-attaches to it after a reload.
 *
 * Three rules everything below is built around:
 *
 *  1. NODE DATA IS NOT TRUSTED TO START A DOWNLOAD. A workflow can be written by
 *     someone else — a template, an import, an agent — and every field here can
 *     be authored. So nothing that runs on its own (a mount, a Run) acts on a
 *     stored "download the whole thing": it starts from `auto`, which probes a
 *     YouTube link's length first. A long download begins only from a click on
 *     one of the chooser's two buttons, in this session.
 *  2. A MOUNT NEVER STARTS A DOWNLOAD. `resumeVideoLinkIngest` only re-attaches
 *     to a download the server still knows, by an id that is bound to the link
 *     it was made for; otherwise the node goes back to idle. Opening a workflow
 *     costs nothing, whoever wrote it.
 *  3. EVERY WRITE RE-READS THE NODE'S CURRENT LINK. An answer can land after the
 *     link was edited, cleared, or replaced by a newer request — the file it
 *     carries belongs to the old link, and writing it would hand every
 *     downstream node the wrong video.
 */
import { isSocialVideoUrl, videoLinkDownloadedFile, YOUTUBE_HOSTS } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { setSkipUndoCapture } from "@/hooks/undo-flags"
import {
  downloadYouTubeAudio,
  fetchVideoMetadata,
  fetchYouTubeOEmbed,
  startVideoDownload,
  type StartVideoDownloadOptions,
  type VideoDownloadSection,
} from "@/lib/api"
import { followVideoDownload } from "@/lib/video-download-stream"
import { VIDEO_LINK_INGEST_DEBOUNCE_MS } from "@/lib/video-link-ingest-timing"
import { tx } from "@/lib/i18n"
import {
  AUTO_DOWNLOAD_MAX_SEC,
  VIDEO_PLATFORM_LABELS,
  YOUTUBE_MAX_HEIGHT,
  classifyDownloadError,
  deriveVideoLinkView,
  detectVideoLinkPlatform,
  extractVideoLinkId,
  type DownloadErrorCode,
} from "@/lib/video-link"

export { VIDEO_LINK_INGEST_DEBOUNCE_MS }

/** Downloads the pre-run pass runs side by side. Kept under the server's
 *  per-account cap on purpose, so a Run never refuses itself. */
export const ENSURE_CONCURRENCY = 2

export type VideoLinkIngestMode = "auto" | "whole" | "section"

export interface VideoLinkIngestRequest {
  /** `auto` (default) probes a YouTube link and asks before a long download;
   *  `whole` / `section` are the person's own answer to that question and come
   *  ONLY from the chooser's buttons. */
  readonly mode?: VideoLinkIngestMode
  readonly section?: VideoDownloadSection
  /** Accept a file with no sound — the explicit second try after a no-audio failure. */
  readonly allowSilent?: boolean
  /** Download again even though the node already holds a file for this link. */
  readonly force?: boolean
}

export type VideoLinkIngestOutcome =
  | { readonly status: "completed"; readonly videoUrl: string }
  | { readonly status: "needs-choice"; readonly durationSec: number | null }
  | { readonly status: "failed"; readonly code: DownloadErrorCode }
  /** Nothing to do: not a link we download, already downloaded, read-only, or a
   *  resume that found nothing left to re-attach to. */
  | { readonly status: "skipped" }
  /** The link changed, or a newer request took over, before this one finished. */
  | { readonly status: "superseded" }

export type EnsureVideoLinksResult =
  | { readonly ok: true; readonly downloaded: number }
  | {
      readonly ok: false
      readonly nodeId: string
      readonly label: string
      readonly reason: "choose" | "failed" | "changed"
      readonly code?: DownloadErrorCode
    }
  | { readonly ok: false; readonly reason: "cancelled" }

interface IngestControl {
  cancelled: boolean
  readonly abort: AbortController
}

interface LiveIngest {
  readonly key: string
  /** The link this ingest was started for — a live entry for another link is dead weight. */
  readonly url: string
  readonly control: IngestControl
  readonly promise: Promise<VideoLinkIngestOutcome>
}

interface PendingFollowUp {
  readonly timer: ReturnType<typeof setTimeout>
  /** What a new link needs BESIDES its video: the title and the audio track. */
  readonly sides: () => void
}

interface StartOptions {
  /** Try the download the node was already following before starting a new one. */
  readonly reattach?: boolean
  /** Re-attach or do nothing — never a new download (the mount path). */
  readonly followOnly?: boolean
}

const live = new Map<string, LiveIngest>()
const pending = new Map<string, PendingFollowUp>()

type NodeData = Record<string, unknown>

function readData(nodeId: string): NodeData | undefined {
  const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
  if (!node || node.type !== "youtube-video") return undefined
  return node.data as NodeData
}

function linkOf(data: NodeData | undefined): string {
  return typeof data?.youtubeUrl === "string" ? data.youtubeUrl.trim() : ""
}

/** A write the PERSON made — the link field, the remove button. An undo step. */
function patchNode(nodeId: string, patch: NodeData): void {
  useWorkflowStore.getState().updateNodeData(nodeId, patch)
}

/**
 * A write the DOWNLOAD made — status, progress, the file, the title, the audio
 * track. Never an undo step. Ctrl+Z after a download has to take back the pasted
 * link; walking "completed -> downloading -> checking" instead is useless, and a
 * restored "downloading" is exactly what a resume re-attaches to, so undo would
 * bounce forward again and never get past the download.
 */
function patchFromDownload(nodeId: string, patch: NodeData): void {
  setSkipUndoCapture(true)
  try {
    useWorkflowStore.getState().updateNodeData(nodeId, patch)
  } finally {
    setSkipUndoCapture(false)
  }
}

function cancelLive(nodeId: string): void {
  const running = live.get(nodeId)
  if (!running) return
  running.control.cancelled = true
  running.control.abort.abort()
  live.delete(nodeId)
}

function dropPending(nodeId: string): void {
  const waiting = pending.get(nodeId)
  if (!waiting) return
  clearTimeout(waiting.timer)
  pending.delete(nodeId)
}

/**
 * A download is starting inside the typing pause — a click on Download, or Run.
 * The pause is over for this link, so the rest of what it was waiting to do
 * (title, audio track) happens now; only the pending VIDEO fetch is replaced by
 * the one that is starting. Dropping the follow-up whole would leave the node
 * without its audio track, and Transcribe / Suno Cover read exactly that.
 */
function settlePending(nodeId: string): void {
  const waiting = pending.get(nodeId)
  if (!waiting) return
  clearTimeout(waiting.timer)
  pending.delete(nodeId)
  waiting.sides()
}

/**
 * The id of the server-side download this node was following — but ONLY when it
 * was made for the node's current link. The two are stored side by side because
 * the link can change where this module is not looking (an agent edit, an
 * import, a canvas adopted from another tab); re-attaching by a bare id would
 * then fetch the PREVIOUS link's file and file it under the new one.
 */
function boundDownloadId(data: NodeData, url: string): string | undefined {
  const id = typeof data.downloadId === "string" ? data.downloadId : ""
  return id !== "" && data.downloadIdUrl === url ? id : undefined
}

/** The part a re-attached download covers — a LABEL only, read from the node. */
function storedSection(data: NodeData | undefined): VideoDownloadSection | null {
  if (data?.downloadMode !== "section") return null
  const { sectionStartSec, sectionEndSec } = data
  return typeof sectionStartSec === "number" && typeof sectionEndSec === "number"
    ? { startSec: sectionStartSec, endSec: sectionEndSec }
    : null
}

function requestKey(url: string, request: VideoLinkIngestRequest, followOnly: boolean): string {
  const mode = request.mode ?? "auto"
  return JSON.stringify([
    url,
    followOnly ? "follow" : mode,
    mode === "section" ? (request.section?.startSec ?? null) : null,
    mode === "section" ? (request.section?.endSec ?? null) : null,
    request.allowSilent === true,
  ])
}

// ---------------------------------------------------------------------------
// The download itself
// ---------------------------------------------------------------------------

async function runIngest(
  nodeId: string,
  url: string,
  request: VideoLinkIngestRequest,
  control: IngestControl,
  reattachId: string | undefined,
  followOnly: boolean,
): Promise<VideoLinkIngestOutcome> {
  const mode = request.mode ?? "auto"
  const section = mode === "section" ? request.section : undefined
  const isYouTube = isSocialVideoUrl(url, YOUTUBE_HOSTS)

  /** Write only while this ingest still owns the node, the link is unchanged,
   *  and the canvas still takes writes (`updateNodeData` is a silent no-op on a
   *  read-only canvas — reporting that as written would strand the node). */
  const write = (patch: NodeData): boolean => {
    if (control.cancelled) return false
    if (useWorkflowStore.getState().isReadOnly || linkOf(readData(nodeId)) !== url) {
      control.cancelled = true
      control.abort.abort()
      return false
    }
    patchFromDownload(nodeId, patch)
    return true
  }

  const fail = (code: DownloadErrorCode, raw: string, keepDownloadId: boolean): VideoLinkIngestOutcome => {
    const wrote = write({
      downloadStatus: "failed",
      downloadErrorCode: code,
      downloadError: raw,
      ...(keepDownloadId ? {} : { downloadId: "", downloadIdUrl: "" }),
    })
    return wrote ? { status: "failed", code } : { status: "superseded" }
  }

  if (mode === "section" && !section) return fail("generic", "No part of the video was chosen", false)

  const startOptions: StartVideoDownloadOptions = {
    ...(isYouTube ? { maxHeight: YOUTUBE_MAX_HEIGHT } : {}),
    // Exact: nothing here trims the file afterwards, and the nodes it feeds
    // measure it. Video Analysis prices by its length, so the server's ±3s pad
    // turned a 1:00 part into 1:06 and the next price bucket.
    ...(section ? { section, exactSection: true } : {}),
    ...(request.allowSilent ? { requireAudio: false } : {}),
  }

  let downloadId = reattachId
  let reattached = downloadId !== undefined
  let probed = false
  // One fresh start is allowed after the server forgets a download it was given
  // (a deploy restarts the process that held it) — never a loop.
  let startsLeft = 2

  for (;;) {
    if (!downloadId) {
      if (followOnly) {
        // Nothing left to re-attach to. Back to idle — the Download button and
        // Run both fetch it; a mount does not.
        write({ downloadStatus: "idle", downloadId: "", downloadIdUrl: "" })
        return { status: "skipped" }
      }
      if (startsLeft-- === 0) return fail("connection", "Download expired", false)

      // The probe is part of EVERY automatic start, including the one after a
      // re-attach came back empty: a stored id must never be a way around it.
      if (isYouTube && mode === "auto" && !probed) {
        probed = true
        if (!write({ downloadStatus: "checking", downloadError: "", downloadErrorCode: "", needsRangeChoice: false })) {
          return { status: "superseded" }
        }
        const meta = await fetchVideoMetadata(url)
        if (control.cancelled) return { status: "superseded" }
        if (meta.isLive) return fail("live", "This is a live stream", false)
        const titlePatch = meta.title && !readData(nodeId)?.title ? { title: meta.title } : {}
        if (meta.durationSec === null || meta.durationSec >= AUTO_DOWNLOAD_MAX_SEC) {
          const wrote = write({
            downloadStatus: "idle",
            needsRangeChoice: true,
            videoDurationSec: meta.durationSec,
            downloadId: "",
            downloadIdUrl: "",
            ...titlePatch,
          })
          return wrote ? { status: "needs-choice", durationSec: meta.durationSec } : { status: "superseded" }
        }
        if (!write({ videoDurationSec: meta.durationSec, ...titlePatch })) return { status: "superseded" }
      }

      const began = write({
        downloadStatus: "downloading",
        downloadMode: mode,
        downloadAllowSilent: request.allowSilent === true,
        ...(section ? { sectionStartSec: section.startSec, sectionEndSec: section.endSec } : {}),
        downloadError: "",
        downloadErrorCode: "",
        needsRangeChoice: false,
        downloadedVideoUrl: "",
        downloadedThumbnailUrl: "",
        downloadedFromUrl: "",
        downloadedSection: null,
        downloadId: "",
        downloadIdUrl: "",
      })
      if (!began) return { status: "superseded" }
      try {
        downloadId = (await startVideoDownload(url, startOptions)).downloadId
      } catch (err) {
        const raw = err instanceof Error ? err.message : ""
        return fail(classifyDownloadError(raw), raw, false)
      }
      reattached = false
      if (!write({ downloadId, downloadIdUrl: url })) return { status: "superseded" }
    } else if (!write({ downloadStatus: "downloading", downloadError: "", downloadErrorCode: "" })) {
      return { status: "superseded" }
    }

    // Progress ticks are TRANSIENT keys, written alone: they must neither dirty
    // the workflow nor reach a save (see TRANSIENT_RUNTIME_KEYS).
    let lastTick = ""
    const tick = (percent: number, phase: string) => {
      const next = `${percent}|${phase}`
      if (next === lastTick) return
      lastTick = next
      write({ downloadPercent: percent, downloadPhase: phase })
    }
    tick(0, "downloading")

    const outcome = await followVideoDownload(downloadId, {
      onProgress: (p) => tick(p.percent, p.phase),
      signal: control.abort.signal,
    })
    if (control.cancelled || outcome.status === "aborted") return { status: "superseded" }

    if (outcome.status === "completed") {
      const current = readData(nodeId)
      const wrote = write({
        downloadStatus: "completed",
        downloadedVideoUrl: outcome.videoUrl,
        downloadedThumbnailUrl: outcome.thumbnailUrl ?? "",
        downloadedFromUrl: url,
        downloadedSection: reattached ? storedSection(current) : (section ?? null),
        downloadId: "",
        downloadIdUrl: "",
        thumbnailUrl: outcome.thumbnailUrl ?? current?.thumbnailUrl ?? "",
      })
      return wrote ? { status: "completed", videoUrl: outcome.videoUrl } : { status: "superseded" }
    }
    if (outcome.status === "failed") {
      return fail(classifyDownloadError(outcome.error), outcome.error ?? "", false)
    }
    if (outcome.status === "lost") {
      // The download may still land server-side — keep its id so Retry
      // re-attaches instead of fetching the same video twice.
      return fail("connection", "Connection lost", true)
    }
    // expired — the server no longer knows it. Forget the id and go round.
    downloadId = undefined
  }
}

function start(nodeId: string, request: VideoLinkIngestRequest, options: StartOptions): Promise<VideoLinkIngestOutcome> {
  const skipped: VideoLinkIngestOutcome = { status: "skipped" }
  if (useWorkflowStore.getState().isReadOnly) return Promise.resolve(skipped)
  const data = readData(nodeId)
  const url = linkOf(data)
  if (!data || !url || !isSocialVideoUrl(url)) return Promise.resolve(skipped)
  if (videoLinkDownloadedFile(data) && !request.force) return Promise.resolve(skipped)

  const followOnly = options.followOnly === true
  const key = requestKey(url, request, followOnly)
  const running = live.get(nodeId)
  // An identical request joins the one running. A mount's re-attach joins
  // ANYTHING running for this link — it must never replace a real download.
  if (running && running.url === url && (running.key === key || followOnly)) return running.promise

  cancelLive(nodeId)
  settlePending(nodeId)

  const reattachId = options.reattach && !request.force ? boundDownloadId(data, url) : undefined
  const control: IngestControl = { cancelled: false, abort: new AbortController() }
  const promise = runIngest(nodeId, url, request, control, reattachId, followOnly).finally(() => {
    if (live.get(nodeId)?.control === control) live.delete(nodeId)
  })
  live.set(nodeId, { key, url, control, promise })
  return promise
}

/**
 * Download the node's link, or join the download already running for the same
 * request. `auto` unless the chooser says otherwise.
 */
export function ingestVideoLink(
  nodeId: string,
  request: VideoLinkIngestRequest = { mode: "auto" },
): Promise<VideoLinkIngestOutcome> {
  return start(nodeId, request, {})
}

/**
 * The Retry button. Re-attaches to the download the node was following when the
 * server still has it (a dropped connection over a download that finished), and
 * otherwise starts over from `auto` — so a long YouTube video comes back to the
 * chooser instead of being fetched whole on the strength of stored data.
 * `allowSilent` makes it the explicit "download it without sound" second try.
 */
export function retryVideoLinkIngest(
  nodeId: string,
  overrides: { readonly allowSilent?: boolean } = {},
): Promise<VideoLinkIngestOutcome> {
  const data = readData(nodeId)
  if (!data) return Promise.resolve({ status: "skipped" })
  const allowSilent = overrides.allowSilent ?? data.downloadAllowSilent === true
  return start(nodeId, { mode: "auto", allowSilent }, { reattach: true })
}

export function isVideoLinkIngestLive(nodeId: string): boolean {
  return live.has(nodeId)
}

/**
 * Re-attach to a download after a reload — and NOTHING else. Only the two
 * in-flight states are touched: a saved "downloading"/"checking" with nothing
 * following it in this tab has lost its reader. If the server still knows the
 * download (by an id bound to this link) it is followed to its end; if not, the
 * node goes back to idle. It never starts a download: this runs from a mount
 * effect, on data anyone may have written.
 */
export function resumeVideoLinkIngest(nodeId: string): void {
  if (pending.has(nodeId)) return
  const data = readData(nodeId)
  if (!data) return
  const running = live.get(nodeId)
  if (running) {
    // Following this link already — leave it. Following ANOTHER link: that
    // ingest is dead (the link changed under it); drop it and settle the node.
    if (running.url === linkOf(data)) return
    cancelLive(nodeId)
  }
  const view = deriveVideoLinkView(data)
  if (view.kind !== "downloading" && view.kind !== "checking") return
  void start(nodeId, { mode: "auto" }, { reattach: true, followOnly: true })
}

// ---------------------------------------------------------------------------
// The link field
// ---------------------------------------------------------------------------

function describeLink(nodeId: string, url: string): void {
  if (!isSocialVideoUrl(url, YOUTUBE_HOSTS)) return
  fetchYouTubeOEmbed(url).then(
    (meta) => {
      if (linkOf(readData(nodeId)) !== url) return
      patchFromDownload(nodeId, {
        ...(meta.title ? { title: meta.title } : {}),
        ...(meta.thumbnail_url && !readData(nodeId)?.downloadedThumbnailUrl ? { thumbnailUrl: meta.thumbnail_url } : {}),
      })
    },
    () => {
      // oEmbed is often CORS-blocked; the img.youtube.com thumbnail already shows.
    },
  )
}

/** The audio track, for the consumers that read `downloadedAudioUrl` (Suno Cover, Transcribe). */
function ingestAudio(nodeId: string, url: string): void {
  patchFromDownload(nodeId, { audioDownloadStatus: "downloading", downloadedAudioUrl: "", audioDownloadError: "" })
  downloadYouTubeAudio(url).then(
    (result) => {
      if (linkOf(readData(nodeId)) !== url) return
      patchFromDownload(nodeId, { downloadedAudioUrl: result.url, audioDownloadStatus: "completed" })
    },
    (err: unknown) => {
      if (linkOf(readData(nodeId)) !== url) return
      patchFromDownload(nodeId, {
        audioDownloadStatus: "failed",
        audioDownloadError: err instanceof Error ? err.message : "Audio download failed",
      })
    },
  )
}

/** What a link change resets on the node. A run-time link swap (an app's input) drops the same
 *  set on the server (`VIDEO_LINK_DERIVED_FIELDS`, `@nodaro/shared`) — guarded to cover this. */
export const CLEARED_DOWNLOAD: NodeData = {
  downloadedVideoUrl: "",
  downloadedThumbnailUrl: "",
  downloadedFromUrl: "",
  downloadedSection: null,
  downloadStatus: "idle",
  downloadError: "",
  downloadErrorCode: "",
  downloadId: "",
  downloadIdUrl: "",
  downloadMode: "auto",
  downloadAllowSilent: false,
  needsRangeChoice: false,
  videoDurationSec: null,
  downloadedAudioUrl: "",
  audioDownloadStatus: "idle",
  audioDownloadError: "",
}

/**
 * The link field changed. Resets everything that belonged to the previous link
 * in ONE write, then — once the typing stops — fetches the new one.
 */
export function setVideoLinkUrl(nodeId: string, rawUrl: string): void {
  cancelLive(nodeId)
  dropPending(nodeId)

  const url = rawUrl.trim()
  const videoId = extractVideoLinkId(url)
  const platform = detectVideoLinkPlatform(url)
  patchNode(nodeId, {
    ...CLEARED_DOWNLOAD,
    youtubeUrl: rawUrl,
    videoId: videoId ?? "",
    title: videoId && platform !== "youtube" && platform !== "unknown"
      ? tx("inputcfg.video", { platform: VIDEO_PLATFORM_LABELS[platform] })
      : "",
    // img.youtube.com answers cross-origin for every id — something to look at
    // the instant the link lands, before oEmbed or the download say anything.
    thumbnailUrl: videoId && platform === "youtube" ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : "",
  })
  if (!videoId) return

  const sides = () => {
    if (linkOf(readData(nodeId)) !== url) return
    describeLink(nodeId, url)
    ingestAudio(nodeId, url)
  }
  const timer = setTimeout(() => {
    pending.delete(nodeId)
    sides()
    if (linkOf(readData(nodeId)) === url) void ingestVideoLink(nodeId, { mode: "auto" })
  }, VIDEO_LINK_INGEST_DEBOUNCE_MS)
  pending.set(nodeId, { timer, sides })
}

export function clearVideoLink(nodeId: string): void {
  cancelLive(nodeId)
  dropPending(nodeId)
  patchNode(nodeId, { ...CLEARED_DOWNLOAD, youtubeUrl: "", videoId: "", title: "", thumbnailUrl: "" })
}

// ---------------------------------------------------------------------------
// The gate in front of Run
// ---------------------------------------------------------------------------

function labelOf(data: NodeData): string {
  return typeof data.label === "string" && data.label.trim() ? data.label : "Video URL"
}

async function ensureOne(nodeId: string): Promise<EnsureVideoLinksResult> {
  const data = readData(nodeId)
  if (!data) return { ok: true, downloaded: 0 }
  const label = labelOf(data)
  // A download already under way for THIS link — whatever was asked of it, a
  // whole long video the person chose included — is waited for, never replaced.
  const running = live.get(nodeId)
  const joined = running !== undefined && running.url === linkOf(data)
  let outcome = joined ? await running.promise : await ingestVideoLink(nodeId, { mode: "auto" })
  // What was joined may not have settled the node — a re-attach that found
  // nothing left, a request that got replaced. Then ask for ourselves, once
  // (a node that is ready by now answers "skipped" without touching the network).
  if (joined && (outcome.status === "skipped" || outcome.status === "superseded")) {
    outcome = await ingestVideoLink(nodeId, { mode: "auto" })
  }

  if (outcome.status === "completed") return { ok: true, downloaded: 1 }
  if (outcome.status === "needs-choice") return { ok: false, nodeId, label, reason: "choose" }
  if (outcome.status === "failed") return { ok: false, nodeId, label, reason: "failed", code: outcome.code }
  // skipped / superseded: trust the node, not the outcome — it may have been
  // completed by the request that superseded this one.
  const after = readData(nodeId)
  if (!after) return { ok: true, downloaded: 0 }
  const view = deriveVideoLinkView(after)
  if (view.kind === "ready" || view.kind === "empty" || view.kind === "passthrough") return { ok: true, downloaded: 0 }
  if (view.kind === "choose") return { ok: false, nodeId, label, reason: "choose" }
  return { ok: false, nodeId, label, reason: "changed" }
}

/**
 * Make sure every listed Video URL node holds its file before a run reads it.
 * Three of the four Run paths execute on the server from the SAVED workflow, so
 * a node that still holds only a link would hand a web page to a video node.
 *
 * Downloads what is missing (waiting for a download already under way), a few
 * at a time. It never decides a long video for the person and never starts a
 * run over a failed download — both come back as `ok: false`, naming the node —
 * and a node that needs a choice is reported BEFORE anything is downloaded, so
 * nobody waits minutes to be told to pick a part. `signal` abandons the WAIT;
 * the downloads themselves carry on and the nodes show them.
 */
export async function ensureVideoLinksDownloaded(
  nodeIds: readonly string[],
  options: { readonly signal?: AbortSignal } = {},
): Promise<EnsureVideoLinksResult> {
  const todo: string[] = []
  for (const nodeId of nodeIds) {
    const data = readData(nodeId)
    if (!data) continue
    const view = deriveVideoLinkView(data)
    if (view.kind === "empty" || view.kind === "passthrough" || view.kind === "ready") continue
    if (view.kind === "choose") return { ok: false, nodeId, label: labelOf(data), reason: "choose" }
    todo.push(nodeId)
  }

  const results: EnsureVideoLinksResult[] = []
  let next = 0
  let blockedAlready = false
  const worker = async () => {
    // A refusal stops BOTH workers from taking more: the run is not going to
    // start, so every further download would be one nobody asked for.
    while (next < todo.length && !blockedAlready && !options.signal?.aborted) {
      const result = await ensureOne(todo[next++])
      results.push(result)
      if (!result.ok) blockedAlready = true
    }
  }
  const work = Promise.all(Array.from({ length: Math.min(ENSURE_CONCURRENCY, todo.length) }, worker))
  const cancelled = new Promise<"cancelled">((resolve) => {
    if (options.signal?.aborted) resolve("cancelled")
    options.signal?.addEventListener("abort", () => resolve("cancelled"), { once: true })
  })
  if ((await Promise.race([work, cancelled])) === "cancelled") return { ok: false, reason: "cancelled" }

  const blocked = results.find((r) => !r.ok)
  if (blocked) return blocked
  return { ok: true, downloaded: results.reduce((sum, r) => sum + (r.ok ? r.downloaded : 0), 0) }
}

export function __resetVideoLinkIngestForTests(): void {
  for (const nodeId of [...live.keys()]) cancelLive(nodeId)
  for (const nodeId of [...pending.keys()]) dropPending(nodeId)
}
