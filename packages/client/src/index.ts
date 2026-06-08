export { createClient, NodaroClient } from "./client.js"
export type { ClientOptions, UserIdentity } from "./client.js"

export {
  type Auth,
  StaticTokenAuth,
  CallbackAuth,
  supabaseAuth,
} from "./auth.js"

export {
  NodaroError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  InsufficientCreditsError,
  StorageExceededError,
  JobFailedError,
  JobTimeoutError,
  JobAbortedError,
  throwFromResponse,
} from "./errors.js"

// Re-export selected types from @nodaro/shared for convenience
export type {
  GenericNode,
  GenericEdge,
  WorkflowExport,
  WorkflowExportCharacter,
  WorkflowExportObject,
  WorkflowExportLocation,
} from "@nodaro/shared"

// --- Resource classes (re-exported so consumers can typecheck `client.workflows`, etc.) ---
export { WorkflowsResource } from "./resources/workflows.js"
export { ProjectsResource } from "./resources/projects.js"
export { JobsResource } from "./resources/jobs.js"
export { ExecutionsResource } from "./resources/executions.js"
export { NodesResource } from "./resources/nodes.js"
export { DeveloperAppsResource } from "./resources/developer-apps.js"
export { OAuthResource } from "./resources/oauth.js"
export { AppsResource } from "./resources/apps.js"
export { CharactersResource } from "./resources/characters.js"
export { LocationsResource } from "./resources/locations.js"
export { ObjectsResource } from "./resources/objects.js"
export { PipelinesResource } from "./resources/pipelines.js"
export { ReduceResource } from "./resources/reduce.js"
export { PromptHelperResource } from "./resources/prompt-helper.js"
export { VoicesResource } from "./resources/voices.js"
export { CreditsResource } from "./resources/credits.js"
export { UploadsResource } from "./resources/uploads.js"
export { PresetsResource } from "./resources/node-presets.js"
export { CommunityResource } from "./resources/community.js"

// --- Resource type definitions ---
export type {
  Workflow,
  ListWorkflowsParams,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  RunWorkflowParams,
  RunWorkflowResult,
} from "./resources/workflows.js"

export type {
  Project,
  CreateProjectInput,
  UpdateProjectInput,
} from "./resources/projects.js"

export type { Job, JobStatus, JobStatusResult, CancelJobResult } from "./resources/jobs.js"

export type {
  WorkflowExecution,
  WorkflowExecutionSummary,
  NodeExecutionState,
  ExecutionStatus,
  ExecutionTriggerType,
  ListExecutionsForWorkflowParams,
  ListExecutionsPage,
  CancelExecutionParams,
} from "./resources/executions.js"

export type {
  NodeDescriptor,
  NodeCategory,
  OutputType,
  NodeInputField,
  NodeInputSchema,
} from "./resources/nodes.js"

export type {
  DeveloperApp,
  DeveloperAppScope,
  DeveloperAppStatus,
  CreateDeveloperAppInput,
  UpdateDeveloperAppInput,
  CreateDeveloperAppResult,
  RotateSecretResult,
} from "./resources/developer-apps.js"

export type {
  ExchangeCodeInput,
  AccessTokenResponse,
  OAuthAppInfo,
} from "./resources/oauth.js"

export type {
  PublishedApp,
  PublishedAppDetail,
  ListAppsParams,
  ListAppsResult,
  AppRunResult,
  AppRun,
  ListAppRunsParams,
  DeleteAppRunResult,
} from "./resources/apps.js"
export type {
  RunNodeResult,
  NodeJobOutput,
  RunAndWaitOptions,
  RunManyResult,
} from "./resources/nodes.js"

export type {
  Character,
  CharacterDetail,
  CharacterUsage,
  ReferencePhoto,
  ReferencePhotoKind,
  UpsertCharacterInput,
  UpsertCharacterResult,
  ListCharactersParams,
  DuplicateCharacterInput,
  GenerateCharacterInput,
  GenerateCharacterResult,
  GenerateAssetInput,
  GenerateMotionInput,
  ApprovePortraitResult,
  RecaptionResult,
  CharacterAspectRatio,
} from "./resources/characters.js"
export {
  CHARACTER_ASPECT_OPTIONS,
  CHARACTER_ASPECT_DEFAULTS,
} from "./resources/characters.js"

export type {
  Location,
  LocationDetail,
  LocationReferencePhoto,
  LocationReferencePhotoKind,
  CreateLocationInput,
  UpdateLocationInput,
  UpdateLocationResult,
  ListLocationsParams,
  GenerateLocationInput,
  GenerateLocationResult,
  GenerateLocationAssetInput,
  ApproveMainImageResult,
  RecaptionLocationResult,
  LocationAssetType,
  LocationAttachColumn,
} from "./resources/locations.js"
export {
  LOCATION_ASSET_TYPES,
  LOCATION_ATTACH_COLUMNS,
} from "./resources/locations.js"

export type {
  Object,
  ObjectDetail,
  ObjectReferencePhoto,
  ObjectReferencePhotoKind,
  ObjectCategory,
  CreateObjectInput,
  UpdateObjectInput,
  UpdateObjectResult,
  UpsertObjectInput,
  UpsertObjectResult,
  ListObjectsParams,
  GenerateObjectInput,
  GenerateObjectResult,
  GenerateObjectAssetInput,
  GenerateObjectAssetResult,
  GenerateObjectMotionInput,
  GenerateObjectMotionResult,
  ApproveObjectMainImageResult,
  RecaptionObjectResult,
  ObjectAssetType,
  ObjectAttachColumn,
  ObjectAspectRatio,
} from "./resources/objects.js"
export {
  OBJECT_ASSET_TYPES,
  OBJECT_ATTACH_COLUMNS,
  OBJECT_ASPECT_OPTIONS,
  OBJECT_ASPECT_DEFAULTS,
} from "./resources/objects.js"

export type {
  BranchPipelineInput,
  BranchPipelineResult,
  ChatTurn,
  ChatStageResult,
  ApplyChatProposalResult,
} from "./resources/pipelines.js"
export type { PipelineStageName } from "./resources/pipelines.js"

export type {
  ReduceStrategyId,
  ReduceMeta,
  ReduceInput,
  ReduceResult,
} from "./resources/reduce.js"

export type {
  AnalyzeInput,
  AnalyzeResult,
  GenerateInput,
  EnhanceInput,
  PromptResult,
} from "./resources/prompt-helper.js"
export type {
  WizardQuestion,
  WizardOption,
  WizardSelection,
  RecommendedModel,
  WizardNodeContext,
} from "@nodaro/shared"

export type {
  Voice,
  SharedVoice,
  VoiceClone,
  VoiceLibraryParams,
  VoiceLibraryResponse,
} from "./resources/voices.js"

export type {
  UserBalance,
  ModelCostsResult,
} from "./resources/credits.js"

export type { UploadResult } from "./resources/uploads.js"

export type {
  NodePreset,
  NodePresetGroup,
  FactoryPresetsResult,
} from "./resources/node-presets.js"

export type {
  CommunityCard,
  CommunityEntityType,
  CommunitySort,
  CommunityReportReason,
  BrowseCommunityParams,
  BrowseCommunityResult,
  CloneListingResult,
  FavoriteListingResult,
  ReportListingResult,
  PublishListingParams,
  PublishListingResult,
  SharedListing,
} from "./resources/community.js"
