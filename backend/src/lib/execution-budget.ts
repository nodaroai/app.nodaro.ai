/**
 * An EXECUTION's budget excess, read from the database — for the clocks that
 * wait on an execution from outside its orchestrator (podcast Track 0.11).
 *
 * The orchestrator keeps the exact figure in memory (`OrchestratorContext.
 * budgetExcessMs`, grown at each budgeted dispatch — `lib/job-budget.ts`). Three
 * clocks cannot see that memory and must reach the same number another way:
 *   - the stale-execution sweeps (boot + 90-s cron), which abandon a `running`
 *     row after `STALE_EXECUTION_THRESHOLD_MS`;
 *   - the component route's background wait on its inner execution
 *     (`routes/component-execute.ts`);
 *   - a parent DAG's component node waiting on the wrapper job
 *     (`node-executor.ts :: executeComponentNode`).
 *
 * The figure is rebuilt from rows every deployment writes to the same
 * database, through the SAME per-job budget function the orchestrator used
 * (`declaredJobBudgetMs` over `jobs.job_type` + `jobs.input_data` — the
 * dispatched payload, spread), so the two cannot disagree about a job:
 *   Σ excess over the execution's budgeted child jobs (`workflow_execution_id`
 *     — inline sub-workflow nodes and fan-out iterations carry it too), plus
 *   Σ excess of each component node's INNER execution (its wrapper job is
 *     named in `node_states`; the inner execution id rides the wrapper's
 *     `input_data._executionId`), recursively to the component depth limit.
 * A sum over every row ever dispatched for the run (superseded attempts
 * included) is an upper bound — the safe side for a clock that decides
 * whether a run is dead.
 *
 * Read LAZILY — only once the clock's base limit is spent — so a run with
 * nothing budgeted never pays for the lookup and times out exactly as before.
 *
 * STATED RESIDUAL: a component node INSIDE an inline sub-workflow is invisible
 * here (its wrapper job is linked to no execution column and to no top-level
 * node state). The orchestrator's own cap still counts it (in memory); only an
 * outside reader waiting on that execution does not.
 */
import { supabase } from "./supabase.js"
import { BUDGETED_JOB_NAMES, budgetExcessMs, declaredJobBudgetMs } from "./job-budget.js"

/** Same limit as component nesting (`executeComponentNode`: depth ≥ 5 refused). */
const MAX_COMPONENT_DEPTH = 5

interface NodeStateJobRefs {
  jobId?: unknown
  jobIds?: unknown
}

function jobIdsOf(nodeStates: Record<string, unknown> | null | undefined): string[] {
  const ids = new Set<string>()
  for (const raw of Object.values(nodeStates ?? {})) {
    const st = raw as NodeStateJobRefs | null
    if (typeof st?.jobId === "string" && st.jobId) ids.add(st.jobId)
    if (Array.isArray(st?.jobIds)) for (const id of st.jobIds) if (typeof id === "string" && id) ids.add(id)
  }
  return [...ids]
}

/**
 * Σ budget excess (ms) of `executionId`: its own budgeted jobs plus its
 * component nodes' inner executions. Best-effort: a failed read counts as 0
 * for that part, which leaves the caller on its default (today's) limit.
 * `nodeStates` skips the row read when the caller already holds them.
 */
export async function executionBudgetExcessMs(
  executionId: string,
  nodeStates?: Record<string, unknown> | null,
  depth = 0,
  visited: Set<string> = new Set(),
): Promise<number> {
  if (!executionId || visited.has(executionId) || depth > MAX_COMPONENT_DEPTH) return 0
  visited.add(executionId)
  let total = 0

  try {
    const { data: jobs } = await supabase
      .from("jobs")
      .select("job_type, input_data")
      .eq("workflow_execution_id", executionId)
      .in("job_type", [...BUDGETED_JOB_NAMES])
    for (const row of (jobs ?? []) as Array<{ job_type?: unknown; input_data?: unknown }>) {
      if (typeof row.job_type !== "string") continue
      total += budgetExcessMs(declaredJobBudgetMs(row.job_type, row.input_data))
    }
  } catch {
    /* best-effort — see the doc */
  }

  try {
    let states = nodeStates
    if (states === undefined) {
      const { data: exec } = await supabase
        .from("workflow_executions")
        .select("node_states")
        .eq("id", executionId)
        .maybeSingle()
      states = (exec?.node_states as Record<string, unknown> | null | undefined) ?? null
    }
    const ids = jobIdsOf(states)
    if (ids.length > 0) {
      const { data: wrappers } = await supabase
        .from("jobs")
        .select("input_data")
        .in("id", ids)
        .eq("provider", "component")
      for (const w of (wrappers ?? []) as Array<{ input_data?: Record<string, unknown> | null }>) {
        const inner = w.input_data?._executionId
        if (typeof inner === "string") total += await executionBudgetExcessMs(inner, undefined, depth + 1, visited)
      }
    }
  } catch {
    /* best-effort — see the doc */
  }

  return total
}

/** Execution statuses in which the orchestrator may still dispatch a job. */
const DISPATCHING_EXECUTION_STATUSES: ReadonlySet<string> = new Set(["pending", "running"])
/** Node statuses after which a node dispatches nothing more. */
const SETTLED_NODE_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "skipped"])
const BUDGETED_NODE_TYPES: ReadonlySet<string> = new Set(BUDGETED_JOB_NAMES)

interface NodeStateRow extends NodeStateJobRefs {
  status?: unknown
  nodeType?: unknown
}

/**
 * Whether `executionId` may STILL dispatch a budgeted job — a node whose type
 * declares a budget (`BUDGETED_JOB_NAMES`; every name is also its node type)
 * that has not settled, in an execution that is still `pending`/`running`, or
 * the same inside an unsettled component node's inner execution, recursively.
 *
 * WHY. `executionBudgetExcessMs` sees a long render only once its job row
 * carries the EDL — after dispatch. A clock that asks BEFORE that (the editor's
 * component wait, at its 30-minute mark, while the run is still transcribing)
 * would read "nothing budgeted" and give up on a run the server keeps waiting
 * on. This is the other half of the answer: "not dispatched YET".
 *
 * Read from `node_states`, which the orchestrator initialises with every
 * executable node's `nodeType` when the run starts. Unknown is answered `true`
 * — the upper bound, the safe side for a clock deciding whether to abandon a
 * run: an execution the orchestrator has not picked up yet (`pending`, no node
 * states), and a failed read. `true` only ever lets a client wait up to the
 * server's own base wait, never past it.
 *
 * STATED RESIDUALS (answered `false`): a component node that has not dispatched
 * its wrapper yet (its inner run does not exist, and its app is not resolved
 * here), and a budgeted node inside an inline sub-workflow (not a top-level
 * node state).
 */
export async function executionMayDispatchBudgetedJob(
  executionId: string,
  depth = 0,
  visited: Set<string> = new Set(),
): Promise<boolean> {
  if (!executionId || visited.has(executionId) || depth > MAX_COMPONENT_DEPTH) return false
  visited.add(executionId)
  try {
    const { data: exec, error } = await supabase
      .from("workflow_executions")
      .select("status, node_states")
      .eq("id", executionId)
      .maybeSingle()
    if (error) return true
    if (!exec) return false
    if (!DISPATCHING_EXECUTION_STATUSES.has(exec.status as string)) return false
    const states = exec.node_states as Record<string, NodeStateRow | null> | null | undefined
    // Not picked up yet: the node states (and so the node types) are unknown.
    if (exec.status === "pending" || !states) return true

    const unsettled: Record<string, NodeStateRow> = {}
    for (const [id, st] of Object.entries(states)) {
      if (!st || SETTLED_NODE_STATUSES.has(st.status as string)) continue
      if (typeof st.nodeType === "string" && BUDGETED_NODE_TYPES.has(st.nodeType)) return true
      unsettled[id] = st
    }

    const ids = jobIdsOf(unsettled)
    if (ids.length === 0) return false
    const { data: wrappers, error: wrapErr } = await supabase
      .from("jobs")
      .select("input_data")
      .in("id", ids)
      .eq("provider", "component")
    if (wrapErr) return true
    for (const w of (wrappers ?? []) as Array<{ input_data?: Record<string, unknown> | null }>) {
      const inner = w.input_data?._executionId
      if (typeof inner === "string" && (await executionMayDispatchBudgetedJob(inner, depth + 1, visited))) return true
    }
    return false
  } catch {
    return true
  }
}

/**
 * A wait whose limit is `baseMs` plus a budget excess looked up ONLY once the
 * limit is reached — and again each time the grown limit is reached, since an
 * execution's excess only grows as it dispatches long renders. `reached` is
 * `elapsed >= limit`, the exit condition of the `while (elapsed < LIMIT)` loops
 * it replaces, so with nothing budgeted it reports exactly when they exited.
 * A failed lookup keeps the excess already known.
 */
export class BudgetedDeadline {
  private excess = 0

  constructor(
    private readonly baseMs: number,
    private readonly readExcessMs: () => Promise<number>,
  ) {}

  /** The current limit: base + the largest excess seen so far. */
  get limitMs(): number {
    return this.baseMs + this.excess
  }

  /** The largest excess seen so far (0 until a lookup found one). */
  get excessMs(): number {
    return this.excess
  }

  async reached(elapsedMs: number): Promise<boolean> {
    if (elapsedMs < this.limitMs) return false
    await this.refresh()
    return elapsedMs >= this.limitMs
  }

  /** Look the excess up now (never shrinks). */
  async refresh(): Promise<number> {
    try {
      const fresh = await this.readExcessMs()
      if (Number.isFinite(fresh) && fresh > this.excess) this.excess = fresh
    } catch {
      /* keep what is known */
    }
    return this.excess
  }
}
