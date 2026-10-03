import { listWorkflowExecutions } from "@/lib/api"

/** Runs per page in the Executions tab. */
export const EXECUTIONS_PAGE_SIZE = 20

/**
 * One page of a workflow's runs, as the Executions tab lists it. The editor's
 * run notices read the first page through this same key, so the two share one
 * cache entry: no second copy of the list to poll, and a View from a notice
 * never meets an older copy that still shows the run as running.
 */
export function executionsPageQuery(workflowId: string, cursor?: string) {
  return {
    queryKey: ["workflow-executions", workflowId, cursor] as const,
    queryFn: () => listWorkflowExecutions(workflowId, { limit: EXECUTIONS_PAGE_SIZE, cursor }),
  }
}
