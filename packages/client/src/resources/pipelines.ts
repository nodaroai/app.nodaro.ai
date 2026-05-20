import type { NodaroClient } from "../client.js"
import type { PipelineStageName } from "@nodaro/shared"

export type { PipelineStageName }

export interface BranchPipelineInput {
  /** The stage to re-run from. Upstream stages are cloned as approved. */
  fromStage: PipelineStageName
}

export interface BranchPipelineResult {
  /** The id of the newly created pipeline. */
  pipelineId: string
  /** Stage names that were cloned as 'approved' (stages before `fromStage`). */
  clonedStages: string[]
  /** Number of entity rows cloned into the new pipeline. */
  clonedEntities: number
}

export class PipelinesResource {
  constructor(private client: NodaroClient) {}

  /**
   * Branch a completed pipeline into a new pipeline that re-runs from the
   * given stage. The original pipeline's upstream stages and entities are
   * cloned into the new pipeline; downstream stages are created by the
   * orchestrator as it advances.
   *
   * Requires `pipelines:execute` scope.
   * The source pipeline must have `status='completed'`.
   *
   * @returns 201 with `{ pipelineId, clonedStages, clonedEntities }`.
   */
  branch(id: string, input: BranchPipelineInput): Promise<BranchPipelineResult> {
    return this.client.request(
      "POST",
      `/v1/pipelines/${encodeURIComponent(id)}/branch`,
      { body: input },
    )
  }
}
