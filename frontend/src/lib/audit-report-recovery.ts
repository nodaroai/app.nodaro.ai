/**
 * Video Audit's fix-and-disclose report after a WORKFLOW run.
 *
 * The orchestrator builds a node's output from its job row and keeps it to the
 * graph contract: Video Audit's corrected analysis travels on, its `report` is
 * left behind on purpose (backend `output-extractor.ts ::
 * buildNodeOutputFromJobData`). So every lane that lands a workflow run's
 * result (`jsonRunResultPatch`) writes the analysis with no report, and the
 * node showed the corrected analysis under an empty strip.
 *
 * The report is on the job row the node state names, so it is read back from
 * there: once per job, after the analysis has landed, and written only while
 * the node still shows that analysis with no report of its own — a newer run's
 * result is never given an older disclosure.
 */
import { isSeededState, type SeedableNodeState } from "@/lib/seeded-node-state"

/** A node state as the lanes see it: what this reads. */
export interface AuditRunState extends SeedableNodeState {
  readonly jobId?: string | null
  readonly output?: { readonly json?: unknown; readonly report?: unknown } | null
}

export interface AuditReportRecoveryDeps {
  readonly fetchJob: (jobId: string) => Promise<{ readonly status?: string; readonly output_data?: unknown }>
  readonly readNode: (nodeId: string) => { readonly type?: string; readonly data: Readonly<Record<string, unknown>> } | undefined
  readonly writeNode: (nodeId: string, patch: Record<string, unknown>) => void
}

/** The jobs already asked about in this page's life: a live run's states arrive every few seconds. */
const ASKED = new Set<string>()

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null

/** The node still shows this analysis and has no report of its own. */
function waitsForReport(node: ReturnType<AuditReportRecoveryDeps["readNode"]>, json: unknown): boolean {
  if (node?.type !== "video-audit" || node.data.lastAuditReport !== undefined) return false
  return JSON.stringify(node.data.generatedJson) === JSON.stringify(json)
}

export async function recoverMissingAuditReports(
  states: Readonly<Record<string, AuditRunState>>,
  deps: AuditReportRecoveryDeps,
  asked: Set<string> = ASKED,
): Promise<void> {
  const reads: Promise<void>[] = []
  for (const [nodeId, state] of Object.entries(states)) {
    const jobId = state.jobId
    const output = state.output
    if (state.status !== "completed" || isSeededState(state) || typeof jobId !== "string" || jobId === "") continue
    if (!output || !isObject(output.json) || isObject(output.report)) continue
    if (asked.has(jobId) || !waitsForReport(deps.readNode(nodeId), output.json)) continue
    asked.add(jobId)
    reads.push(
      deps
        .fetchJob(jobId)
        .then((job) => {
          const data = job?.output_data
          const report = isObject(data) ? (data as { report?: unknown }).report : undefined
          if (!isObject(report) || !waitsForReport(deps.readNode(nodeId), output.json)) return
          deps.writeNode(nodeId, { lastAuditReport: report })
        })
        // A job this person may not read (another member's run) or a network
        // failure: the strip stays as it was.
        .catch(() => {}),
    )
  }
  await Promise.all(reads)
}
