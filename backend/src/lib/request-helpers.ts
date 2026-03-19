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

/**
 * Extracts an optional forcePrivate flag from the raw request body.
 * Like workflowId, this is NOT part of Zod schemas — it's injected by the
 * frontend/orchestrator when the node uses uploaded/private input content.
 */
export function extractForcePrivate(body: unknown): boolean {
  if (body && typeof body === "object" && "forcePrivate" in body) {
    return (body as Record<string, unknown>).forcePrivate === true
  }
  return false
}

/**
 * Extracts a provider string from the raw request body before Zod parsing.
 * Used in creditGuard preHandlers where the parsed body isn't yet available.
 */
export function extractProvider(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "provider" in body) {
    const val = (body as Record<string, unknown>).provider
    if (typeof val === "string" && val.length > 0) return val
  }
  return fallback
}
