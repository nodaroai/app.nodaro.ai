/**
 * A workflow save that came back refused (`SaveResult` with `success: false`,
 * `use-workflow-persistence.ts`), as opposed to one that did not say. A run
 * started from the editor runs the SAVED workflow, so a refused save means the
 * server would run something other than what the canvas shows.
 */
export function saveRefused(result: unknown): boolean {
  return typeof result === "object" && result !== null && (result as { success?: unknown }).success === false
}
