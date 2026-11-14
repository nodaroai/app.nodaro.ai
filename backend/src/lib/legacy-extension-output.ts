/**
 * Extend and Upscale Video nodes saved before their own run's output task was
 * recorded apart, read as the database records them.
 *
 * An Extend or Upscale Video node holds in `kieTaskId` the task it works ON,
 * and records its own run's output task apart, in `outputKieTaskId`
 * (`@nodaro/render-rules` upstream-task.ts). Before that field existed, a
 * server run's sync wrote the node's OUTPUT task over its `kieTaskId`. Wired
 * to a source that fits, the shared rule tells the two apart (a saved task
 * that differs from what the source hands on is the node's own output). Wired
 * to none — always so for a node an MCP call built — the graph alone cannot:
 * the task is read as the node's input, so the node hands nothing on and runs
 * again on its own old output.
 *
 * The database can tell. A saved `kieTaskId` is that node's own OUTPUT exactly
 * when it is the provider task of a COMPLETED job of the node's own type
 * (`extend-video` / `video-upscale`), made by that node (`input_data.node_id`)
 * in a run of THIS workflow (the job's execution's `workflow_id` — node ids are
 * unique only within a workflow, and an MCP client may name its nodes as it
 * likes), for the user running the graph, not in the Trash, whose own input
 * (`input_data.kieTaskId`) was another task — a job whose provider task is its
 * input (a VEO 1080p upscale reads the generation's task) made no new one.
 * Such a node is then read as recorded apart: the task goes to
 * `outputKieTaskId` (unless a newer output is recorded there already — a node
 * that ran again since keeps the older one in `kieTaskId`), handed on to a
 * target that fits, and its `kieTaskId` becomes the job's own input, the task
 * the node really works on (none when the job recorded none: the node is
 * refused before anything is held rather than run on its own output). Jobs
 * that disagree on that input leave it as stored.
 *
 * Only the server can ask: the editor reads the run's output from the run's
 * own sync (`outputKieTaskId`) and keeps the shared rule. One bounded query,
 * and none at all when no node needs it or the run has no workflow. A lookup
 * that fails leaves the graph exactly as stored.
 */
import { RUN_OUTPUT_TASK_FIELD, upstreamTaskFits } from "@nodaro/render-rules"
import { supabase } from "./supabase.js"
import { TRASHED_JOB_COLUMN } from "./public-job-data.js"

/** The node types whose `kieTaskId` is the task they work on (render-rules' task consumers). */
const TASK_CONSUMER_TYPES = ["extend-video", "video-upscale"] as const

/** At most this many saved tasks are asked about in one run: a graph with more is read for these only. */
const MAX_TASKS = 50

/** Rows read for them: more than this (a task carried by many jobs) is not read as an answer. */
const MAX_ROWS = 200

/** Whose run, of which workflow, the graph is read for. */
export interface LegacyOutputScope {
  /** The user the run's jobs belong to (the runner). */
  readonly userId: string
  /** The workflow the run executes; none (an inline graph) asks nothing. */
  readonly workflowId: string | null | undefined
}

/** One job, as the rule reads it (each field as SQL's `->>` reads it; absent = null). */
export interface LegacyOutputJob {
  readonly userId: string | null
  readonly status: string | null
  readonly jobType: string | null
  /** `provider_task_id`: the task the job made. */
  readonly taskId: string | null
  /** `input_data.node_id`: the node a workflow run made it for. */
  readonly nodeId: string | null
  /** The workflow of the run that made it (its execution's `workflow_id`). */
  readonly workflowId: string | null
  /** `input_data.kieTaskId`: the task it worked on. */
  readonly inputTask: string | null
  readonly deletedAt: string | null
}

/** The completed, not-trashed jobs of the scope's user, made in runs of its workflow, whose provider task is one of `taskIds`. Injected in tests. */
export type FetchLegacyOutputJobs = (scope: { readonly userId: string; readonly workflowId: string }, taskIds: readonly string[]) => Promise<readonly LegacyOutputJob[]>

interface GraphNode {
  readonly id: string
  readonly type?: string
  readonly data?: unknown
}

interface GraphEdge {
  readonly source: string
  readonly target: string
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined)
const sqlText = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

/** The run a job belongs to, through its key (`jobs` and `workflow_executions` are joined by two). */
const EXECUTION_EMBED = "execution:workflow_executions!workflow_execution_id!inner(workflow_id)"

export const fetchLegacyOutputJobs: FetchLegacyOutputJobs = async (scope, taskIds) => {
  const { data, error } = await supabase
    .from("jobs")
    .select(`user_id, status, job_type, provider_task_id, ${TRASHED_JOB_COLUMN}, node_id:input_data->>node_id, input_task:input_data->>kieTaskId, ${EXECUTION_EMBED}`)
    .in("provider_task_id", [...taskIds])
    .eq("user_id", scope.userId)
    .eq("status", "completed")
    .in("job_type", [...TASK_CONSUMER_TYPES])
    .is(TRASHED_JOB_COLUMN, null)
    .eq("execution.workflow_id", scope.workflowId)
    .limit(MAX_ROWS)
  if (error) throw new Error(`legacy extension outputs: ${error.message}`)
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
  if (rows.length >= MAX_ROWS) throw new Error(`legacy extension outputs: ${rows.length} rows, more than the lookup reads`)
  return rows.map((row) => {
    const execution = row.execution
    const run = (Array.isArray(execution) ? execution[0] : execution) as { workflow_id?: unknown } | null | undefined
    return {
      userId: sqlText(row.user_id),
      status: sqlText(row.status),
      jobType: sqlText(row.job_type),
      taskId: sqlText(row.provider_task_id),
      nodeId: sqlText(row.node_id),
      workflowId: sqlText(run?.workflow_id),
      inputTask: sqlText(row.input_task),
      deletedAt: sqlText(row[TRASHED_JOB_COLUMN]),
    }
  })
}

/**
 * A node whose saved `kieTaskId` the graph cannot read: a task consumer wired
 * to no source that fits. Asked whether or not it records an output apart: a
 * node that ran again since holds its NEWEST output in `outputKieTaskId` and
 * still holds the older one in `kieTaskId`, which nothing rewrites — except
 * when the two are the same task: such a node continues from its own output
 * on purpose, and a legacy node's never are.
 */
function savedTaskToAsk(node: GraphNode, nodes: readonly GraphNode[], edges: readonly GraphEdge[]): string | undefined {
  if (!(TASK_CONSUMER_TYPES as readonly string[]).includes(node.type ?? "")) return undefined
  const data = (node.data ?? {}) as Record<string, unknown>
  const saved = str(data.kieTaskId)
  if (saved === undefined || saved === str(data[RUN_OUTPUT_TASK_FIELD])) return undefined
  const fittingSourceWired = edges.some((e) => {
    if (e.target !== node.id) return false
    const source = nodes.find((n) => n.id === e.source)
    return source !== undefined && upstreamTaskFits(node, source)
  })
  return fittingSourceWired ? undefined : saved
}

/**
 * `nodes` with every Extend / Upscale Video node whose saved `kieTaskId` the
 * database shows to be its own output read as recorded apart (see the module
 * note) — the SAME array when nothing changed, a copy with new node objects
 * otherwise.
 */
export async function withLegacyExtensionOutputs<N extends GraphNode>(
  nodes: readonly N[],
  edges: readonly GraphEdge[],
  scope: LegacyOutputScope,
  opts: { readonly fetchJobs?: FetchLegacyOutputJobs } = {},
): Promise<readonly N[]> {
  const userId = str(scope.userId)
  const workflowId = str(scope.workflowId)
  if (userId === undefined || workflowId === undefined) return nodes
  const asked = new Map<string, string>()
  for (const node of nodes) {
    const task = savedTaskToAsk(node, nodes, edges)
    if (task !== undefined) asked.set(node.id, task)
  }
  const tasks = [...new Set(asked.values())].slice(0, MAX_TASKS)
  if (tasks.length === 0) return nodes
  let jobs: readonly LegacyOutputJob[]
  try {
    jobs = await (opts.fetchJobs ?? fetchLegacyOutputJobs)({ userId, workflowId }, tasks)
  } catch (err) {
    console.warn("[legacy-extension-output] lookup failed; the graph runs as stored:", err instanceof Error ? err.message : err)
    return nodes
  }
  let changed = false
  const out = nodes.map((node) => {
    const saved = asked.get(node.id)
    if (saved === undefined || !tasks.includes(saved)) return node
    // Held here too: the answer never rests on the query's filters alone.
    const own = jobs.filter(
      (j) =>
        j.taskId?.trim() === saved &&
        j.userId === userId &&
        j.status === "completed" &&
        j.deletedAt === null &&
        j.jobType === node.type &&
        j.nodeId === node.id &&
        j.workflowId === workflowId &&
        str(j.inputTask) !== saved,
    )
    if (own.length === 0) return node
    const inputs = new Set(own.map((j) => str(j.inputTask) ?? ""))
    if (inputs.size !== 1) return node
    const input = [...inputs][0]!
    const { kieTaskId: _ownOutput, ...rest } = (node.data ?? {}) as Record<string, unknown>
    changed = true
    // An output already recorded apart is newer than the saved one: it is kept.
    const output = str(rest[RUN_OUTPUT_TASK_FIELD]) ?? saved
    return { ...node, data: { ...rest, ...(input !== "" ? { kieTaskId: input } : {}), [RUN_OUTPUT_TASK_FIELD]: output } }
  })
  return changed ? out : nodes
}
