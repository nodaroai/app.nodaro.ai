/**
 * `@nodaro/sdk/nodes` — the `nodes` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export type {
  // The editor's structured-reference shape, used by GenerateImageParams /
  // GenerateVideoParams below so callers can build `connectedReferences`.
  ConnectedReference,
  // A reference the caller can NAME and DESCRIBE but has no media for — used by
  // `StructuredReferenceParams.describedReferences` on both media lanes.
  DescribedReference,
} from "@nodaro/shared/types"

export type {
  // A character (identity) reference for `characterReferences` on the video lanes.
  VideoCharacterReference,
  VideoCharacterVoice
} from "@nodaro/shared/video"

export type {
  GeminiOmniVoicePresetId
} from "@nodaro/shared/models"

export type {
  // Node-data prompt affix fields (promptPrefix / promptSuffix) — set them via
  // workflow JSON or `apps.run(..., { inputOverrides })`.
  PromptAffixFields,
} from "@nodaro/shared/nodes"

export type {
  // Social Search (`nodes.run("social-search", …)`): the request and the post shape.
  SocialSearchParams,
  SocialPost,
  SocialPostAuthor,
  SocialPostMetrics,
  SocialPostMedia,
  SocialPlatform,
  SocialSearchMode,
  SocialSearchPeriod,
  SocialSearchSort,
  SocialSearchCount,
  SocialSearchVideoKind,
} from "@nodaro/shared/social"

export type {
  // Video Depth (`nodes.run("video-depth", …)`): the vocabularies `VideoDepthParams` takes.
  VideoDepthProvider,
  VideoDepthModelSize,
  VideoDepthColormap,
  VideoDepthResolution
} from "@nodaro/shared/media"

export { NodesResource } from "../resources/nodes.js"

export type {
  NodeDescriptor,
  NodeCreditRate,
  NodeCategory,
  OutputType,
  NodeInputField,
  NodeInputSchema,
} from "../resources/nodes.js"

export type {
  RunNodeResult,
  RunNodeAdjustment,
  RunNodeWarning,
  NodeJobOutput,
  JobOutputImage,
  SocialSearchJobOutput,
  RunAndWaitOptions,
  RunManyResult,
  StructuredReferenceParams,
  GenerationSessionParams,
  GenerateImageParams,
  Subject,
  GenerateImageBatchGroup,
  GenerateImageBatchResult,
  GenerateImageBatchOutput,
  BatchJobOutcome,
  TextToSpeechParams,
  GenerateVideoParams,
  TextToVideoParams,
  VideoUpscaleParams,
  VideoDepthParams,
} from "../resources/nodes.js"

export { PROMPT_PREFIX_KEY, PROMPT_SUFFIX_KEY } from "@nodaro/shared/nodes"

export type { ReferenceCaptionParams, AssembleNarratedVideoParams, RunNodeOptions } from "../resources/nodes.js"

export type {
  // The image routes beside generate-image: `nodes.run("image-to-image" |
  // "edit-image" | "split-image" | "generate-mask", …)`.
  ImageJobStarted,
  ImageToImageParams,
  EditImageCommonParams,
  EditImageFromUrlParams,
  EditImageFromTaskParams,
  EditImageParams,
  SplitImageParams,
  SplitImageTile,
  SplitImageResult,
  GenerateMaskParams,
  GenerateMaskJobOutput,
} from "../resources/nodes-image-params.js"

export type {
  // The vocabularies those params take.
  ModifyImageProvider,
  ImageEditProvider,
  TaskChainedEditProvider,
  ImageAspectRatio,
  ImageResolution,
  ImageQuality,
  ImageRenderingSpeed,
  ImageEditTargetResolution,
} from "@nodaro/shared/models"

export type { TopazUpscaleFactor } from "@nodaro/shared/credits"

export type { ImageToImageAttachColumn } from "@nodaro/shared/entities"
