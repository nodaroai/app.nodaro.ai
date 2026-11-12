/**
 * The editor's side of a Generate Video node's Seedance reference task type
 * (`referenceTaskType`, "Use the reference video as"): which stored value is
 * stale, and the length a run is priced at once the server has resolved it.
 * The UI (the select and the locks it shows) lives in
 * `components/editor/config-panels/seedance-task-type-select.tsx`.
 *
 * The server resolves `referenceTaskType` before it prices, by the shared rule
 * (`resolveSeedanceTaskType`, @nodaro/shared): a declared Edit runs at
 * automatic length, an Extend at automatic length runs at the model's default,
 * and anything it cannot honour moves nothing. This module only hands that rule
 * what the editor knows — never restates it — so the editor's price id (the
 * node's cost pill and the run-level estimate both build it with
 * `videoGenerationCreditId`) names the row the run reserves under.
 *
 * What the editor knows of each wired reference video is its recorded length
 * (`forwardedVideoLengthSec`, @nodaro/render-rules: an upload's measured
 * length, a generated clip's result length or configured duration). A clip it
 * does not know — none recorded, or its source re-runs in this run, so the run
 * sends a new clip — counts as the model's longest accepted clip
 * (`VIDEO_REF_VIDEO_DURATION_LIMITS`), as the server counts a clip it cannot
 * measure: the declaration holds and the quote is the higher one. A quote may
 * be above the charge, never below it.
 *
 * The AMOUNT of such a run is the server's quote (`seedance-ref-quote.ts`),
 * which measures the clips itself; the id built from this length is what the
 * editor prices with until that quote is in.
 */
import { listedSeedanceTaskType, supportsReferenceTaskType } from "@nodaro/shared/models"
import { seedanceTaskTypeAsRun, wiredReferenceVideoSec } from "@nodaro/render-rules"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * The ONE answer to "does this node's run edit or extend, and at what length"
 * (`seedanceTaskTypeAsRun`), and the wired clips it reads
 * (`wiredReferenceVideoSec`), live in @nodaro/render-rules: the node's cost
 * pill, the run-level estimate ({@link seedanceTaskTypeRunDuration}), the
 * settings panel's locks and both estimators' reading of the video the node
 * makes all read them, so they cannot disagree.
 */
export { seedanceTaskTypeAsRun, wiredReferenceVideoSec, type SeedanceTaskTypeAsRun } from "@nodaro/render-rules"

/**
 * Fail-safe for the provider-change snap (Provider Enum Sync 12b): true when
 * the node carries a task type on a model that takes none — the snap then
 * clears it, so a stale Edit never rides a later switch back unnoticed.
 */
export function hasStaleSeedanceTaskType(provider: string | undefined, value: unknown): boolean {
  return value !== undefined && !supportsReferenceTaskType(provider)
}

/**
 * The duration to price a video generation node's run at — the length of
 * {@link seedanceTaskTypeAsRun} for the clips wired into it in the graph.
 * A node without the setting gets `duration` back without the graph being read.
 *
 * @param provider the model the run uses (wired Settings and the default model applied).
 * @param duration the length the node asks for, as the run reads it.
 * @param data the node's data (wired Settings applied): `referenceTaskType`, `aspectRatio`.
 * @param rerunIds the nodes the priced run executes (empty for a single node's own price).
 */
export function seedanceTaskTypeRunDuration(args: {
  readonly nodeId: string
  readonly provider: string
  readonly duration: number | string | undefined
  readonly data: Readonly<Record<string, unknown>>
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly edges: ReadonlyArray<WorkflowEdge>
  readonly rerunIds?: ReadonlySet<string>
}): number | string | undefined {
  const { provider, duration, data } = args
  if (listedSeedanceTaskType(provider, data.referenceTaskType) === undefined) return duration
  const referenceVideoSec = wiredReferenceVideoSec(args.nodeId, args.nodes, args.edges, args.rerunIds)
  return seedanceTaskTypeAsRun({ provider, duration, data, referenceVideoSec }).duration
}

/**
 * The reference clips' lengths as one string — what a store selector returns
 * (a primitive, so the selector is stable); {@link referenceVideoSecOfKey}
 * reads it back. A length that is not known stays not known.
 */
export function wiredReferenceVideoSecKey(
  nodeId: string,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): string {
  return JSON.stringify(wiredReferenceVideoSec(nodeId, nodes, edges).map((sec) => sec ?? null))
}

/** The lengths {@link wiredReferenceVideoSecKey} wrote. */
export function referenceVideoSecOfKey(key: string): Array<number | undefined> {
  const parsed = JSON.parse(key) as Array<number | null>
  return parsed.map((sec) => (typeof sec === "number" ? sec : undefined))
}
