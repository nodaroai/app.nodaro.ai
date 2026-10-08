/**
 * The orchestrator's side of the pre-run Video URL fetch (decided 2026-10-08;
 * the rules are `services/workflow-engine/video-link-fetch.ts`): which links
 * the run holds (the ones its request set AND the ones saved in the workflow),
 * who in the run reads them, the polling that lets a Stop reach a download, and
 * the write-back — onto the nodes the run reads, and, for a link the REQUEST set,
 * into the overrides the run pins, so a continued run (Render final) neither
 * fetches again nor reads the creator's old file.
 *
 * A link saved in the workflow is written onto the node and NOT pinned: the run
 * lock (`findLockedOverrides`, applied by Render final to the pinned overrides)
 * refuses a downloaded-file field on a Video URL node the request did not name,
 * so a pin there would turn the continuation into a `locked_field` refusal.
 * Instead every file a run fetches is KEPT ON THE EXECUTION in a record of its
 * own (decided 2026-10-08; `lib/execution-video-link-files.ts`, outside the
 * lock): the caller loads the record of this execution (a re-pick) and of the
 * one it continues (Render final) before the fetch and hands back to be saved
 * what this call returns in `files`, so neither fetches again. A repeated run is
 * a new execution and fetches fresh.
 *
 * Inert for a run whose graph holds no post link to fetch: nothing is read,
 * nothing is polled, and the dependencies are not even loaded.
 */
import { isSocialVideoUrl } from "@nodaro/shared"
import type { SimpleEdge, SimpleNode } from "../services/workflow-engine/types.js"
import { fetchVideoLinksForRun, type VideoLinkFetchDeps } from "../services/workflow-engine/video-link-fetch.js"
import { workerDrainSignal } from "../lib/worker-drain.js"
import { mergeVideoLinkFiles, type VideoLinkFiles } from "../lib/execution-video-link-files.js"

type InputOverrides = Record<string, Record<string, unknown>>

/** What the run's control row says; anything but "running" stops the fetch. */
export type VideoLinkControlStatus = "running" | "cancelled" | "stopping" | "discarded"

/** What stopped a fetch: a control status the user set, or the worker's own deploy drain. */
export type VideoLinkStoppedBy = Exclude<VideoLinkControlStatus, "running"> | "drain"

/** How often a running fetch looks at whether the run was stopped. */
export const VIDEO_LINK_STOP_POLL_MS = 3000

export type PrepareVideoLinksOutcome =
  | {
      readonly kind: "ok"
      readonly inputOverrides: InputOverrides | undefined
      readonly fetched: readonly string[]
      /**
       * The record to keep on the execution: what was recorded before plus what this call fetched or
       * reused. Empty when the call produced nothing — there is then nothing to save.
       */
      readonly files: VideoLinkFiles
    }
  | { readonly kind: "refused"; readonly message: string }
  /** Stopped before it finished. `by` says which — the caller writes a different ending for each. */
  | { readonly kind: "stopped"; readonly by: VideoLinkStoppedBy }

export interface PrepareVideoLinksArgs {
  readonly userId: string
  /** The run's nodes — their `data` is replaced, never mutated. */
  readonly nodes: SimpleNode[]
  readonly edges: ReadonlyArray<Pick<SimpleEdge, "source" | "target">>
  /**
   * Ids of the nodes this run will actually EXECUTE (not seeded, skipped, gated or outside the subset).
   * The scope for `videoLinkRunNeeds`: the run is these nodes plus everything they read from, so a
   * Video URL reaching its consumer through a node that does not execute (Collect, Group, a
   * sub-workflow output, Manual edit) still counts — the very reading the editor's gate uses.
   */
  readonly executingIds: ReadonlySet<string>
  readonly inputOverrides: InputOverrides | undefined
  /** The run's control status, polled while a fetch runs (cancelled / stopping / discarded stop it). */
  readonly controlStatus: () => Promise<VideoLinkControlStatus>
  /** Aborts when this worker begins its deploy drain. Default: the process drain signal. */
  readonly drainSignal?: AbortSignal
  /**
   * What this execution, and the one it continues, already fetched (see the header). Called only when
   * the graph holds a post link, so a run without one reads nothing.
   */
  readonly loadRecorded?: () => Promise<VideoLinkFiles>
  /** Something already ran and was charged (a continued run, or a re-pick carrying done nodes): refusals cannot say "nothing was charged". */
  readonly continued?: boolean
  /** Default: the real downloader. */
  readonly deps?: VideoLinkFetchDeps
  readonly pollMs?: number
}

/** The Video URL nodes this run's request pointed at a link. */
export function overriddenVideoLinkIds(nodes: readonly SimpleNode[], inputOverrides: InputOverrides | undefined): Set<string> {
  const ids = new Set<string>()
  if (!inputOverrides) return ids
  for (const node of nodes) {
    if (node.type !== "youtube-video") continue
    const override = inputOverrides[node.id]
    if (override && typeof override.youtubeUrl === "string") ids.add(node.id)
  }
  return ids
}

/** Whether any Video URL node of the graph holds a post link (a YouTube / TikTok / … page address). */
function holdsPostLink(nodes: readonly SimpleNode[]): boolean {
  return nodes.some((n) => {
    if (n.type !== "youtube-video") return false
    const url = (n.data as Record<string, unknown>).youtubeUrl
    return typeof url === "string" && isSocialVideoUrl(url.trim())
  })
}

export async function prepareVideoLinksForRun(args: PrepareVideoLinksArgs): Promise<PrepareVideoLinksOutcome> {
  if (!holdsPostLink(args.nodes)) return { kind: "ok", inputOverrides: args.inputOverrides, fetched: [], files: {} }
  const requestSetIds = overriddenVideoLinkIds(args.nodes, args.inputOverrides)
  const recorded = args.loadRecorded ? await args.loadRecorded() : {}

  const deps = args.deps ?? (await import("../services/workflow-engine/video-link-fetch-deps.js")).realVideoLinkFetchDeps
  const drain = args.drainSignal ?? workerDrainSignal()
  const controller = new AbortController()
  let stoppedBy: VideoLinkStoppedBy | undefined
  const stop = (by: VideoLinkStoppedBy) => {
    stoppedBy ??= by
    controller.abort()
  }
  // A deploy drain is not a Stop, but the fetch must give way to it just the same: a download
  // that outlives the container's grace window leaves the job active under a dead lock.
  const onDrain = () => stop("drain")
  if (drain.aborted) onDrain()
  else drain.addEventListener("abort", onDrain, { once: true })
  const poll = setInterval(() => {
    args.controlStatus().then(
      (status) => {
        if (status !== "running") stop(status)
      },
      () => {},
    )
  }, args.pollMs ?? VIDEO_LINK_STOP_POLL_MS)
  let result
  try {
    result = await fetchVideoLinksForRun(
      {
        nodes: args.nodes.map((n) => ({ id: n.id, type: n.type, data: n.data as Record<string, unknown> })),
        edges: args.edges,
        scopeIds: [...args.executingIds],
        userId: args.userId,
        signal: controller.signal,
        recorded,
        ...(args.continued ? { continued: true } : {}),
      },
      deps,
    )
  } finally {
    clearInterval(poll)
    drain.removeEventListener("abort", onDrain)
  }
  if (!result.ok) return result.reason === "cancelled" ? { kind: "stopped", by: stoppedBy ?? "cancelled" } : { kind: "refused", message: result.message }

  let inputOverrides = args.inputOverrides
  const fetchedNow: Record<string, { link: string; data: Record<string, unknown> }> = {}
  for (const [id, patch] of result.patches) {
    fetchedNow[id] = { link: patch.link, data: patch.data }
    const node = args.nodes.find((n) => n.id === id)
    if (!node) continue
    node.data = { ...node.data, ...patch.data } as SimpleNode["data"]
    if (requestSetIds.has(id) && Object.keys(patch.pin).length > 0) {
      inputOverrides = { ...inputOverrides, [id]: { ...inputOverrides?.[id], ...patch.pin } }
    }
  }
  return {
    kind: "ok",
    inputOverrides,
    fetched: [...result.patches.keys()],
    files: result.patches.size > 0 ? mergeVideoLinkFiles(recorded, fetchedNow) : {},
  }
}
