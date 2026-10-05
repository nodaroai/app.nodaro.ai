/**
 * "This run never ran this node — it handed the node's SAVED output on."
 *
 * The orchestrator gives every node it does not run a completed state built
 * from the node's saved data: a source or parameter node, a node frozen with
 * Skip, and every node outside a "Run from here" / "Run selected" subset
 * (`seededFromSavedData`, backend `saved-data.ts`). Such a state reaches the
 * editor like any other — over the stream, and in the executions the editor
 * reads back on load — but its `output` is the node's own saved result read
 * back, not something this run produced.
 *
 * Writing it onto the node is therefore never right, and for Edit Plan it is
 * harmful: once the plan's run results are mapped onto `generatedJson`, a
 * seeded plan written back would replace the planner's output with whatever
 * the seed carried. So every lane that paints a run's states onto the canvas
 * asks this first and writes no result field for a seeded state.
 *
 * Two signals, one answer. `fromSavedData: true` is what the orchestrator
 * stamps today; runs saved before it did (the field arrived on 2026-10-02) are
 * told apart by the same rule the Telegram follow lane uses: a node this run
 * executed always carries the time it started (`startedAt`), and a seeded one
 * never does. A state that names its job (`jobId`) ran too, whatever else it
 * lacks: a seeded state is never given one.
 */
export interface SeedableNodeState {
  readonly status: string
  readonly startedAt?: string | null
  readonly fromSavedData?: boolean
  readonly jobId?: string | null
}

export function isSeededState(state: SeedableNodeState): boolean {
  if (state.fromSavedData === true) return true
  return state.status === "completed" && !state.startedAt && !state.jobId
}
