import type {
  StudioClipResultView,
  StudioClipView,
  StudioProductionDetail,
  StudioProductionSummary,
  StudioProductionView,
  StudioResultView,
  StudioShotView,
  StudioStillView,
  StudioTrashView,
} from "@nodaro/shared"

import { clipResults } from "./shot-clip"
import { stillResults } from "./shot-still"
import { parseProduction } from "./shot-graph"
import { resultKey } from "./result-key"
import type { Shot, ShotClip, ShotStill } from "./shot"
import type { ShotClipResult, ShotStillResult } from "./shot-results"
import type { WorkflowLike } from "./workflow-like"

/**
 * A workflow row, read as a production.
 *
 * `toProductionView` is the ONE read shape: every `/v1/studio/productions`
 * route returns it, every studio MCP tool returns it, and the copilot's context
 * preamble is its summary. One shape means an agent that has seen a production
 * once knows how to read every reply about it afterwards.
 *
 * It is a pure projection of `parseProduction` — no reconciling, no writes, no
 * network. A `GET` that lands a finished job would make reading a production
 * change it, and then two reads of the same row could disagree.
 */

/** The identity fields a view needs beyond what the codec reads. */
export type ViewableWorkflow = WorkflowLike & {
  id: string
  version: number
  updatedAt: string
}

export interface ProductionViewOptions {
  /**
   * `summary` carries counts and the active urls; `full` carries every result
   * with the context that regenerates it, and the bin's items.
   *
   * The split is the platform's "lists return counts, gets return urls"
   * discipline: twenty summaries have to fit in a context window, and one full
   * shot has to be enough to act on without a second call.
   */
  detail: StudioProductionDetail
  /** Narrow to ONE shot, keeping its timeline index. */
  shotId?: string
}

/** A marker's epoch-ms start time as ISO, or nothing. Never truthiness — epoch 0 is a time. */
function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString()
  if (typeof value === "string" && value) return new Date(value).toISOString()
  return undefined
}

/** Omit a key entirely when it is absent — an explicit `undefined` is noise on the wire. */
function put<T>(value: T | undefined, key: string): Record<string, T> {
  return value === undefined ? {} : ({ [key]: value } as Record<string, T>)
}

function stillResultView(result: ShotStillResult): StudioResultView {
  return {
    key: resultKey(result),
    url: result.url,
    ...put(result.jobId, "jobId"),
    ...put(result.name, "name"),
    ...put(result.prompt, "prompt"),
    ...put(result.negativePrompt, "negativePrompt"),
    ...put(result.provider, "provider"),
    ...put(
      result.referenceImageUrls ? [...result.referenceImageUrls] : undefined,
      "referenceImageUrls",
    ),
    ...put(
      result.references ? result.references.map((r) => ({ ...r })) : undefined,
      "references",
    ),
    ...put(result.aspectRatio, "aspectRatio"),
    ...put(result.resolution, "resolution"),
    ...put(result.filmLook, "filmLook"),
    ...put(result.sceneLook, "sceneLook"),
    ...put(result.look, "look"),
    ...put(result.subject, "subject"),
  }
}

function clipResultView(result: ShotClipResult): StudioClipResultView {
  return {
    key: resultKey(result),
    url: result.url,
    ...put(result.jobId, "jobId"),
    ...put(result.name, "name"),
    ...put(result.prompt, "prompt"),
    ...put(result.provider, "provider"),
    ...put(result.negativePrompt, "negativePrompt"),
    ...put(result.duration, "duration"),
    ...put(result.startFrameUrl, "startFrameUrl"),
    ...put(result.endFrameUrl, "endFrameUrl"),
    ...put(
      result.referenceImageUrls ? [...result.referenceImageUrls] : undefined,
      "referenceImageUrls",
    ),
    ...put(
      result.references ? result.references.map((r) => ({ ...r })) : undefined,
      "references",
    ),
    ...put(result.beats ? [...result.beats] : undefined, "beats"),
    ...put(result.scenePrompt, "scenePrompt"),
    ...put(result.endTransition, "endTransition"),
    ...put(result.filmLook, "filmLook"),
    ...put(result.sceneLook, "sceneLook"),
    ...put(result.look, "look"),
    ...put(result.subject, "subject"),
  }
}

/** The active result's key, or `null` when the still is a bare legacy url. */
function activeKey(
  results: ReadonlyArray<ShotStillResult | ShotClipResult>,
  activeIndex: number | undefined,
): string | null {
  const active = results[activeIndex ?? 0]
  return active ? resultKey(active) : null
}

function stillView(still: ShotStill, detail: StudioProductionDetail): StudioStillView {
  const results = stillResults(still)
  return {
    nodeId: still.nodeId,
    provider: still.provider,
    prompt: still.prompt,
    active: activeKey(results, still.activeIndex),
    activeUrl: still.url,
    count: results.length,
    ...put(still.direction, "direction"),
    ...put(still.subject, "subject"),
    ...(detail === "full" ? { results: results.map(stillResultView) } : {}),
    // The MARKERS ride at both levels of detail. A summary that hid them would
    // make "is anything running?" cost a full read, which is exactly the
    // question a poll asks most often.
    pending: [],
  }
}

function clipView(
  clip: ShotClip,
  shot: Shot,
  detail: StudioProductionDetail,
): StudioClipView {
  const results = clipResults(clip)
  return {
    nodeId: clip.nodeId,
    provider: clip.provider,
    prompt: clip.prompt,
    ...put(clip.duration, "duration"),
    active: activeKey(results, clip.activeIndex),
    activeUrl: clip.url,
    count: results.length,
    ...put(clip.direction, "direction"),
    ...put(clip.revoicedVoiceId, "revoicedVoiceId"),
    ...put(clip.revoicedVoiceName, "revoicedVoiceName"),
    ...(detail === "full" ? { results: results.map(clipResultView) } : {}),
    pending: (shot.pendingClips ?? []).map((p) => ({
      jobId: p.jobId,
      ...put(p.provider, "provider"),
      ...put(p.prompt, "prompt"),
      // `typeof`, not truthiness: epoch 0 is a real timestamp and a marker
      // that lost its start time reads as "not running yet".
      ...put(isoOrUndefined(p.startedAt), "startedAt"),
    })),
  }
}

function directingReferences(shot: Shot): StudioShotView["directingReferences"] {
  const images = shot.directingReferenceUrls
  const videos = shot.directingReferenceVideoUrls
  const audio = shot.directingReferenceAudioUrls
  if (!images?.length && !videos?.length && !audio?.length) return undefined
  return {
    ...put(images?.length ? [...images] : undefined, "images"),
    ...put(videos?.length ? [...videos] : undefined, "videos"),
    ...put(audio?.length ? [...audio] : undefined, "audio"),
  }
}

function shotView(shot: Shot, index: number, detail: StudioProductionDetail): StudioShotView {
  return {
    id: shot.id,
    index,
    ...put(shot.name, "name"),
    ...put(shot.folderId, "folderId"),
    ...put(shot.still ? stillView(shot.still, detail) : undefined, "still"),
    ...put(shot.clip ? clipView(shot.clip, shot, detail) : undefined, "clip"),
    ...put(shot.startFrame, "startFrame"),
    ...put(shot.endFrame, "endFrame"),
    ...put(directingReferences(shot), "directingReferences"),
    ...put(shot.plan, "plan"),
    ...put(shot.scenePrompt, "scenePrompt"),
    ...put(shot.beats ? [...shot.beats] : undefined, "beats"),
    ...put(shot.endTransition, "endTransition"),
    ...put(shot.look, "look"),
    ...put(shot.castLook, "castLook"),
    ...put(shot.voice, "voice"),
  }
}

/**
 * A shot with no still still has pending FRAMINGS — a batch in flight on a
 * brand-new shot is the most common case there is, and it has nowhere else to
 * live in the view. So the still's marker list is filled here, from the shot,
 * after the still view is built.
 *
 * `pendingStills` is additive and lands with the generation routes (D5); until
 * then this reads an absent key and yields an empty list, which is the correct
 * answer for every production that exists today.
 */
function withPendingStills(view: StudioShotView, shot: Shot): StudioShotView {
  const pending = (shot as { pendingStills?: ReadonlyArray<Record<string, unknown>> })
    .pendingStills
  if (!pending?.length) return view
  const markers = pending.map((p) => ({
    jobId: String(p.jobId),
    ...put(typeof p.batchId === "string" ? p.batchId : undefined, "batchId"),
    ...put(typeof p.provider === "string" ? p.provider : undefined, "provider"),
    ...put(typeof p.prompt === "string" ? p.prompt : undefined, "prompt"),
    ...put(typeof p.count === "number" ? p.count : undefined, "count"),
    ...put(isoOrUndefined(p.startedAt), "startedAt"),
  }))
  if (view.still) return { ...view, still: { ...view.still, pending: markers } }
  return view
}

/** The whole production, as every route and tool return it. */
export function toProductionView(
  workflow: ViewableWorkflow,
  opts: ProductionViewOptions,
): StudioProductionView {
  const parsed = parseProduction(workflow)
  const all = parsed.shots.map((shot, index) => withPendingStills(shotView(shot, index, opts.detail), shot))
  const shots =
    opts.shotId === undefined ? all : all.filter((s) => s.id === opts.shotId)

  const trashed = parsed.trash ?? []
  const trash: StudioTrashView = {
    count: trashed.length,
    ...(opts.detail === "full" ? { items: trashed.map((t) => ({ ...t })) } : {}),
  }

  const pendingDraft = (
    workflow.settings as { studio?: { pendingDraft?: { jobId?: unknown; mode?: unknown } } }
  )?.studio?.pendingDraft
  const pendingMusic = (workflow.settings as { studio?: { pendingMusic?: unknown } })?.studio
    ?.pendingMusic

  return {
    id: workflow.id,
    name: workflow.name,
    version: workflow.version,
    updatedAt: workflow.updatedAt,
    thumbnailUrl: workflow.thumbnailUrl ?? null,
    shared: parsed.shared === true,
    archived: parsed.archived === true,
    ...put(parsed.film, "film"),
    ...put(parsed.cast, "cast"),
    folders: (parsed.folders ?? []).map((f) => ({ ...f })),
    ...put(parsed.storyboard, "storyboard"),
    ...put(parsed.music, "music"),
    ...put(parsed.musicPlan, "musicPlan"),
    cuts: (parsed.cuts ?? []).map((c) => ({ ...c })),
    trash,
    pending: {
      // Counted across ALL shots, never the narrowed list: "what is running on
      // this production" must not change because a caller asked about one shot.
      stills: all.reduce((n, s) => n + (s.still?.pending.length ?? 0), 0),
      clips: all.reduce((n, s) => n + (s.clip?.pending.length ?? 0), 0),
      music: pendingMusic !== undefined && pendingMusic !== null,
      draft:
        pendingDraft && typeof pendingDraft.jobId === "string"
          ? {
              jobId: pendingDraft.jobId,
              mode: pendingDraft.mode === "append" ? "append" : "replace",
            }
          : null,
    },
    shots,
  }
}

/** A dashboard row — the list shape, with no shot bodies at all. */
export function toProductionSummary(workflow: ViewableWorkflow): StudioProductionSummary {
  const parsed = parseProduction(workflow)
  return {
    id: workflow.id,
    name: workflow.name,
    version: workflow.version,
    updatedAt: workflow.updatedAt,
    thumbnailUrl: workflow.thumbnailUrl ?? null,
    shared: parsed.shared === true,
    archived: parsed.archived === true,
    shotCount: parsed.shots.length,
  }
}

/**
 * The wire pin.
 *
 * `StudioProductionView` above is `@nodaro/shared`'s — the Apache wire contract
 * the SDK is typed against — and everything this package returns has to remain
 * assignable to it. Written as a type-level assertion inside the module rather
 * than as a `.test-d.ts`, because a type test in a `.test.ts` is stripped by
 * esbuild and passes whatever it says, while THIS fails `npm run
 * build:packages` — the gate CI actually runs on every PR.
 */
type WirePin<A, B> = A extends B ? true : never
const _viewIsTheWireShape: WirePin<
  ReturnType<typeof toProductionView>,
  StudioProductionView
> = true
const _summaryIsTheWireShape: WirePin<
  ReturnType<typeof toProductionSummary>,
  StudioProductionSummary
> = true
void _viewIsTheWireShape
void _summaryIsTheWireShape
