import type { NodaroClient } from "../client.js"

/**
 * Result of a soft-delete (archive) operation. The run is moved to the user's
 * archive in the Nodaro UI; restoration and permanent deletion are UI-only by
 * design — SDK / MCP / API delete callers can't accidentally destroy data.
 */
export interface DeleteAppRunResult {
  success: true
  archived: true
}

export class AppsResource {
  constructor(private client: NodaroClient) {}

  /**
   * Archive (soft-delete) a published-app run. The run is hidden from the
   * default run list and can be restored or permanently deleted from the
   * archive view at https://app.nodaro.ai/archived-runs.
   *
   * @param slug   The published app's slug (the last path segment of its URL).
   * @param runId  The run's UUID.
   */
  deleteRun(slug: string, runId: string): Promise<DeleteAppRunResult> {
    return this.client.request(
      "DELETE",
      `/v1/app/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}`,
    )
  }
}
