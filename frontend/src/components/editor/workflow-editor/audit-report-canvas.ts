/**
 * The canvas side of `lib/audit-report-recovery.ts`: Video Audit's report read
 * back from its job row onto the node in the editor's store. Called by the live
 * run lane and once by the reopen lanes, after the run's states have landed.
 */
import { getJobStatusLean } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { recoverMissingAuditReports, type AuditRunState } from "@/lib/audit-report-recovery"

export function recoverAuditReportsOnCanvas(states: Readonly<Record<string, AuditRunState>>): void {
  void recoverMissingAuditReports(states, {
    // async: a throw becomes a rejection the recovery swallows.
    fetchJob: async (jobId) => getJobStatusLean(jobId), // raw-status-ok: one read of a COMPLETED job's report, not a poll loop
    readNode: (nodeId) => {
      const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
      return node ? { type: node.type, data: node.data as Record<string, unknown> } : undefined
    },
    writeNode: (nodeId, patch) => useWorkflowStore.getState().updateNodeData(nodeId, patch),
  })
}
