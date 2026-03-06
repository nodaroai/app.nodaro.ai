/** Workflow execution statuses that indicate an active (non-terminal) execution. */
export const ACTIVE_EXECUTION_STATUSES = ["pending", "running", "stopping"] as const

/**
 * Extracts an optional workflowId from the raw request body.
 * The field is NOT part of any Zod schema — it's injected by the frontend
 * so standalone (single-node) jobs can be associated with a workflow for
 * display in the execution history.
 */
export function extractWorkflowId(body: unknown): string | null {
  if (body && typeof body === "object" && "workflowId" in body) {
    const val = (body as Record<string, unknown>).workflowId
    if (typeof val === "string" && val.length > 0) return val
  }
  return null
}
