/**
 * The server's pre-run fetch of a Video URL node's link (decided 2026-10-08).
 *
 * A run executes from the saved graph, and a Video URL node is a source that is
 * READ, never executed: whatever its data holds is what the next node receives.
 * A YouTube / TikTok / Instagram page address is not a video file, so every node
 * that needs the file fails on it mid-run, after its credits were reserved. The
 * editor and the app runner's card avoid that by downloading first; MCP, the SDK
 * and the API have no browser, so the orchestrator does it here — under the
 * card's rules, so every lane behaves like the app runner:
 *
 *  - what is fetched follows what the nodes after the link READ
 *    (`videoLinkRunNeeds`, the one reading the editor's gate and the card share):
 *    the video, only its sound (Transcribe, Suno Cover), or nothing (Dubbing,
 *    Content Recipe take the page address);
 *  - a YouTube video under `AUTO_DOWNLOAD_MAX_SEC` downloads whole at up to
 *    `YOUTUBE_MAX_HEIGHT` rows; a longer one (or one whose length cannot be read)
 *    is downloaded only as the PART the node names (`sectionStartSec` /
 *    `sectionEndSec`, cut exactly). Nobody is here to choose one, so without a
 *    part the run is refused BEFORE anything runs or is charged — never "the
 *    first N minutes", which would be a product decision made silently;
 *  - every other platform downloads whole; a live stream is refused;
 *  - the link must be a supported post link (`isSocialVideoUrl`, exact host):
 *    nothing else is ever handed to the downloader, and a direct or any other
 *    web link is passed through untouched, exactly as on the canvas.
 *
 * A link SAVED in the workflow is fetched exactly like one the run's request set
 * (decided 2026-10-08), whenever the run needs the file — an MCP / SDK / API run
 * of the owner's own workflow included. What keeps a saved link from starting a
 * download for nothing is the same reading the editor's gate uses: the nodes that
 * will execute (`scopeIds`) and what they read, a file already stored for THIS
 * link (`videoLinkDownloadedFile`), and the one-per-run bounds below.
 *
 * What a run fetched is KEPT on its execution (decided 2026-10-08;
 * `lib/execution-video-link-files.ts`), and a Render final continuation of the
 * run, or a re-pick of the same execution, passes that record in (`recorded`)
 * and is handed the same file instead of a new download: the entry must be for
 * THIS link and, for a video, the same part. A repeated run has no record and
 * fetches fresh.
 *
 * Pure of I/O: the probe and the two downloads are injected (`VideoLinkFetchDeps`),
 * so the rules are tested without a downloader; `video-link-fetch-deps.ts` binds
 * the real ones.
 */
import {
  AUTO_DOWNLOAD_MAX_SEC,
  YOUTUBE_HOSTS,
  YOUTUBE_MAX_HEIGHT,
  isSocialVideoUrl,
  videoLinkDownloadedFile,
  videoLinkRunNeeds,
  type VideoLinkNeed,
} from "@nodaro/shared"

/** Downloads a run fetches side by side — under the account's cap on running downloads on purpose. */
export const VIDEO_LINK_FETCH_CONCURRENCY = 2

export interface VideoLinkFetchDeps {
  /** A YouTube link's length / title / live-ness; nulls when unknown (never throws). */
  probe(url: string): Promise<{ readonly durationSec: number | null; readonly title: string | null; readonly isLive: boolean }>
  downloadVideo(request: {
    readonly url: string
    readonly userId: string
    readonly maxHeight?: number
    readonly section?: { readonly startSec: number; readonly endSec: number; readonly exact: true }
    readonly signal?: AbortSignal
  }): Promise<{ readonly videoUrl: string; readonly thumbnailUrl?: string }>
  /** The audio track of the link: its stored URL. */
  downloadAudio(url: string, request: { readonly userId: string; readonly signal?: AbortSignal }): Promise<string>
}

/** What an earlier fetch of a Video URL node produced: the link it was for, and the node fields it wrote. */
export interface RecordedVideoLink {
  readonly link: string
  readonly data: Record<string, unknown>
}

export interface VideoLinkFetchNode {
  readonly id: string
  readonly type?: string
  readonly data: Record<string, unknown>
}

export interface VideoLinkFetchInput {
  /** The run's graph. Which of it counts is decided by `scopeIds`, never by pre-filtering. */
  readonly nodes: ReadonlyArray<VideoLinkFetchNode>
  readonly edges: ReadonlyArray<{ readonly source: string; readonly target: string }>
  /**
   * The nodes about to EXECUTE (`videoLinkRunNeeds`' scope: they plus everything they read from
   * make the run). `null` / absent = every node.
   */
  readonly scopeIds?: readonly string[] | null
  readonly userId: string
  readonly signal?: AbortSignal
  /** A fetch begins / ends, for the run's progress. */
  readonly onFetch?: (nodeId: string, phase: "start" | "end") => void
  /**
   * What this execution (a re-pick), or the one it continues, already fetched, by node. An entry is
   * used only for a node still holding the same link — and for a video, asking for the same part.
   */
  readonly recorded?: Readonly<Record<string, RecordedVideoLink>>
  /**
   * The run continues an earlier execution (Render final): that run's preview was charged, so a
   * refusal here cannot say "nothing was charged".
   */
  readonly continued?: boolean
}

export interface VideoLinkPatch {
  /** The post link the files belong to — what the record on the execution is keyed by. */
  readonly link: string
  /** Taken from the record of an earlier fetch, not fetched now. */
  readonly reused?: true
  /** Written onto the node's data for this run. */
  readonly data: Record<string, unknown>
  /**
   * The subset the run lock admits (`VIDEO_LINK_ADMITTED`). The caller pins it for a continued run
   * (Render final) ONLY for a node the run's request named: the lock refuses a pin on any other.
   */
  readonly pin: Record<string, unknown>
}

export type VideoLinkFetchResult =
  | { readonly ok: true; readonly patches: ReadonlyMap<string, VideoLinkPatch> }
  | { readonly ok: false; readonly reason: "refused"; readonly message: string }
  | { readonly ok: false; readonly reason: "cancelled" }

class Refusal extends Error {}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/** The part the node names: both ends finite seconds, 0 <= start < end. Anything else is no range. */
function nodeRange(data: Record<string, unknown>): { startSec: number; endSec: number } | null {
  const start = data.sectionStartSec
  const end = data.sectionEndSec
  if (typeof start !== "number" || typeof end !== "number") return null
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end) return null
  return { startSec: start, endSec: end }
}

/** Seconds as `m:ss` / `h:mm:ss`, floored — the way a player reads. */
function timecode(sec: number): string {
  const whole = Math.max(0, Math.floor(sec))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const ss = String(whole % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

function reasonOf(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const firstLine = raw.split("\n")[0]!.trim()
  return firstLine.length > 300 ? `${firstLine.slice(0, 300)}…` : firstLine
}

async function fetchVideo(
  node: VideoLinkFetchNode,
  link: string,
  label: string,
  input: VideoLinkFetchInput,
  deps: VideoLinkFetchDeps,
): Promise<VideoLinkPatch> {
  const isYouTube = isSocialVideoUrl(link, YOUTUBE_HOSTS)
  // The part comes from the node (or the request's override of it) and from nowhere
  // else, and only for YouTube — the one platform the card ever asks a part of.
  const section = isYouTube ? nodeRange(node.data) : null

  if (isYouTube && !section) {
    const meta = await deps.probe(link)
    if (meta.isLive) throw new Refusal(`Video URL "${label}": this is a live stream, and a live stream can't be downloaded.`)
    if (meta.durationSec === null || meta.durationSec >= AUTO_DOWNLOAD_MAX_SEC) {
      const length = meta.durationSec === null ? "its length couldn't be read" : `it is ${timecode(meta.durationSec)} long`
      throw new Refusal(
        `Video URL "${label}": a YouTube video of ${AUTO_DOWNLOAD_MAX_SEC / 60} minutes or more is downloaded only as a part, ` +
          `and ${length}. A run has nobody to choose the part: set sectionStartSec and sectionEndSec (in seconds) on this node ` +
          "or in inputOverrides, or use a direct link to the video file. " +
          (input.continued
            ? // The preview this render continues was charged; this step adds nothing to it.
              "This step did not run and nothing more was charged."
            : "Nothing ran and nothing was charged."),
      )
    }
  }

  let file: { readonly videoUrl: string; readonly thumbnailUrl?: string }
  try {
    file = await deps.downloadVideo({
      url: link,
      userId: input.userId,
      ...(isYouTube ? { maxHeight: YOUTUBE_MAX_HEIGHT } : {}),
      ...(section ? { section: { ...section, exact: true as const } } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    })
  } catch (err) {
    if (input.signal?.aborted) throw err
    throw new Refusal(`Video URL "${label}": the linked video couldn't be downloaded (${reasonOf(err)}).`)
  }
  const bound = { downloadedVideoUrl: file.videoUrl, downloadedFromUrl: link }
  return {
    link,
    data: {
      ...bound,
      downloadStatus: "completed",
      downloadedSection: section,
      ...(file.thumbnailUrl ? { downloadedThumbnailUrl: file.thumbnailUrl } : {}),
    },
    pin: bound,
  }
}

async function fetchAudio(
  link: string,
  label: string,
  input: VideoLinkFetchInput,
  deps: VideoLinkFetchDeps,
): Promise<VideoLinkPatch> {
  let url: string
  try {
    url = await deps.downloadAudio(link, { userId: input.userId, ...(input.signal ? { signal: input.signal } : {}) })
  } catch (err) {
    if (input.signal?.aborted) throw err
    throw new Refusal(`Video URL "${label}": the sound of the linked video couldn't be fetched (${reasonOf(err)}).`)
  }
  // The audio track has no binding to its link and is not a field the run lock admits.
  return { link, data: { downloadedAudioUrl: url, audioDownloadStatus: "completed" }, pin: {} }
}

function sameSection(recorded: unknown, wanted: { startSec: number; endSec: number } | null): boolean {
  if (recorded === null || recorded === undefined) return wanted === null
  if (wanted === null || typeof recorded !== "object") return false
  const { startSec, endSec } = recorded as { startSec?: unknown; endSec?: unknown }
  return startSec === wanted.startSec && endSec === wanted.endSec
}

/** The recorded fetch of this node's link, as a patch, when it still fits what the run needs. */
function recordedPatch(node: VideoLinkFetchNode, link: string, need: VideoLinkNeed, input: VideoLinkFetchInput): VideoLinkPatch | null {
  const entry = input.recorded?.[node.id]
  if (!entry || entry.link !== link) return null
  const data = entry.data
  if (need === "audio") {
    const track = text(data.downloadedAudioUrl)
    if (track === "") return null
    return { link, reused: true, data: { downloadedAudioUrl: track, audioDownloadStatus: "completed" }, pin: {} }
  }
  const file = text(data.downloadedVideoUrl)
  if (file === "") return null
  const from = text(data.downloadedFromUrl)
  if (from !== "" && from !== link) return null
  // The part is the node's (or the request's), for YouTube only — what `fetchVideo` would cut.
  const wanted = isSocialVideoUrl(link, YOUTUBE_HOSTS) ? nodeRange(node.data) : null
  if (!sameSection(data.downloadedSection, wanted)) return null
  const bound = { downloadedVideoUrl: file, downloadedFromUrl: link }
  const thumbnail = text(data.downloadedThumbnailUrl)
  return {
    link,
    reused: true,
    data: {
      ...bound,
      downloadStatus: "completed",
      downloadedSection: wanted,
      ...(thumbnail !== "" ? { downloadedThumbnailUrl: thumbnail } : {}),
    },
    pin: bound,
  }
}

export async function fetchVideoLinksForRun(input: VideoLinkFetchInput, deps: VideoLinkFetchDeps): Promise<VideoLinkFetchResult> {
  if (input.signal?.aborted) return { ok: false, reason: "cancelled" }
  const needs = videoLinkRunNeeds(input.scopeIds ?? null, input.nodes, input.edges)

  const jobs: Array<{ node: VideoLinkFetchNode; link: string; label: string; need: VideoLinkNeed }> = []
  for (const node of input.nodes) {
    if (node.type !== "youtube-video") continue
    const need = needs.get(node.id)
    if (!need || need === "none") continue
    const link = text(node.data.youtubeUrl)
    if (!link || !isSocialVideoUrl(link)) continue
    if (need === "file" && videoLinkDownloadedFile(node.data) !== undefined) continue
    if (need === "audio" && text(node.data.downloadedAudioUrl) !== "") continue
    jobs.push({ node, link, label: text(node.data.label) || node.id, need })
  }

  const patches = new Map<string, VideoLinkPatch>()
  let refusal: string | undefined
  let cancelled = false
  let next = 0

  const worker = async (): Promise<void> => {
    while (refusal === undefined && !cancelled) {
      if (input.signal?.aborted) {
        cancelled = true
        return
      }
      const job = jobs[next++]
      if (!job) return
      input.onFetch?.(job.node.id, "start")
      try {
        const patch =
          recordedPatch(job.node, job.link, job.need, input) ??
          (job.need === "file"
            ? await fetchVideo(job.node, job.link, job.label, input, deps)
            : await fetchAudio(job.link, job.label, input, deps))
        patches.set(job.node.id, patch)
      } catch (err) {
        if (input.signal?.aborted) cancelled = true
        else refusal = err instanceof Refusal ? err.message : `Video URL "${job.label}": ${reasonOf(err)}`
      } finally {
        input.onFetch?.(job.node.id, "end")
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(VIDEO_LINK_FETCH_CONCURRENCY, jobs.length) }, worker))

  if (cancelled) return { ok: false, reason: "cancelled" }
  if (refusal !== undefined) return { ok: false, reason: "refused", message: refusal }
  return { ok: true, patches }
}
