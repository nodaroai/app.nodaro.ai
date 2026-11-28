import { AsyncLocalStorage } from "node:async_hooks"

/**
 * The context a job's video steps read their sources in (decided 2026-11-22):
 * whose run it is (the owner the source resolver scopes by,
 * `lib/video-source.ts`), how much time the job has spent conforming kept
 * originals for its editing steps (`providers/video/editing-source.ts`), and
 * what it has to tell the user about its result (an HDR source tone-mapped to
 * SDR).
 *
 * The video worker runs every handler inside one (`workers/video-worker.ts`),
 * the render worker every render (`workers/render-worker.ts`); only the jobs
 * named in `VIDEO_SOURCE_JOB_NAMES` (and the renders) read originals there.
 * Outside one (a route, the orchestrator, a test), and in any other job, a
 * source is read exactly as before and nothing is recorded. A leaf with no imports of the platform, so the completion write
 * (`workers/shared.ts`) can read it.
 */

/** A notice a job's result carries (`output_data.warningCode`). */
export type VideoSourceNotice = "hdr_tone_mapped"

/** The notice's English words (`output_data.warningMessage`), the fallback a client shows for a code it does not know. */
export const VIDEO_SOURCE_NOTICE_MESSAGES: Readonly<Record<VideoSourceNotice, string>> = {
  hdr_tone_mapped: "The source video is HDR. This step works in SDR, so its picture was converted to SDR (the same conversion as the video's preview).",
}

/**
 * The jobs whose steps read their video inputs' kept originals (decided
 * 2026-11-22): the editing nodes, and the steps that finish a generation by
 * reading a user's clip (Merge Video & Audio, Extend). Their video-queue job
 * names. Every other job — a product's flow, a plugin's, a pipeline's, a
 * generation that composes its own clips — reads its inputs exactly as
 * before, even where it calls the same provider function, so a change here
 * is a decision about that node. The render worker's renders read originals
 * too (`workers/render-worker.ts`). `editing-source-census.test.ts` holds
 * every name to a registered handler.
 */
export const VIDEO_SOURCE_JOB_NAMES: ReadonlySet<string> = new Set([
  // Editing nodes
  "add-captions",
  "apply-edl",
  "assemble-narrated-video",
  "combine-videos",
  "extract-frame",
  "fade-video",
  "loop-video",
  "mask-composite",
  "mask-outline",
  "reference-sheet",
  "resize-video",
  "social-media-format",
  "speed-ramp",
  "split-media",
  "transcode-video",
  "trim-video",
  "video-face-mesh",
  "video-overlay",
  // Steps that finish a generation on a user's clip
  "extend-video",
  "merge-video-audio",
])

interface VideoSourceStore {
  readonly owner: string | undefined
  /** This job's steps read kept originals (`VIDEO_SOURCE_JOB_NAMES`); else every input is read as before. */
  readonly readsOriginals: boolean
  /** Time this job's finished conforms ran (from their admission), in ms. */
  conformSpentMs: number
  /** Time reserved by the conforms running now (each its whole allowance), in ms. */
  conformReservedMs: number
  readonly notices: Set<VideoSourceNotice>
}

const storage = new AsyncLocalStorage<VideoSourceStore>()

/**
 * Run `fn` as a job of `owner`'s: its video steps resolve and record in this
 * context. `readsOriginals`: whether this job's steps read kept originals
 * (default true; the video worker passes `VIDEO_SOURCE_JOB_NAMES.has(job.name)`).
 */
export function runWithVideoSourceContext<T>(owner: string | undefined, fn: () => Promise<T>, opts: { readsOriginals?: boolean } = {}): Promise<T> {
  return storage.run({ owner, readsOriginals: opts.readsOriginals ?? true, conformSpentMs: 0, conformReservedMs: 0, notices: new Set() }, fn)
}

/** Whether the active job's steps read kept originals: only inside a context that says so. */
export function readsOriginalsHere(): boolean {
  return storage.getStore()?.readsOriginals === true
}

/** The owner of the job whose context is active; undefined outside one. */
export function videoSourceOwner(): string | undefined {
  return storage.getStore()?.owner
}

/** The conform time this job has spent or holds reserved, in ms (0 outside a context). */
export function conformSpentMs(): number {
  const store = storage.getStore()
  return store ? store.conformSpentMs + store.conformReservedMs : 0
}

/**
 * Take `ms` of the active job's conform budget `budgetMs` for one conform,
 * before it starts: false (nothing taken) when the budget less what is spent
 * and what the conforms running now hold cannot cover it. One synchronous
 * step, so parallel conforms (a composite's inputs, a sheet's clips) can never
 * take the same time twice. Outside a context: false.
 */
export function reserveConformMs(ms: number, budgetMs: number): boolean {
  const store = storage.getStore()
  if (!store || ms > budgetMs - store.conformSpentMs - store.conformReservedMs) return false
  store.conformReservedMs += ms
  return true
}

/** A reserved conform ended: its reservation is given back and the time it ran (from its admission) spent. */
export function settleConformMs(reservedMs: number, ranMs: number): void {
  const store = storage.getStore()
  if (!store) return
  store.conformReservedMs = Math.max(0, store.conformReservedMs - reservedMs)
  store.conformSpentMs += Math.max(0, ranMs)
}

/** Add `ms` of conform time to the active job's total (a test's stand-in for time already spent). */
export function addConformSpentMs(ms: number): void {
  const store = storage.getStore()
  if (store) store.conformSpentMs += Math.max(0, ms)
}

/** Record a notice for the active job's result (nothing outside a context). */
export function recordVideoSourceNotice(notice: VideoSourceNotice): void {
  storage.getStore()?.notices.add(notice)
}

/** The notices recorded so far for the active job (none outside a context). */
export function videoSourceNotices(): readonly VideoSourceNotice[] {
  return [...(storage.getStore()?.notices ?? [])]
}

/**
 * `output_data` with the active job's notice added, for its completion write:
 * `warningCode` and `warningMessage` (the channel a result's other non-fatal
 * notices use), only when a notice was recorded and the output carries no
 * notice of its own (a step's own warning is never overwritten). Returns the
 * same object when there is nothing to add; never mutates it.
 */
export function withVideoSourceNotice<T>(output: T): T {
  const [notice] = videoSourceNotices()
  if (!notice || !output || typeof output !== "object" || Array.isArray(output)) return output
  const record = output as Record<string, unknown>
  if (record.warningCode !== undefined || record.warningMessage !== undefined) return output
  return { ...record, warningCode: notice, warningMessage: VIDEO_SOURCE_NOTICE_MESSAGES[notice] } as T
}
