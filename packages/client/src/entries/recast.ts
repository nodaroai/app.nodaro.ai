/**
 * `@nodaro/sdk/recast` — the `recast` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export {
  RecastResource,
  type RecastScriptValidation,
  type RecastScriptValidationError,
  type RecastScriptImportResult,
  type CreateRecastInput,
  type RecastSegmentPack,
  type EstimateRecastInput,
  type RecastEstimate,
  type RecastRunSnapshot,
  type RecastAudioLayerName,
  type RecastAudioMixControl,
  type RecastAudioMix,
  type RecastAudioManifestV1,
  type RecastAudioSectionReplacement,
  type RecastRescoreReplacement,
  type RecastRescoreOperation,
  type EstimateRecastRescoreInput,
  type RecastRescoreRequestV2,
  type RecastRescoreQuote,
  type RecastRescoreResponse,
  type ResolveRecastGateInput,
} from "../resources/recast.js"

// The values `segmentSec` takes, for a caller that offers them as choices.
export { RECAST_SEGMENT_PACKS } from "@nodaro/shared/apps"
