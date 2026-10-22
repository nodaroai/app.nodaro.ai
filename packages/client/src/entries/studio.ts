/**
 * `@nodaro/sdk/studio` — the `studio` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export {
  StudioResource,
  StudioProductionsResource,
  isStudioGenerateEstimate,
  type StudioGenerateResult,
  type StudioJobStartedResponse,
  type StudioGenerateOptions,
  type ListStudioProductionsOptions,
  type GetProductionOptions,
  type StudioExportPlanOptions,
  type StudioProduction,
  type StudioProductionDetail,
  type StudioPlanIssue,
  type StudioSkillResponse,
  type StudioValidatePlanResponse,
  type StudioListProductionsResponse,
  type StudioImportSummary,
  type StudioProductionResponse,
  type StudioCreateProductionRequest,
  type StudioClientRequestId,
  type StudioOpsRequest,
  type StudioOpsImpact,
  type StudioOpsText,
  type StudioOpsReceipt,
  type StudioOpsResponse,
  type StudioOpClass,
  type StudioOpsDryRunReceipt,
  type StudioOpsDryRunResponse,
  type StudioReconcileResponse,
  type StudioDescribeRequest,
  type StudioGenerateRequest,
  type StudioVideoLane,
  type StudioGenerateEstimate,
  type StudioGenerateResponse,
  type StudioFrameRequest,
  type StudioVoiceRequest,
  type StudioRevoiceRequest,
  type StudioMusicRequest,
  type StudioMediaResponse,
  type StudioExportPlanResponse,
  type StudioExportStep,
  type StudioCloneRequest,
} from "../resources/studio.js"

export { type StudioDocumentJson, type StudioProductionCapabilities, type StudioKeyframeRecord, type StudioProductionRecord, type StudioProductionReply, type StudioEditInput, type StudioKeyframeGenerationInput, type StudioKeyframeAcceptanceInput, type StudioShotGenerationInput, type StudioGenerationReply } from "../resources/studio.js"
