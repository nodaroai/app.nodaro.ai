/**
 * `@nodaro/sdk/copilot` — the `copilot` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { CopilotResource } from "../resources/copilot.js"

export type {
  CopilotThread,
  CopilotThreadWorkflow,
  CopilotSurface,
  CopilotRunMode,
  CopilotModelTier,
  CopilotMessage,
  CopilotMessagePart,
  CreateCopilotThreadInput,
  CopilotStreamOptions,
  CopilotStreamFrame,
  CopilotMetadataFrameData,
  CopilotToolCallFrameData,
  CopilotWorkflowUpdateFrameData,
  CopilotWorkflowCreatedFrameData,
  CopilotRunProposalFrameData,
  CopilotRunProposalNode,
  CopilotWiredAsset,
  CopilotMemorySavedFrameData,
} from "../resources/copilot.js"
