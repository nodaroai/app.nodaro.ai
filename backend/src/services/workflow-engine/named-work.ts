/**
 * Which nodes a continue-from-failed may run because the caller NAMED them.
 *
 * Every id in an explicit `nodeIds` counts as named. A named node that no run
 * of the chain ever ran (a placeholder, `completedFor` in `@nodaro/render-rules`)
 * runs and is priced instead of reading as completed — but only a node the
 * engine would execute. A source, a trigger, a parameter picker or a
 * container is handed on, never executed: putting one in the run set would
 * drop its seed from the earlier execution (a named webhook trigger would hand
 * on nothing). A frozen node and a lottie node frozen by its `motionPlan`
 * override are seeded from their saved data whether or not they are in the run
 * set: naming one would price a run that does nothing.
 *
 * The route (`routes/workflow-execution.ts`) and the orchestrator ask THIS
 * function, over the graph with the run's merged overrides applied (the
 * earlier run's pin with the sent overrides over it), so the two cannot
 * disagree on what a named node is.
 */

import { withRunOverrides } from "@nodaro/shared/nodes"
import { getEffectivelySkippedIds, runsInALevel } from "./execution-graph.js"
import { migrateLegacyNodeType } from "./normalize-node-types.js"

type Overrides = Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined

interface NamedNode {
  readonly id: string
  readonly type?: string
  readonly data?: unknown
}

/**
 * Freeze-on-exposure gate (design F16): true when this run carries a lottie
 * motionPlan override for `node` AND the node is a motion-graphics node whose
 * (already override-merged) plan is a lottie-graphic. Such a node must be
 * pre-completed with its overridden plan instead of re-generated — the creator
 * exposed slot fields, so end-users edit the published animation rather than
 * re-rolling it (no re-generation, no 5cr re-charge). The PRESENCE of a
 * `motionPlan` key in the override is the freeze signal; the frontend
 * (composeLottieSlotOverrides) emits one for EVERY slot-exposed lottie node,
 * even when the user touched nothing.
 *
 * Covers BOTH the presentation route and the app route: both enqueue the same
 * orchestrator job with `inputOverrides`, so this one gate fires for both.
 */
export function isFrozenLottieOverride(node: NamedNode, inputOverrides: Overrides): boolean {
  if (node.type !== "motion-graphics") return false
  const override = inputOverrides?.[node.id]
  if (!override || !("motionPlan" in override)) return false
  const plan = (node.data as Record<string, unknown> | undefined)?.motionPlan as Record<string, unknown> | undefined
  return plan?.planType === "lottie-graphic"
}

/**
 * The ids of `named` the run may execute, in their first-sent order, once:
 * nodes of `nodes` (the saved graph, before any override) dispatched through a
 * level under their current type name, neither frozen nor lottie-frozen once
 * `overrides` (the merged map the run applies) are merged in. Pure.
 */
export function namedWorkNodeIds(
  nodes: readonly NamedNode[],
  named: readonly string[],
  overrides: Overrides,
): string[] {
  if (named.length === 0) return []
  const wanted = new Set(named)
  const merged = withRunOverrides(
    nodes
      .filter((node) => wanted.has(node.id))
      .map((node) => {
        const current = migrateLegacyNodeType(node)
        return { id: current.id, type: current.type ?? "", data: (current.data ?? {}) as Record<string, unknown> }
      }),
    overrides,
  )
  const frozen = getEffectivelySkippedIds(merged, [])
  const ofWork = new Set(
    merged
      .filter((node) => runsInALevel(node.type) && !frozen.has(node.id) && !isFrozenLottieOverride(node, overrides))
      .map((node) => node.id),
  )
  return [...wanted].filter((id) => ofWork.has(id))
}
