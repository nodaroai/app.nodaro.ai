import { NotFoundError } from "@nodaro/client"

/**
 * True for a definitive HTTP 404 from any layer:
 *  - `NotFoundError` thrown by the typed SDK (`getWorkflowExecution`, etc.)
 *  - the SSE client's `SseHttpError` (carries a numeric `status`)
 *  - any error object carrying `status === 404`
 *
 * A 404 means the resource is GONE, not a transient network blip — callers use
 * this to stop polling/streaming immediately instead of hammering a dead
 * endpoint (the workflow-execution "404 storm").
 */
export function isNotFound(err: unknown): boolean {
  if (err instanceof NotFoundError) return true
  if (err != null && typeof err === "object" && "status" in err) {
    return (err as { status?: unknown }).status === 404
  }
  return false
}
