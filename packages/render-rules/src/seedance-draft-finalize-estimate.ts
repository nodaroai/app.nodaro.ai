/**
 * The draft a Seedance 2.5 HD finalize (Video Upscale, provider
 * `seedance-2-5-hd`) will finalize, as a RUN estimate prices that finalize
 * (decided 2026-11-12). A finalize re-renders its draft at 1080p and is
 * charged by the draft: the take's own length — never more than the output its
 * draft's run reserved — plus its reference clips when it had any.
 *
 * - **The run makes the draft** (`kind: "planned"`): the finalize is quoted at
 *   the length the DRAFT's run reserves for — its hold, which is also the most
 *   the finalize bills for output, so the quote is a true ceiling:
 *   - a draft with no reference video: the length it is priced at
 *     (`pricedOutputDurationSec`: Auto = the model's longest clip), the
 *     finalize's `seedance-2-5-hd:{N}s` row (carried here, so both estimators
 *     quote the same row);
 *   - a draft with reference video(s): the draft's reference-video hold, its
 *     clips counted as input seconds. That price is a per-second rate over
 *     input plus output, which only the server computes: the server's estimate
 *     prices it from the draft's request, and the editor asks the server for
 *     it with the very request it quotes the draft's own run with.
 * - **The draft already exists** (`kind: "existing"`): the run finalizes that
 *   take, named by its provider task id — the task the node hands on, whatever
 *   its settings say now; the estimators price it exactly, as the finalize's
 *   own gate does (the editor through `POST /v1/credits/seedance-hd-estimate`,
 *   the server's run-set estimates through the gate).
 *
 * One rule for the server's run estimates (with the listing and the balance
 * checks) and the editor's Run total: which upstream node is the draft,
 * whether this run makes it, and the no-reference row.
 */
import {
  isSeedanceDraftCapable,
  seedanceDraftFinalizeCreditId,
  SEEDANCE_DRAFT_FINALIZE_PROVIDER,
} from "@nodaro/shared/model-catalog"
import {
  applyDefaultVideoSelection,
  isSeedanceVideoEditProvider,
  pricedOutputDurationSec,
  resolveVideoProviderForMode,
} from "@nodaro/shared/models"
import { withWiredSettings } from "@nodaro/shared/nodes"
import { referenceModalityForHandle } from "@nodaro/shared/workflow"
import { resolveGraphOrigin, type EstimateGraphEdge, type EstimateGraphNode } from "./apply-edl-estimate"
import { activeResult, LEGACY_VIDEO_NODE_DEFAULT_PROVIDER } from "./generation-source-length"
import { nodeProviders } from "./node-fan-out"
import { seedanceTaskTypeAsRun } from "./seedance-task-type-as-run"
import { bypassTeleports } from "./teleport-bypass"

/** The generation nodes a Seedance 2.5 draft is made by (Video to Video: its Seedance 2.5 Edit lane). */
const DRAFT_GENERATION_TYPES: ReadonlySet<string> = new Set(["generate-video", "image-to-video", "text-to-video", "video-to-video"])

/** A finalize's draft, as a run estimate prices it. */
export type SeedanceFinalizeDraftQuote =
  | {
      readonly kind: "planned"
      /** The draft's node, with the draft model as its provider when it names several. */
      readonly draft: EstimateGraphNode
      readonly hasRefVideo: false
      /** The finalize row for the draft's priced length: `seedance-2-5-hd:{N}s`. */
      readonly creditId: string
    }
  | {
      readonly kind: "planned"
      /** The draft's node, with the draft model as its provider when it names several. Its reference clips are the finalize's input seconds. */
      readonly draft: EstimateGraphNode
      readonly hasRefVideo: true
    }
  | {
      readonly kind: "existing"
      /** The draft's provider task id — what the run's finalize names. */
      readonly taskId: string
    }

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined)

/**
 * The draft model a generation node's run sends a draft to, or undefined when
 * its run is no Seedance draft: Draft on, and a model that takes it (Video to
 * Video: its Seedance 2.5 Edit lane). A node naming several models (a Provider
 * list) runs each; the one that drafts is the one a finalize can take.
 */
function draftProviderOf(type: string, data: Record<string, unknown>): string | undefined {
  if (data.draft !== true) return undefined
  if (type === "video-to-video") {
    const provider = str(data.provider)
    return isSeedanceVideoEditProvider(provider) && isSeedanceDraftCapable(provider) ? provider : undefined
  }
  const selected = type === "generate-video"
    ? applyDefaultVideoSelection({ provider: str(data.provider), duration: data.duration as number | string | undefined }).provider
    : (str(data.provider) ?? LEGACY_VIDEO_NODE_DEFAULT_PROVIDER)
  const named = nodeProviders(type, data) ?? [selected]
  return named.find((p) => {
    const runs = type === "generate-video" ? [resolveVideoProviderForMode(p, "image-to-video"), resolveVideoProviderForMode(p, "text-to-video")] : [p]
    return runs.every((m) => isSeedanceDraftCapable(m))
  })
}

/** Whether a reference VIDEO reaches the draft's run (Video to Video always sends its source clip as one). */
function draftSendsReferenceVideo(draft: EstimateGraphNode, edges: readonly EstimateGraphEdge[]): boolean {
  if (draft.type === "video-to-video") return true
  return edges.some((e) => e.target === draft.id && referenceModalityForHandle(e.targetHandle) === "video")
}

/** What a run estimate knows beyond the graph. */
export interface SeedanceFinalizeDraftOptions {
  /**
   * The provider task id a node that does not run again hands on from an
   * earlier run's state, when the estimate has one (an app's Retry is seeded
   * from the failed run's node states, not from the node's data).
   */
  readonly stateTaskIdOf?: (nodeId: string) => string | undefined
}

/**
 * The draft a finalize node will finalize — `planned` when the estimated run
 * makes it (the draft node is in `rerunIds`, or holds neither a result nor a
 * task id yet), `existing` (by its task id) when the run finalizes a take that
 * already exists: the generation does not run again and hands on its task
 * (whatever its settings say now), or the finalize names one itself
 * (`kieTaskId`). Undefined — the finalize is priced as before — with no
 * generation wired, or one that runs and makes no Seedance 2.5 draft (the run
 * refuses it, so nothing is charged).
 *
 * @param finalize the Video Upscale node, as stored (a wired Settings input is read).
 * @param rerunIds the nodes the estimated run executes.
 */
export function seedanceFinalizeDraftQuote(
  finalize: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  rawEdges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
  options: SeedanceFinalizeDraftOptions = {},
): SeedanceFinalizeDraftQuote | undefined {
  if (finalize.type !== "video-upscale") return undefined
  const fData = (withWiredSettings({ id: finalize.id, type: finalize.type, data: finalize.data }, nodes, rawEdges).data ?? {}) as Record<string, unknown>
  if (fData.provider !== SEEDANCE_DRAFT_FINALIZE_PROVIDER) return undefined
  // A finalize that names its draft's task finalizes that take, whatever is wired.
  const named = str(fData.kieTaskId)
  if (named) return { kind: "existing", taskId: named }
  const edges = bypassTeleports(nodes, rawEdges)
  // The video the finalize is wired to: the first generation upstream of it,
  // as the run takes its draft's task from the node that made the clip.
  const origin = edges
    .filter((e) => e.target === finalize.id)
    .map((e) => resolveGraphOrigin(nodes.find((n) => n.id === e.source), nodes, edges))
    .find((n): n is EstimateGraphNode => n !== undefined && DRAFT_GENERATION_TYPES.has(n.type ?? ""))
  if (!origin) return undefined
  const stored = (origin.data ?? {}) as Record<string, unknown>
  const type = origin.type ?? ""
  if (!rerunIds.has(origin.id)) {
    // A node that does not run again hands on the task it already has (its
    // state's, else its data's) and the finalize re-renders that take —
    // whatever the node's settings say now (Draft since turned off, another
    // model chosen), as the run itself takes it; the finalize's gate then
    // prices it, or refuses it when it is no draft.
    const taskId = options.stateTaskIdOf?.(origin.id) ?? str(stored.kieTaskId)
    if (taskId) return { kind: "existing", taskId }
    // A result with no task to name: the run is refused, so it is priced as before.
    if (activeResult(stored) !== undefined) return undefined
  }
  const data = (withWiredSettings({ id: origin.id, type, data: stored }, nodes, edges).data ?? {}) as Record<string, unknown>
  const provider = draftProviderOf(type, data)
  if (!provider) return undefined
  // The draft's node as its draft runs: with that model when it names several.
  const draft: EstimateGraphNode = provider === str(data.provider) ? origin : { ...origin, data: { ...stored, provider } }
  if (draftSendsReferenceVideo(origin, edges)) return { kind: "planned", draft, hasRefVideo: true }
  // No reference video: the draft's length as its run resolves it (a declared
  // Edit or Extend needs a reference video, so nothing moves it here) — the
  // hold of a draft without a reference video.
  const asked = type === "generate-video"
    ? applyDefaultVideoSelection({ provider, duration: data.duration as number | string | undefined }).duration
    : (data.duration as number | string | undefined)
  const run = seedanceTaskTypeAsRun({ provider, duration: asked, data, referenceVideoSec: [] })
  return { kind: "planned", draft, hasRefVideo: false, creditId: seedanceDraftFinalizeCreditId(pricedOutputDurationSec(provider, run.duration), false) }
}
