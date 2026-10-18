/**
 * `@nodaro/sdk/pipelines` — the `pipelines` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { PipelinesResource } from "../resources/pipelines.js"

export type {
  BranchPipelineInput,
  BranchPipelineResult,
  ChatTurn,
  ChatStageResult,
  ApplyChatProposalResult,
} from "../resources/pipelines.js"

export type {
  PipelineStageName,
  PipelineInput,
  PipelineStatus,
  PipelineMode,
  SubGateName,
  AnimateSubGate,
  ChatEnabledStage,
  ProposedChange,
} from "../resources/pipelines.js"

export type { PipelineRecord, PendingApproval, PipelineTimeline } from "../resources/pipelines.js"
