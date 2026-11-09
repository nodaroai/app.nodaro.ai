/**
 * `@nodaro/sdk/voices` — the `voices` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { VoicesResource } from "../resources/voices.js"

export type {
  Voice,
  SharedVoice,
  VoiceClone,
  VoiceFavorite,
  VoiceFavoriteInput,
  VoiceFavoriteType,
  VoiceLibraryDescriptive,
  VoiceLibraryFacetCount,
  VoiceLibraryFacets,
  VoiceLibraryFacetsParams,
  VoiceLibraryParams,
  VoiceLibraryResponse,
  VoiceLibraryUseCase,
  VoiceChangerProInput,
  VoiceChangerProVoice,
  VcpAnalyzeInput,
  VcpAnalysis,
  VcpAnalysisSpeaker,
  VcpExportInput,
  VcpExportTrack,
  VoiceDesignInput,
  VoiceRemixInput,
  DubbingInput,
  AudioFxPreset,
} from "../resources/voices.js"
