import type { Node, Edge } from "@xyflow/react"
import type {
  ImageI2IProvider, ImageGenProvider, ImageEditProvider,
  ModifyImageProvider, UpscaleImageProvider,
  ImageToVideoProvider, TextToVideoProvider, VideoToVideoProvider,
  VideoUpscaleProvider, ExtendVideoProvider, FaceSwapProvider, TtsProvider,
  TextToAudioProvider, MusicProvider, TranscribeProvider,
  LipSyncProvider, ScriptProvider, AiWriterProvider, QaCheckProvider,
  SunoModel, VoiceDesignModel, CaptionStyle,
} from "@nodaro/shared"
import type { ScraperActorId, CharacterAspectRatio } from "@nodaro/shared"
import type { PipelineFormat, PipelineMode } from "@nodaro/shared"
import { MODIFY_IMAGE_PROVIDERS, UPSCALE_IMAGE_PROVIDERS } from "@nodaro/shared"
import {
  MUSIC_GENRE_DEFAULT_DATA,
  MUSIC_MOOD_DEFAULT_DATA,
  INSTRUMENTATION_DEFAULT_DATA,
  VOICE_CHARACTER_DEFAULT_DATA,
  VOICE_DELIVERY_DEFAULT_DATA,
} from "@nodaro/shared"
import type { ExposableField, ExposableOutput } from "@nodaro/shared"
import type { ComponentMetadata } from "@nodaro/shared"
import type { IdentityMeta } from "@nodaro/shared"
import type { ReferencePhotoKind } from "@/lib/reference-photo-routing"
import { IMAGE_STYLE_PRESETS } from "@/components/editor/config-panels/model-options"

export type NodeCategory = "input" | "parameter" | "ai" | "processing" | "output" | "scene" | "character" | "face" | "object" | "location" | "utility"

export interface FieldMapping {
  readonly sourceNodeId: string
}

export type FieldMappings = Readonly<Record<string, FieldMapping>>

export interface GeneratedResult {
  readonly url: string
  readonly thumbnailUrl?: string
  readonly timestamp: string
  readonly jobId: string
  readonly freecutProjectUrl?: string
  readonly filerobotDesignStateUrl?: string
  // Natural media metadata. Populated either proactively at result-creation
  // time (probeMediaMetadata on uploads/edits) or lazily from the rendered
  // <img>/<video>/<audio>'s onLoad. Lets the node compute aspectRatio
  // synchronously on result switch instead of via a side-channel preload
  // that races the src change.
  readonly width?: number
  readonly height?: number
  readonly duration?: number  // seconds, for video/audio
}

export interface ManualReferenceImage {
  readonly id: string   // crypto.randomUUID()
  readonly url: string  // R2 URL
}

/**
 * Extra reference image attached to an image / video generator. Unlike
 * `ManualReferenceImage`, an extra ref carries a description and an optional
 * per-ref usage mode override, and may be sourced from a wired character's
 * asset variants. At build time:
 *   - the URL is appended to the `connectedReferences` list as the first
 *     non-character entries (or as additional `wired-character` entries when
 *     `characterSlug` is set) so the runtime worker sees the reference image,
 *   - the description becomes part of the assembled prompt directive ("Image
 *     B is the same subject as Image A, <description>." for character-sourced
 *     extras of a character already mentioned/canonical-attached; "Image B
 *     (reference): <description>." for everything else).
 *
 * See `prompt-builder.ts::resolveCharacterMentions` and the orchestrator's
 * `payload-builder.ts` for the build-time logic.
 */
export interface ExtraRef {
  /** R2 URL of the reference image (uploaded or from a character asset). */
  readonly url: string
  /** Free-form description appended to the prompt's identity directive. */
  readonly description: string
  /** Slug of the source character (e.g. "kira") when picked from a wired
   *  character's variants. Used for the "same subject as Image A" pairing. */
  readonly characterSlug?: string
  /** Variant slug (e.g. "smile") when picked from a specific character
   *  variant. undefined when picked from the canonical asset. */
  readonly variantSlug?: string
  /** Display name for the variant ("smile", "canonical", "side profile") —
   *  shown in the config panel row label and unused at build time. */
  readonly variantDisplayName?: string
  /** Optional per-ref usage mode override (falls back to the source
   *  character node's `defaultUsageMode`, then to the global "identical"). */
  readonly usageMode?: import("@nodaro/shared").UsageMode
}

// --- Input Node Data ---

export type TextPromptData = {
  [key: string]: unknown
  label: string
  text: string
  variables: Record<string, string>
  color?: string
  textStyle?: string
  bold?: boolean
  italic?: boolean
  outputTarget?: "text" | "voice" | "lyrics"
  alignment?: string
  width?: number
  height?: number
}

export type TextFontSize = "small" | "medium" | "large"

export type ListNodeData = {
  [key: string]: unknown
  label: string
  items?: string // Legacy (migrated to columns + rows at load)
  columns?: LoopColumn[]
  rows?: string[][]
  fieldMappings: Record<string, string>
  maxItems?: number
  showData?: boolean
  thumbnailSize?: "sm" | "md" | "lg"
  galleryCols?: number
  viewMode?: "list" | "gallery" | "packed"
  textMaxLines?: number
  textFontSize?: TextFontSize
}

export interface LoopColumn {
  readonly id: string
  readonly name: string
  readonly handleId: string
  readonly type: "text" | "image-url" | "video-url" | "audio-url" | "json"
  readonly width?: number
  readonly splitDelimiter?: string
  readonly connectedSourceId?: string
  readonly connectedSourceHandle?: string
}

export const LOOP_COLUMN_TYPE_META: Record<LoopColumn["type"], { label: string; shortLabel: string; color: string }> = {
  text: { label: "Text", shortLabel: "TXT", color: "#38BDF8" },
  "image-url": { label: "Image", shortLabel: "IMG", color: "#F472B6" },
  "video-url": { label: "Video", shortLabel: "VID", color: "#818CF8" },
  "audio-url": { label: "Audio", shortLabel: "AUD", color: "#22c55e" },
  json: { label: "JSON", shortLabel: "JSON", color: "#F59E0B" },
}

/**
 * Resolve a loop/list node's effective view mode.
 *
 * Returns the explicit `viewMode` when set; otherwise falls back to "gallery"
 * when every column is image-url, else "list".
 */
export function resolveViewMode(data: {
  viewMode?: "list" | "gallery" | "packed"
  columns?: ReadonlyArray<LoopColumn>
}): "list" | "gallery" | "packed" {
  if (data.viewMode) return data.viewMode
  const cols = data.columns ?? []
  return cols.length > 0 && cols.every(c => (c.type ?? "text") === "image-url")
    ? "gallery"
    : "list"
}

/** Default maximum text lines per text cell in loop/list nodes (configurable via textMaxLines). */
export const TEXT_CELL_DEFAULT_MAX_LINES = 3
/** Line height in px for text-xs cells (Tailwind text-xs → line-height: 1rem = 16px). */
export const TEXT_CELL_LINE_HEIGHT_PX = 16
/** Total vertical padding (top+bottom) of the inner cell in px (py-2 = 0.5rem × 2 = 16px). */
export const TEXT_CELL_VERTICAL_PADDING_PX = 16
/** Below this threshold, hover controllers (expand/copy/drag) are hidden to avoid overlapping short cells. */
export const TEXT_CELL_CONTROLS_MIN_LINES = 3

/** Line height in px matching each TEXT_FONT_SIZE_CLASS value:
 *  - small:  text-[10px] leading-tight (1.25) → 12.5 → 13
 *  - medium: text-xs → line-height 1rem = 16
 *  - large:  text-sm → line-height 1.25rem = 20
 */
export const TEXT_FONT_LINE_HEIGHT_PX: Record<TextFontSize, number> = {
  small: 13,
  medium: 16,
  large: 20,
}

/** Compute the pixel maxHeight for a text cell inner div with N visible lines at a given font size, including padding. */
export function textCellMaxHeightPx(lines: number, fontSize: TextFontSize = TEXT_FONT_SIZE_DEFAULT): number {
  return lines * TEXT_FONT_LINE_HEIGHT_PX[fontSize] + TEXT_CELL_VERTICAL_PADDING_PX
}

/** Stable handle ID for the loop node's "quick-add column" target. */
export const LOOP_COL_ADD_HANDLE = "col_add"

/** Derive the target (input) handle ID for a loop column from its base handleId. */
export function loopColInputHandle(handleId: string): string {
  return `${handleId}_in`
}

/** Extract the base handleId from a loop column's target handle ID. */
export function loopColBaseHandle(inputHandle: string): string {
  return inputHandle.replace(/_in$/, "")
}

export interface PresentationDisplay {
  columns?: 1 | 2 | 3 | 4
  elementSize?: "sm" | "md" | "lg"
  viewMode?: string
  maxWidth?: number // 10-100 (percentage of container width)
  align?: "left" | "center" | "right"
}

export type InputMode = "prompt" | "multiline" | "oneline" | "inline"

export type LoopNodeData = {
  [key: string]: unknown
  label: string
  columns: LoopColumn[]
  rows: string[][]
  fieldMappings: Record<string, string>
  maxItems?: number
  minRows?: number
  defaultRows?: number
  thumbnailSize?: "sm" | "md" | "lg"
  galleryCols?: number
  viewMode?: "list" | "gallery" | "packed"
  textMaxLines?: number
  textFontSize?: TextFontSize
}

/** Tailwind class for each text font size setting. */
export const TEXT_FONT_SIZE_CLASS: Record<TextFontSize, string> = {
  small: "text-[10px] leading-tight",
  medium: "text-xs",
  large: "text-sm",
}

export const TEXT_FONT_SIZE_DEFAULT: TextFontSize = "medium"

export type UploadImageData = {
  [key: string]: unknown
  label: string
  assetId: string
  url: string
  r2Url: string
  thumbnailUrl: string
  filename: string
  fileSize: number
  mimeType: string
  externalUrl: string
  isUploading: boolean
  uploadError: string
  metadata: {
    width?: number
    height?: number
    format?: string
  }
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type UploadVideoData = {
  [key: string]: unknown
  label: string
  assetId: string
  url: string
  r2Url: string
  thumbnailUrl: string
  filename: string
  fileSize: number
  mimeType: string
  externalUrl: string
  isUploading: boolean
  uploadError: string
  metadata: {
    width?: number
    height?: number
    durationSeconds?: number
    codec?: string
  }
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
  videoPlayState?: "loop" | "paused" | "stopped"
  pausedAtTime?: number
}

export type UploadAudioData = {
  [key: string]: unknown
  label: string
  assetId: string
  url: string
  r2Url: string
  filename: string
  fileSize: number
  mimeType: string
  externalUrl: string
  isUploading: boolean
  uploadError: string
  metadata: {
    durationSeconds?: number
    codec?: string
    sampleRate?: number
  }
}

export type RSSFeedData = {
  [key: string]: unknown
  label: string
  feedUrl: string
  itemIndex: number
  extractFields: string[]
}

export type YouTubeVideoData = {
  [key: string]: unknown
  label: string
  youtubeUrl: string
  videoId: string
  title: string
  thumbnailUrl: string
  downloadedVideoUrl?: string
  downloadedThumbnailUrl?: string
  downloadStatus?: "idle" | "downloading" | "completed" | "failed"
  downloadError?: string
  downloadPercent?: number
  downloadPhase?: "downloading" | "processing" | "uploading"
  downloadedAudioUrl?: string
  audioDownloadStatus?: "idle" | "downloading" | "completed" | "failed"
  audioDownloadError?: string
}

export type ReferenceAudioData = {
  [key: string]: unknown
  label: string
  sourceType: "youtube" | "upload" | "url"
  youtubeUrl: string
  uploadedFileUrl: string
  directUrl: string
  videoTitle: string
  videoThumbnail: string
  videoDuration: string
  extractedAudioUrl: string
  extractionStatus: "idle" | "extracting" | "ready" | "failed"
}

// --- Parameter Node Data ---

export type ToneData = {
  [key: string]: unknown
  label: string
  tone: string
}

export type StyleGuideData = {
  [key: string]: unknown
  label: string
  text: string
}

export type ProviderData = {
  [key: string]: unknown
  label: string
  category: "image" | "video" | "voice" | "script"
  provider: string
  model: string
}

export type SceneCountData = {
  [key: string]: unknown
  label: string
  count: number
}

export type DurationData = {
  [key: string]: unknown
  label: string
  seconds: number
}

export type AspectRatioData = {
  [key: string]: unknown
  label: string
  ratio: "1:1" | "16:9" | "9:16" | "4:3" | "4:5"
}

export type MotionData = {
  [key: string]: unknown
  label: string
  motion: "subtle" | "moderate" | "dynamic"
}

export type CameraMotionData = {
  [key: string]: unknown
  label: string
  /** Motion id from CAMERA_MOTIONS catalog (packages/shared/src/camera-motions.ts). */
  cameraMotion: string
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

export type FramingData = {
  [key: string]: unknown
  label: string
  /** Per-category framing selections (multi-category model). One id per
   * enabled category. See `FRAMING_FIELD_BY_CATEGORY` in `packages/shared/src/framing.ts`. */
  shotSize?: string
  angle?: string
  coverage?: string
  /** Composition — single id or up to 2 ids for layered compositions
   *  (e.g. ["rule-of-thirds","leading-lines"], ["centered","negative-space"]). */
  composition?: string | ReadonlyArray<string>
  vantage?: string
  /** Grid columns when displaying multiple enabled categories in the node
   * card. Default (render-time) = 1 (vertical stack). Range 1-5. */
  maxItemsPerRow?: number
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Lens parameter node data. */
export interface LensData {
  [key: string]: unknown
  label: string
  /** Lens id from LENSES catalog (packages/shared/src/lens.ts). */
  lens: string
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Camera / Film Stock parameter node data. */
export interface CameraFormatData {
  [key: string]: unknown
  label: string
  /** Camera-format id from CAMERA_FORMATS catalog (packages/shared/src/camera-format.ts). */
  cameraFormat: string
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Lighting parameter node data. */
export interface LightingData {
  [key: string]: unknown
  label: string
  /** Per-category lighting selections (multi-category model). One id per
   * enabled category. See `LIGHTING_FIELD_BY_CATEGORY` in `packages/shared/src/lighting.ts`. */
  timeOfDay?: string
  /** Lighting style — single id or up to 2 ids for layered setups
   *  (e.g. ["key", "rim"], ["soft", "hard"]). */
  lightingStyle?: string | ReadonlyArray<string>
  lightingDirection?: string
  /** Lighting ratio id (relative key-to-shadow brightness, e.g. "ratio-1-2"). */
  lightingRatio?: string
  /** Color temperature id (Kelvin warmth/coolness, e.g. "temp-5600k"). */
  colorTemperature?: string
  /** Grid columns when displaying multiple enabled categories in the node
   * card. Default (render-time) = 1 (vertical stack). Range 1-3. */
  maxItemsPerRow?: number
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Color/Look parameter node data. */
export interface ColorLookData {
  [key: string]: unknown
  label: string
  /** Color/Look id from COLOR_LOOKS catalog (packages/shared/src/color-look.ts). */
  colorLook: string
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Atmosphere parameter node data. */
export interface AtmosphereData {
  [key: string]: unknown
  label: string
  /** Atmosphere id from ATMOSPHERES catalog. Single id or up to 2 for layered
   *  particle effects (e.g. ["fog","god-rays"], ["dust","sun-shafts"]).
   *  Undefined = user cleared all picks; the node emits no atmosphere hint. */
  atmosphere: string | ReadonlyArray<string> | undefined
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Action FX parameter node data. Multi-pick 1–2 ids — string for
 *  single pick, ReadonlyArray<string> for two picks (mirrors AtmosphereData). */
export interface ActionFxData {
  [key: string]: unknown
  label: string
  /** Action FX id from ACTION_FX catalog. Single id or up to 2 for layered
   *  effects (e.g. ["explosion","sparks"], ["splash","ripples"]).
   *  Undefined = user cleared all picks; the node emits no action-fx hint. */
  actionFx: string | ReadonlyArray<string> | undefined
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Style parameter node data. */
export interface StyleData {
  [key: string]: unknown
  label: string
  /** Style id from STYLES catalog (packages/shared/src/style.ts). The inline
   * Style dropdown in image config panels derives its options from the same
   * catalog (via IMAGE_STYLE_PRESETS in model-options.ts), so both surfaces
   * resolve to the same promptHint at execution time. */
  style: string
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Setting parameter node data. Place/environment hint appended
 * to downstream gen prompts (coffee shop, forest clearing, cyberpunk alley).
 * Distinct from the Location entity node — Setting is pure prompt text,
 * Location entity generates a reference image. */
export interface SettingData {
  [key: string]: unknown
  label: string
  /** Setting id from SETTINGS catalog (packages/shared/src/setting.ts). */
  setting: string
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Loop Subject parameter node data. Loop-friendly scene prompt
 * for image generation in a perfect-loop pipeline (image-gen → VEO 3.1
 * with same start/end frame + seal phrase). Output is a curated subject
 * prompt — wires into a Generate Image node's prompt input via the
 * existing FieldMappings system. */
export interface LoopSubjectData {
  [key: string]: unknown
  label: string
  /** Subject id from LOOP_SUBJECTS catalog (packages/shared/src/loop-subject.ts). */
  loopSubject: string
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Music Genre parameter node data. Genre + optional subgenre + era
 *  picks from `packages/shared/src/music-genre.ts`. Emits a music-prompt hint
 *  (e.g. "synthwave with neo-disco influence, 80s") for Suno / MiniMax /
 *  Text-to-Audio generators. `preText`/`postText` are user free-text fragments
 *  composed before / after the structured hint. `genre` is `string` for a
 *  single pick or `ReadonlyArray<string>` for a multi-pick (up to 3 genres).
 *  Subgenre is meaningful only for single-pick mode and is ignored when
 *  `genre` is an array. */
export type MusicGenreData = {
  [key: string]: unknown
  label: string
  preText?: string
  postText?: string
  genre?: string | ReadonlyArray<string>
  subgenre?: string
  era?: string
}

/** Standalone Music Mood parameter node data. Energy + emotion + vibe picks
 *  from `packages/shared/src/music-mood.ts`. Emits a music-prompt hint
 *  (e.g. "high-energy, euphoric, anthemic") for music generators.
 *  `preText`/`postText` are user free-text fragments composed before / after
 *  the structured hint. */
export type MusicMoodData = {
  [key: string]: unknown
  label: string
  preText?: string
  postText?: string
  energy?: string
  emotion?: string | ReadonlyArray<string>
  vibe?: string | ReadonlyArray<string>
}

/** Standalone Instrumentation parameter node data. Multi-pick instruments +
 *  production style + vocal-presence + singing-style picks from
 *  `packages/shared/src/instrumentation.ts`. Vocal-presence "instrumental"
 *  also flips the MiniMax `instrumental` flag at runtime. Vocal-presence
 *  and singing-style are multi-pick (up to 3 each). `preText`/`postText`
 *  are user free-text fragments composed before / after the structured
 *  hint. */
export type InstrumentationData = {
  [key: string]: unknown
  label: string
  preText?: string
  postText?: string
  instruments?: string[]
  production?: string
  vocalPresence?: string | ReadonlyArray<string>
  singingStyle?: string | ReadonlyArray<string>
}

/** Standalone Voice Character parameter node data. Age + gender + language +
 *  accent + timbre picks from `packages/shared/src/voice-character.ts`. Emits a
 *  voice-description hint that drives ElevenLabs `voice_description` and
 *  TTS provider voice selection. `language` is multi-pick (up to 3) for
 *  codeswitching / multilingual voice work. `preText`/`postText` are user
 *  free-text fragments composed before / after the structured hint. */
export type VoiceCharacterData = {
  [key: string]: unknown
  label: string
  preText?: string
  postText?: string
  age?: string
  gender?: string
  language?: string | ReadonlyArray<string>
  accent?: string
  timbre?: string
}

/** Standalone Voice Delivery parameter node data. Pace + emotion + archetype
 *  picks from `packages/shared/src/voice-delivery.ts`. Pairs with Voice
 *  Character to shape the speaking style hint passed to TTS / dubbing.
 *  `preText`/`postText` are user free-text fragments composed before / after
 *  the structured hint. */
export type VoiceDeliveryData = {
  [key: string]: unknown
  label: string
  preText?: string
  postText?: string
  pace?: string
  emotion?: string
  archetype?: string
}

/** Standalone Person parameter node data. Subject-appearance compound hint
 * appended to downstream gen prompts. Multi-dimension: each orthogonal field
 * is optional. Non-empty fields are joined as comma-separated fragments
 * ("a beautiful woman, in their 30s, East Asian, Parisienne aesthetic, slim
 * build, long wavy hair, brown hair, fair skin, green eyes"). Applies to
 * both image and video consumers. See `packages/shared/src/person.ts`. */
export interface PersonData {
  [key: string]: unknown
  label: string
  /** Primary subject descriptor (Man, Beautiful Woman, Rugged Man, etc.). */
  type?: string
  /** Age range (20s, 30s, teen, elderly). Set to `"age-custom"` to use the
   *  literal value in `customAge` for fully specific control. */
  age?: string
  /** Specific age in years. Only consulted when `age === "age-custom"`. */
  customAge?: number
  /** Ethnicity / cultural descriptor. Single id or up to 2 ids for mixed
   *  heritage (e.g. ["slavic","mediterranean"]). */
  ethnicity?: string | ReadonlyArray<string>
  /** Regional / cultural aesthetic vibe — California Beach, Parisienne,
   *  Tokyo Harajuku, Lagos Afro-Glam, etc. Composes with ethnicity, skin
   *  tone, hair, and styling (vibe-only promptHints, no hard-coded
   *  visuals). Single id or up to 2 ids for hybrid looks (e.g.
   *  ["nyc-fashion","parisienne"]). */
  regionalAesthetic?: string | ReadonlyArray<string>
  /** Body silhouette + height combined (slim, athletic, tall-lean). */
  build?: string
  /** Body shape ratio (long-legged, hourglass, pear). Independent from Build. */
  bodyProportions?: string
  /** Face silhouette (oval, round, square, heart, diamond, oblong, triangular). */
  faceShape?: string
  /** Jaw shape (strong, soft, pointed, wide, double-chin). */
  jawline?: string
  /** Eye shape (almond, hooded, monolid, deep-set, downturned, upturned…). */
  eyeShape?: string
  /** Nose shape (straight, aquiline, snub, broad, narrow, hooked…). */
  nose?: string
  /** Lip shape (thin, medium, full, wide, cupid's bow, small). */
  lips?: string
  /** Lip state — what the lips are doing (chapped, glossy, parted, biting,
   *  pursed, bold-red). Distinct from `lips` (anatomical shape). Single id
   *  or up to 2 (e.g. glossy + parted). */
  lipState?: string | ReadonlyArray<string>
  /** Hair color (brown, blonde, gray, dyed). Single id or up to 2 ids for
   *  two-tone / ombre / highlighted hair. */
  hairColor?: string | ReadonlyArray<string>
  /** Natural hair texture + length (short straight, long curly, afro…). The
   *  styled cut (bob, wolf cut, braids…) lives in Styling.hairCut. */
  hairBase?: string
  /** Eyebrow shape / style (natural, thick, pencil, arched, microbladed…). */
  eyebrows?: string
  /** Skin tone. */
  skinTone?: string
  /** Skin texture / quality (smooth, wrinkled, goosebumps, dewy, glistening,
   *  weathered, porcelain, freckled, sun-kissed, …). Single id or up to 2
   *  combined (e.g. porcelain + freckled). */
  skinTexture?: string | ReadonlyArray<string>
  /** Eye color. Single id or up to 2 ids for heterochromia. */
  eyeColor?: string | ReadonlyArray<string>
  /** Eye state — what the eyes are doing (closed, half-lidded, wide-eyed,
   *  staring-at-camera, gazing-away/up/down, glassy). Distinct from
   *  `eyeShape` (anatomy) and `eyeColor`. Single id or up to 2 (e.g.
   *  half-lidded + glassy). */
  eyeState?: string | ReadonlyArray<string>
  /** Facial hair style (clean-shaven, stubble, full-beard). */
  facialHair?: string
  /** Distinctive feature (glasses, freckles, tattoos, scar, dimples, piercing).
   *  Single id or up to 3 ids for combined features. */
  distinctiveFeature?: string | ReadonlyArray<string>
  /** Free-text prepended before the dimension compound. */
  preText?: string
  /** Free-text appended after the dimension compound. */
  postText?: string
  /** Grid columns when displaying multiple enabled dimensions in the node
   * card. Default 2. Range 1-4. */
  maxItemsPerRow?: number
}

/** Standalone Styling parameter node data. Beauty + wardrobe + accessories
 * compound hint appended to downstream gen prompts. Multi-dimension covering:
 * makeup, hair (cut + treatment), eyewear, headwear, jewelry, nails, face
 * paint, outfit (complete-look override), top, bottom, outerwear, legwear,
 * footwear, fabric, and wardrobe-state. Applies to both image and video
 * consumers. See `packages/shared/src/styling.ts`. */
export interface StylingData {
  [key: string]: unknown
  label: string
  makeup?: string
  eyewear?: string
  headwear?: string
  /** Hair cut / style (bob, wolf cut, braids, ponytail, dreadlocks…).
   *  Pairs with Person.hairBase (natural texture + length). */
  hairCut?: string
  /** Hair treatment (babylights, balayage, ombré, highlights, rooted). */
  hairTreatment?: string
  /** Hair state / motion / condition (wet, messy, windswept, voluminous,
   *  sleek, frizzy, tousled, flowing…). Distinct from hairCut (shape) and
   *  hairTreatment (color processing). Single id or up to 2 (e.g.
   *  ["wet","windswept"], ["messy","voluminous"]). */
  hairState?: string | ReadonlyArray<string>
  /** Jewelry. Single id or up to 3 ids for stacked jewelry pieces
   *  (e.g. necklace + earrings + rings). */
  jewelry?: string | ReadonlyArray<string>
  nails?: string
  facePaint?: string
  /** Single-pick complete outfit archetype (school uniform, business suit,
   *  evening gown, scrubs, bikini, lingerie, kimono…). Intended as an override
   *  that semantically supersedes the per-piece top/bottom/outerwear pieces. */
  outfit?: string
  /** Upper-body garment (t-shirt, sweater, blouse, sports bra, bikini top…). */
  top?: string
  /** Lower-body garment (jeans, chinos, skirt, shorts, leggings…). */
  bottom?: string
  /** Layered-over outer garment (jacket, blazer, coat, cardigan…). */
  outerwear?: string
  /** Legwear worn between bottom and footwear (tights, fishnets, stockings, socks…). */
  legwear?: string
  /** Shoes (sneakers, heels, boots, loafers, sandals…). */
  footwear?: string
  /** Clothing fabric / material (silk, leather, denim, velvet…). Overlaps
   *  vocabulary with the Material node in the Object category — Fabric uses
   *  "wearing X" grammar, Material uses "made of X". */
  fabric?: string
  /** How the clothes are worn — oversized, fitted, cropped, sheer, wet,
   *  ripped, off-shoulder, tucked-in, layered, unbuttoned… Modifier that
   *  composes with any garment selection. Single id or up to 3 (e.g.
   *  ["oversized","wet","ripped"]). */
  wardrobeState?: string | ReadonlyArray<string>
  preText?: string
  postText?: string
  maxItemsPerRow?: number
}

/** Standalone Mood parameter node data. Emotional-state hint appended to
 * downstream gen prompts ("happy", "melancholy", "fierce"). Single-pick
 * with optional pre/post free-text fields. See `packages/shared/src/mood.ts`. */
export interface MoodData {
  [key: string]: unknown
  label: string
  /** Mood id from MOODS catalog. Single id or up to 2 ids for blended mood
   *  (e.g. ["smirking","aloof"] → "with a smirking and aloof expression").
   *  Undefined = user cleared all picks; the node emits no mood hint. */
  mood: string | ReadonlyArray<string> | undefined
  /** Free-text prepended before the mood hint. */
  preText?: string
  /** Free-text appended after the mood hint. */
  postText?: string
}

/** Standalone Photographer parameter node data. Picks ONE photographer or
 * artist whose visual signature drives the look. See
 * `packages/shared/src/photographer.ts`. */
export interface PhotographerData {
  [key: string]: unknown
  label: string
  /** Photographer id from PHOTOGRAPHERS catalog. Single id or up to 2 for
   *  blended visual signatures (e.g. ["tim-walker","helmut-newton"]).
   *  Undefined = user cleared all picks. */
  photographer: string | ReadonlyArray<string> | undefined
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Aesthetic / Microtrend parameter node data. Picks ONE
 * microtrend bundle (Y2K, dark academia, cottagecore, gorpcore, etc.). See
 * `packages/shared/src/aesthetic.ts`. */
export interface AestheticData {
  [key: string]: unknown
  label: string
  /** Aesthetic id from AESTHETICS catalog. Single id or up to 2 ids for an
   *  aesthetic blend (e.g. ["y2k","dadcore"]).
   *  Undefined = user cleared all picks. */
  aesthetic: string | ReadonlyArray<string> | undefined
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Era / Period parameter node data. Picks ONE historical era or
 * speculative period that bundles wardrobe + environment + photographic
 * treatment. See `packages/shared/src/era.ts`. */
export interface EraData {
  [key: string]: unknown
  label: string
  /** Era id from ERAS catalog. */
  era: string
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Pose parameter node data. Posture + action hint appended to
 * downstream gen prompts ("standing upright", "mid-run", "fighting stance").
 * Multi-dimensional: pose plus orthogonal sub-pickers (hand position / body
 * lean / head tilt) plus optional pre/post free-text fields. See
 * `packages/shared/src/pose.ts`. */
export interface PoseData {
  [key: string]: unknown
  label: string
  /** Pose id from POSES catalog. */
  pose: string
  /** Optional hand-position pose id (orthogonal sub-dimension). */
  handPosition?: string
  /** Optional body-lean pose id (orthogonal sub-dimension). */
  bodyLean?: string
  /** Optional head-tilt pose id (orthogonal sub-dimension). */
  headTilt?: string
  /** Optional activity pose id — what the subject is DOING in the world
   *  (smoking, eating, texting, driving…). Orthogonal to the other sub-pickers. */
  activity?: string
  /** Free-text prepended before the pose hint. */
  preText?: string
  /** Free-text appended after the pose hint. */
  postText?: string
}

/** Standalone Material parameter node data. Universal "what something is
 * made of" hint using `"made of X"` grammar — works on subjects, objects, or
 * surfaces. See `packages/shared/src/materials.ts`. Part of the Object
 * category along with Animal / Vehicle / Weapon. */
export interface MaterialData {
  [key: string]: unknown
  label: string
  /** Material id from MATERIALS catalog. Single id or up to 2 for composites
   *  (e.g. ["leather","brass"] → "made of leather and brass").
   *  Undefined = user cleared all picks. */
  material: string | ReadonlyArray<string> | undefined
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Animal parameter node data. Reuses the catalog from the
 * Object entity's Animal sub-category. Emits a descriptive hint for
 * downstream gen prompts ("featuring a golden retriever…"). See
 * `packages/shared/src/animals.ts`. */
export interface AnimalData {
  [key: string]: unknown
  label: string
  /** Animal id from ANIMALS catalog. */
  animal: string
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Vehicle parameter node data. Reuses the catalog from the
 * Object entity's Vehicle sub-category. Emits a descriptive hint for
 * downstream gen prompts ("featuring a muscle car…"). See
 * `packages/shared/src/vehicles.ts`. */
export interface VehicleData {
  [key: string]: unknown
  label: string
  /** Vehicle id from VEHICLES catalog. */
  vehicle: string
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Weapon parameter node data. Reuses the catalog from the
 * Object entity's Weapon sub-category. Emits a descriptive hint for
 * downstream gen prompts ("with a katana…"). See
 * `packages/shared/src/weapons.ts`. */
export interface WeaponData {
  [key: string]: unknown
  label: string
  /** Weapon id from WEAPONS catalog. */
  weapon: string
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Photo Genre parameter node data. Single-pick meta-preset
 * bundling lighting/framing/wardrobe/grade conventions of a recognizable
 * photographic genre (paparazzi, vogue editorial, gym mirror selfie,
 * mugshot, etc.). See `packages/shared/src/photo-genre.ts`. */
export interface PhotoGenreData {
  [key: string]: unknown
  label: string
  /** Photo genre id from PHOTO_GENRES catalog. */
  photoGenre: string
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Backdrop parameter node data. Single-pick describing the
 * studio backdrop / wall / surface immediately behind the subject —
 * distinct from Setting, which describes a full environment. See
 * `packages/shared/src/backdrop.ts`. */
export interface BackdropData {
  [key: string]: unknown
  label: string
  /** Backdrop id from BACKDROPS catalog. */
  backdrop: string
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Held Prop parameter node data. Single-pick describing the
 * object the subject is actively holding or interacting with (phone,
 * cigarette, coffee cup, microphone, bouquet, instrument). Distinct from
 * the Object node, which describes a separate scene object. See
 * `packages/shared/src/held-prop.ts`. */
export interface HeldPropData {
  [key: string]: unknown
  label: string
  /** Held prop id from HELD_PROPS catalog. Single id or up to 2 for combos
   *  (e.g. ["book","coffee-cup"], ["cigarette","wine-glass"]).
   *  Undefined = user cleared all picks. */
  heldProp: string | ReadonlyArray<string> | undefined
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Exposure Settings parameter node data. Multi-category: aperture
 * (depth of field), shutter speed (motion treatment), and ISO (grain). Each
 * field optional. See `packages/shared/src/exposure-settings.ts`. */
export interface ExposureSettingsData {
  [key: string]: unknown
  label: string
  /** Aperture id (f/1.2 → f/16). */
  aperture?: string
  /** Shutter-speed id. */
  shutterSpeed?: string
  /** ISO id. */
  isoValue?: string
  /** Grid columns when displaying multiple enabled categories on the node card. */
  maxItemsPerRow?: number
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Render Quality parameter node data. Single-pick technical
 * stamp — engine name, render-quality keyword, resolution stamp, or style
 * stamp. See `packages/shared/src/render-quality.ts`. */
export interface RenderQualityData {
  [key: string]: unknown
  label: string
  /** Render-quality id from RENDER_QUALITIES catalog. */
  renderQuality: string
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Composition Effects parameter node data. Single-pick subject /
 * frame compositional trick (bursting through frame, smoke sculpture,
 * exploding particles, …). See `packages/shared/src/composition-effects.ts`. */
export interface CompositionEffectsData {
  [key: string]: unknown
  label: string
  /** Composition-effect id from COMPOSITION_EFFECTS catalog. */
  compositionEffect: string
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Post-Process Effects parameter node data. Single-pick image-
 * level grade / processing pass (vignette, grain, halation, bloom, light
 * leak, …). See `packages/shared/src/post-process-effects.ts`. */
export interface PostProcessEffectsData {
  [key: string]: unknown
  label: string
  /** Post-process id from POST_PROCESS_EFFECTS catalog. Single id or up to 2
   *  for layered grading (e.g. ["vignette-soft","film-grain-fine"],
   *  ["halation-glow","bloom"]).
   *  Undefined = user cleared all picks. */
  postProcess: string | ReadonlyArray<string> | undefined
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

/** Standalone Temporal parameter node data. */
export interface TemporalData {
  [key: string]: unknown
  label: string
  /** Per-category temporal selections (multi-category model). One id per
   * enabled category. See `TEMPORAL_FIELD_BY_CATEGORY` in `packages/shared/src/temporal.ts`. */
  temporalSpeed?: string
  temporalFreeze?: string
  temporalDirection?: string
  temporalShutter?: string
  /** Grid columns when displaying multiple enabled categories in the node
   * card. Default (render-time) = 1 (vertical stack). Range 1-4. */
  maxItemsPerRow?: number
  /** Free-text prepended before the structured hint. */
  preText?: string
  /** Free-text appended after the structured hint. */
  postText?: string
}

// --- AI Node Data ---

export interface SceneImageVersion {
  readonly url: string
  readonly timestamp: string
  readonly jobId: string
}

export interface ScriptSceneCharacter {
  readonly name: string
  readonly description: string
  readonly mood: string
  readonly action: string
  readonly position?: string
}

export interface ScriptSceneDialogue {
  readonly speaker: string
  readonly text: string
  readonly emotion?: string
}

export interface ScriptSceneLocation {
  readonly name: string
  readonly description: string
  readonly timeOfDay: string
  readonly weather?: string
  readonly lighting?: string
}

export interface ScriptSceneCinematography {
  readonly shotType: string
  readonly cameraAngle: string
  readonly cameraMovement?: string
}

export interface ScriptScene {
  readonly sceneNumber: number
  readonly sceneName?: string
  readonly visualDescription: string
  readonly action: string
  readonly mood: string | readonly string[]
  readonly durationHint: number
  readonly duration?: number
  readonly imagePrompt: string
  // Structured characters (new) - falls back to string[] for old scripts
  readonly characters?: readonly string[] | readonly ScriptSceneCharacter[]
  // New fields
  readonly dialogue?: readonly ScriptSceneDialogue[]
  readonly location?: ScriptSceneLocation
  readonly cinematography?: ScriptSceneCinematography
  readonly musicMood?: string
  readonly soundEffects?: readonly string[]
  // UI state (unchanged)
  readonly generatedImages?: readonly SceneImageVersion[]
  readonly activeImageIndex?: number
  readonly imageStatus?: "idle" | "running" | "completed" | "failed"
}

/** Extract character names from either string[] or ScriptSceneCharacter[] */
export function getSceneCharacterNames(characters: ScriptScene["characters"]): readonly string[] {
  if (!characters || characters.length === 0) return []
  if (typeof characters[0] === "string") return characters as readonly string[]
  return (characters as readonly ScriptSceneCharacter[]).map((c) => c.name)
}

/** Get mood as a display string regardless of format */
export function getSceneMoodDisplay(mood: ScriptScene["mood"]): string {
  if (Array.isArray(mood)) return mood.join(", ")
  return (mood as string) ?? ""
}

/** Map a ScriptScene to partial SceneNodeDataType fields for import/sync */
export function mapScriptSceneToNodeData(
  scene: ScriptScene,
): Partial<SceneNodeDataType> {
  const characters: SceneCharacterEntry[] = scene.characters
    ? (typeof scene.characters[0] === "string"
        ? (scene.characters as readonly string[]).map(() => ({
            assetId: "",
            mood: "",
            action: "",
          }))
        : (scene.characters as readonly ScriptSceneCharacter[]).map((c) => ({
            assetId: "",
            mood: c.mood ?? "",
            action: c.action ?? "",
            positionInFrame: (c.position as SceneCharacterEntry["positionInFrame"]) ?? undefined,
          })))
    : []

  const dialogue: SceneDialogueEntry[] = scene.dialogue
    ? scene.dialogue.map((d) => ({
        characterId: undefined,
        characterName: d.speaker ?? "",
        text: d.text ?? "",
        emotion: d.emotion ?? undefined,
      }))
    : []

  const locations: SceneLocationEntry[] = scene.location
    ? [{
        assetId: "",
        name: scene.location.name ?? "",
        isPrimary: true,
        timeOfDay: (scene.location.timeOfDay as SceneLocationEntry["timeOfDay"]) ?? undefined,
        weather: (scene.location.weather as SceneLocationEntry["weather"]) ?? undefined,
        lighting: (scene.location.lighting as SceneLocationEntry["lighting"]) ?? undefined,
      }]
    : []

  const mood: string[] = Array.isArray(scene.mood)
    ? [...scene.mood]
    : scene.mood ? [scene.mood as string] : []

  const result: Partial<SceneNodeDataType> = {
    sceneName: scene.sceneName ?? "",
    summary: scene.visualDescription ?? "",
    duration: scene.duration ?? scene.durationHint ?? 5,
    mood,
    musicMood: scene.musicMood ?? "",
    soundEffects: scene.soundEffects ? [...scene.soundEffects] : [],
    characters,
    dialogue,
    locations,
    generatedPrompt: scene.imagePrompt ?? "",
    narration: scene.action ?? "",
  }

  if (scene.cinematography) {
    const c = scene.cinematography
    if (c.shotType) result.shotType = c.shotType as SceneNodeDataType["shotType"]
    if (c.cameraAngle) result.cameraAngle = c.cameraAngle as SceneNodeDataType["cameraAngle"]
    if (c.cameraMovement) result.cameraMovement = c.cameraMovement as SceneNodeDataType["cameraMovement"]
  }

  if (scene.location?.timeOfDay) {
    result.timeOfDay = scene.location.timeOfDay as SceneNodeDataType["timeOfDay"]
  }
  if (scene.location?.weather) {
    result.weather = scene.location.weather as SceneNodeDataType["weather"]
  }
  if (scene.location?.lighting) {
    result.lighting = scene.location.lighting as SceneNodeDataType["lighting"]
  }

  // Carry over generated images if present
  if (scene.generatedImages && scene.generatedImages.length > 0) {
    const activeIdx = scene.activeImageIndex ?? 0
    const activeImg = scene.generatedImages[activeIdx]
    if (activeImg?.url) {
      result.generatedResults = scene.generatedImages.map((img) => ({
        url: img.url,
        timestamp: img.timestamp,
        jobId: img.jobId ?? "",
      }))
      result.activeResultIndex = activeIdx
      result.generatedImageUrl = activeImg.url
    }
  }

  return result
}

export interface ExtractedReference {
  readonly id: string
  readonly name: string
  readonly type: "character" | "location" | "object"
  readonly imageUrl: string
  readonly sourceSceneIndex: number
  readonly boundingBox: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
}

export interface CharacterDefinition {
  readonly id: string
  readonly name: string
  readonly type: "reference" | "description"
  readonly category?: "character" | "face" | "location" | "object"
  readonly referenceImageUrl?: string
  readonly description?: string
  readonly sourceSceneIndex?: number
  readonly importedFrom?: {
    readonly workflowId: string
    readonly workflowName: string
  }
}

export interface GeneratedScript {
  readonly title: string
  readonly totalDuration: number
  readonly scenes: readonly ScriptScene[]
  readonly extractedReferences?: readonly ExtractedReference[]
}

export interface GeneratedScriptResult {
  readonly script: GeneratedScript
  readonly timestamp: string
  readonly jobId: string
}

export type GenerateScriptData = {
  [key: string]: unknown
  label: string
  provider: ScriptProvider
  model: string
  llmModel?: string
  sceneCount: number
  styleGuide: string
  structure: "freeform" | "8-step" | "custom"
  tone: string
  targetLength: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  generatedScript?: GeneratedScript
  generatedResults?: GeneratedScriptResult[]
  activeResultIndex?: number
}

// All image providers (gen + i2i) — derived from shared single source of truth
export type ImageProvider = ImageGenProvider | ImageI2IProvider

export type GenerateImageData = {
  [key: string]: unknown
  label: string
  prompt: string
  provider: ImageProvider
  /** When set with 2+ entries, each press runs the node once per provider with
   *  the same prompt — analogous to repeatCount. UI for editing this field
   *  lives in a separate branch; execution treats it as fan-out via the
   *  shared expandItemsWithRepeat sentinel. */
  providers?: readonly ImageProvider[]
  model: string
  style: string
  aspectRatio: string
  negativePrompt: string
  resolution?: string
  quality?: string
  seed?: number
  renderingSpeed?: string
  styleType?: string
  expandPrompt?: boolean
  referenceImageUrl?: string
  referenceImageUrls?: readonly ManualReferenceImage[]
  referenceImageOrder?: readonly string[]
  /**
   * Unified reorder of the injected-references list (wired raw + @-mentions
   * + canonical fallbacks). Each entry is a stable tile ID using the scheme
   * from `compute-injected-refs.ts`. Additive — when absent, the natural
   * order from `buildImagePrompt` applies (matches pre-feature behavior).
   * Honored by both the orchestrator (`payload-builder.ts` → `buildImagePrompt`)
   * AND the frontend single-node executor (`execute-node.ts`).
   */
  referenceOrder?: readonly string[]
  /**
   * Character slugs whose canonical-fallback (auto-attached when wired but
   * not @-mentioned) the user has explicitly hidden via the × button.
   * Mention variants for the same character still attach.
   */
  suppressedCanonicalCharacterIds?: readonly string[]
  /** Per-identity (imageIndex+label) user overrides for fidelity / custom text. */
  identityMeta?: readonly IdentityMeta[]
  /** Extra reference images with per-ref descriptions. See `ExtraRef`. */
  extraRefs?: readonly ExtraRef[]
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
  characterDefinitionIds?: readonly string[]
}

// Edit Image providers (KIE.ai only)
export type EditImageProvider = ImageEditProvider

export type EditImageData = {
  [key: string]: unknown
  label: string
  prompt: string  // Used for nano-banana-edit (edit instructions)
  provider: EditImageProvider
  upscaleFactor?: string
  targetResolution?: "2K" | "4K" | "8K"
  aspectRatio?: string
  negativePrompt?: string
  style?: string
  seed?: number
  maskUrl?: string
  characterDefinitionIds?: readonly string[]
  connectedMediaOrder?: readonly string[]
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

// Image-to-Image providers (transform source image with prompt)
export type ImageToImageProvider = ImageI2IProvider

export type ImageToImageData = {
  [key: string]: unknown
  label: string
  prompt: string  // Transformation prompt
  provider: ImageToImageProvider
  style?: string
  strength?: number
  aspectRatio?: string
  resolution?: string
  quality?: string
  negativePrompt?: string
  seed?: number
  renderingSpeed?: string
  guidanceScale?: number
  referenceImageUrl?: string
  maskUrl?: string
  characterDefinitionIds?: readonly string[]
  connectedMediaOrder?: readonly string[]
  /** See GenerateImageData.referenceOrder. Additive over connectedMediaOrder. */
  referenceOrder?: readonly string[]
  /** See GenerateImageData.suppressedCanonicalCharacterIds. */
  suppressedCanonicalCharacterIds?: readonly string[]
  /** Extra reference images with per-ref descriptions. See `ExtraRef`. */
  extraRefs?: readonly ExtraRef[]
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

// Modify Image providers (I2I + nano-banana-edit)
export type ModifyImageData = {
  [key: string]: unknown
  label: string
  prompt: string
  provider: ModifyImageProvider
  style?: string
  strength?: number
  aspectRatio?: string
  resolution?: string
  quality?: string
  negativePrompt?: string
  seed?: number
  renderingSpeed?: string
  guidanceScale?: number
  referenceImageUrl?: string
  maskUrl?: string
  characterDefinitionIds?: readonly string[]
  connectedMediaOrder?: readonly string[]
  /** See GenerateImageData.referenceOrder. Additive over connectedMediaOrder. */
  referenceOrder?: readonly string[]
  /** See GenerateImageData.suppressedCanonicalCharacterIds. */
  suppressedCanonicalCharacterIds?: readonly string[]
  /** Extra reference images with per-ref descriptions. See `ExtraRef`. */
  extraRefs?: readonly ExtraRef[]
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type UpscaleImageData = {
  [key: string]: unknown
  label: string
  provider: UpscaleImageProvider
  upscaleFactor?: string
  targetResolution?: "2K" | "4K" | "8K"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type RemoveBackgroundData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type ImageToVideoData = {
  [key: string]: unknown
  label: string
  provider: ImageToVideoProvider
  model: string
  duration: number
  motion?: "subtle" | "moderate" | "dynamic"
  motionEnabled?: boolean
  prompt?: string  // Text description of desired motion/animation
  negativePrompt?: string
  generateAudio?: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" | "adaptive" | "Auto"
  multiShot?: boolean
  resolution?: string
  grokMode?: "fun" | "normal" | "spicy"
  videoSize?: "standard" | "high"
  seed?: number
  cameraFixed?: boolean
  shots?: Array<{ prompt: string; duration: number }>
  elements?: Array<{ name: string; description: string; type: "image" | "video"; urls: string[] }>
  // Seedance 2.0 fields (reference arrays resolved from edges at runtime, not stored on data)
  webSearch?: boolean
  nsfwChecker?: boolean
  // Smart-loop-cut post-process. When `enabled: true`, the worker runs a
  // PSNR-based loop-point search after generation and trims the clip there.
  // Replaces the legacy autoLoopTrim (VEO 3.1 only, fixed 8 frames).
  // `framesToTest` (default 16, range 1-64) controls search depth.
  // `quality`:
  //   - "precise"  (default): any-frame candidates + libx264 re-encode.
  //                Frame-precise; slight quality loss.
  //   - "lossless": keyframe-only candidates + stream-copy. Byte-perfect;
  //                 cut snaps to nearest keyframe; supports any resolution
  //                 including 4K with no encode-pipeline memory cost.
  loopTrim?: {
    enabled: boolean
    framesToTest?: number
    quality?: "lossless" | "precise"
  }
  // VEO 3.x only. KIE auto-translates prompts to English by default. Set
  // false to keep prompts (e.g. the perfect-loop seal phrase) verbatim.
  // Default true (matches KIE behaviour) — undefined means "send default".
  enableTranslation?: boolean
  // Multi-input selection fields
  selectedStartFrameNodeId?: string  // ID of node selected for start frame
  selectedEndFrameNodeId?: string    // ID of node selected for end frame (optional)
  selectedAudioNodeId?: string       // ID of node selected for audio track (optional)
  // Progress tracking fields
  currentJobId?: string              // ID of the currently running job (for progress polling)
  currentJobProgress?: number        // Progress percentage from backend (0-100)
  kieTaskId?: string                 // KIE task ID for extend/upscale operations (VEO, Runway)
  connectedImageOrder?: readonly string[]
  /** User-defined order of the connections wired into the `references` handle.
   * Drives which character becomes "Image 1" vs "Image 2" in the assembled
   * prompt when multiple characters/uploads are wired to references. The
   * orchestrator + frontend execute-node apply this order BEFORE assigning
   * positional Image-N letters. IDs not in the array fall to the end. */
  connectedRefImageOrder?: readonly string[]
  /** See GenerateImageData.referenceOrder. Additive over connectedRefImageOrder. */
  referenceOrder?: readonly string[]
  /** See GenerateImageData.suppressedCanonicalCharacterIds. */
  suppressedCanonicalCharacterIds?: readonly string[]
  veoMode?: "frame-to-frame" | "reference"  // VEO 3/3.1: toggle between start+end frame and reference mode
  seedance2InputMode?: "frames" | "references"  // Seedance 2: toggle between start/end frames and reference media
  /** Extra reference images with per-ref descriptions. See `ExtraRef`. */
  extraRefs?: readonly ExtraRef[]
  videoPlayState?: "loop" | "paused" | "stopped"
  pausedAtTime?: number
}

export type TextToSpeechData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  provider: TtsProvider
  voiceId: string
  voiceLabel?: string
  voiceType: "premade" | "custom" | "library"
  voiceDisplayName: string
  language: string
  speed: number
  stability: number
  similarityBoost: number
  style: number
  languageCode: string
  textSource: "connected" | "direct"
  directText: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type TextToVideoData = {
  [key: string]: unknown
  label: string
  prompt: string
  provider: TextToVideoProvider
  duration: number
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" | "adaptive"
  negativePrompt: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  seed?: number                      // VEO 3.1: reproducible generation (10000-99999)
  // VEO 3.x: opt out of KIE's auto-translate-to-English. Same semantics
  // as on ImageToVideoData.
  enableTranslation?: boolean
  // Seedance 2.0 fields (reference arrays resolved from edges at runtime, not stored on data)
  resolution?: string
  generateAudio?: boolean
  webSearch?: boolean
  nsfwChecker?: boolean
  // Progress tracking fields
  currentJobId?: string              // ID of the currently running job (for progress polling)
  currentJobProgress?: number        // Progress percentage from backend (0-100)
  kieTaskId?: string                 // KIE task ID for extend/upscale operations (VEO, Runway)
  /** User-defined order of the connections wired into the `references` handle.
   * Mirrors `ImageToVideoData.connectedRefImageOrder` — drives Image-1/Image-2
   * positional assignment in the assembled prompt for multi-character t2v. */
  connectedRefImageOrder?: readonly string[]
  /** See GenerateImageData.referenceOrder. Additive over connectedRefImageOrder. */
  referenceOrder?: readonly string[]
  /** See GenerateImageData.suppressedCanonicalCharacterIds. */
  suppressedCanonicalCharacterIds?: readonly string[]
  /** Extra reference images with per-ref descriptions. See `ExtraRef`. */
  extraRefs?: readonly ExtraRef[]
  videoPlayState?: "loop" | "paused" | "stopped"
  pausedAtTime?: number
}

export type VideoToVideoData = {
  [key: string]: unknown
  label: string
  prompt: string
  provider: VideoToVideoProvider
  duration: number
  negativePrompt?: string
  fieldMappings: FieldMappings
  // Wan / Wan Flash params
  v2vDuration?: "5" | "10"
  v2vResolution?: "720p" | "1080p"
  // Wan Flash only
  audio?: boolean
  multiShots?: boolean
  // Wan 2.7 VideoEdit params
  videoEditDuration?: "0" | "5" | "10"
  audioSetting?: "auto" | "origin"
  promptExtend?: boolean
  // Runway Aleph params
  aspectRatio?: string
  seed?: number
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  // Progress tracking fields
  currentJobId?: string              // ID of the currently running job (for progress polling)
  currentJobProgress?: number        // Progress percentage from backend (0-100)
  connectedImageOrder?: readonly string[]
  /** See GenerateImageData.referenceOrder. Additive over connectedImageOrder. */
  referenceOrder?: readonly string[]
  /** See GenerateImageData.suppressedCanonicalCharacterIds. */
  suppressedCanonicalCharacterIds?: readonly string[]
  /** Extra reference images with per-ref descriptions. See `ExtraRef`. */
  extraRefs?: readonly ExtraRef[]
  videoPlayState?: "loop" | "paused" | "stopped"
  pausedAtTime?: number
}

export type LipSyncData = {
  [key: string]: unknown
  label: string
  provider: LipSyncProvider
  // 1080p only valid for seedance-2 / seedance-2-fast; other KIE providers cap at 720p.
  resolution: "480p" | "720p" | "1080p"
  prompt: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  // Multi-input selection fields
  selectedImageNodeId?: string   // ID of node selected for portrait/face image
  selectedVideoNodeId?: string   // ID of node selected for video input
  selectedAudioNodeId?: string   // ID of node selected for audio track
  // Measured length of the resolved audio (seconds). Drives per-second
  // credit reservation for kling-avatar(-pro); probed client-side via
  // HTMLAudioElement metadata when the audio URL changes.
  audioDurationSec?: number
  // LatentSync params
  guidanceScale?: number
  inferenceSteps?: number
  seed?: number
  // Wav2Lip params
  pads?: string
  smooth?: boolean
  fps?: number
  resizeFactor?: number
  // SadTalker params
  enhancer?: "gfpgan" | "RestoreFormer"
  preprocess?: "crop" | "resize" | "full"
  still?: boolean
  poseStyle?: number
  expressionScale?: number
  /** See GenerateImageData.referenceOrder. */
  referenceOrder?: readonly string[]
  /** See GenerateImageData.suppressedCanonicalCharacterIds. */
  suppressedCanonicalCharacterIds?: readonly string[]
  videoPlayState?: "loop" | "paused" | "stopped"
  pausedAtTime?: number
}

export type SpeechToVideoData = {
  [key: string]: unknown
  label: string
  prompt: string
  resolution: "480p" | "580p" | "720p"
  negativePrompt?: string
  seed?: number
  numFrames?: number
  fps?: number
  inferenceSteps?: number
  guidanceScale?: number
  shift?: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
  /** See GenerateImageData.referenceOrder. */
  referenceOrder?: readonly string[]
  /** See GenerateImageData.suppressedCanonicalCharacterIds. */
  suppressedCanonicalCharacterIds?: readonly string[]
  videoPlayState?: "loop" | "paused" | "stopped"
  pausedAtTime?: number
}

// Motion Transfer: Apply motion from video to image character
// KIE.ai models: kling-2.6/motion-control, kling-3.0/motion-control
export type MotionTransferData = {
  [key: string]: unknown
  label: string
  prompt: string // Optional, max 2500 chars
  characterOrientation: "image" | "video" // image = max 10s, video = max 30s
  resolution: "720p" | "1080p" | "480p" | "580p"
  provider?: "kling" | "kling-3.0" | "wan-animate-move" | "wan-animate-replace"
  backgroundSource?: "input_video" | "input_image"
  videoDuration?: number // Detected from connected video (seconds), used for per-second pricing
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
  /** See GenerateImageData.referenceOrder. */
  referenceOrder?: readonly string[]
  /** See GenerateImageData.suppressedCanonicalCharacterIds. */
  suppressedCanonicalCharacterIds?: readonly string[]
  videoPlayState?: "loop" | "paused" | "stopped"
  pausedAtTime?: number
}

// Video Upscale: Upscale video resolution using Topaz or VEO
export type VideoUpscaleData = {
  [key: string]: unknown
  label: string
  provider: VideoUpscaleProvider
  upscaleFactor: "1" | "2" | "4"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
  kieTaskId?: string              // KIE task ID from upstream VEO node (for VEO upscale providers)
}

// Extend Video: Continue a VEO or Runway video with a new prompt
export type ExtendVideoData = {
  [key: string]: unknown
  label: string
  provider: ExtendVideoProvider
  prompt: string
  negativePrompt?: string
  model?: "fast" | "quality"      // VEO only
  seeds?: number                   // VEO only
  quality?: "720p" | "1080p"      // Runway only
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
  kieTaskId?: string              // KIE task ID from upstream video node (required)
  videoPlayState?: "loop" | "paused" | "stopped"
  pausedAtTime?: number
}

export type FaceSwapData = {
  [key: string]: unknown
  label: string
  provider: FaceSwapProvider
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
  /** See GenerateImageData.referenceOrder. */
  referenceOrder?: readonly string[]
  /** See GenerateImageData.suppressedCanonicalCharacterIds. */
  suppressedCanonicalCharacterIds?: readonly string[]
  videoPlayState?: "loop" | "paused" | "stopped"
  pausedAtTime?: number
}

// Generate Mask: text-prompted segmentation (Grounded SAM via Replicate).
// Produces a binary mask PNG isolating the subject described by `prompt`,
// while passing through the original image so a downstream Mask Painter /
// inpainting node can consume the image + mask pair together.
export type GenerateMaskData = {
  [key: string]: unknown
  label: string
  prompt: string
  threshold?: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedMaskUrl?: string
  generatedImageUrl?: string
  generatedResults?: Array<{ imageUrl: string; maskUrl: string }>
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type QACheckData = {
  [key: string]: unknown
  label: string
  provider: QaCheckProvider
  checkType: "content" | "quality" | "consistency" | "safety"
  threshold: number
  llmModel?: string
  fieldMappings: FieldMappings
  currentJobId?: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  score?: number
  approved?: boolean
  reason?: string
}

export type GenerateMusicData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  prompt: string
  provider: MusicProvider
  duration: number
  genre: string
  mood: string
  instrumental: boolean
  lyrics: string
  referenceAudioUrl: string
  referenceYouTubeUrl: string
  referenceSource: "none" | "upload" | "youtube"
  modelVersion: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type TextToAudioData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  prompt: string
  provider: TextToAudioProvider
  duration: number
  loop?: boolean
  promptInfluence?: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type SunoGenerateData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  prompt: string
  model: SunoModel
  lyrics?: string
  style?: string
  title?: string
  negativeStyle?: string
  vocalGender?: "male" | "female"
  styleWeight?: number
  weirdnessConstraint?: number
  audioWeight?: number
  customMode?: boolean
  instrumental?: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type SunoCoverData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  prompt: string
  model: SunoModel
  uploadUrl?: string
  lyrics?: string
  style?: string
  title?: string
  negativeStyle?: string
  vocalGender?: "male" | "female"
  customMode?: boolean
  instrumental?: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type SunoExtendData = {
  [key: string]: unknown
  label: string
  audioId: string
  defaultParamFlag: boolean
  prompt: string
  model: SunoModel
  style?: string
  title?: string
  continueAt?: number
  negativeStyle?: string
  vocalGender?: "male" | "female"
  styleWeight?: number
  weirdnessConstraint?: number
  audioWeight?: number
  instrumental?: boolean
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
  fieldMappings?: FieldMappings
}

export type SunoLyricsData = {
  [key: string]: unknown
  label: string
  prompt: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedText?: string
  generatedTitle?: string
  generatedResults?: Array<{ text: string; title: string; jobId?: string }>
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
  fieldMappings?: FieldMappings
}

export type SunoSeparateData = {
  [key: string]: unknown
  label: string
  type: "separate_vocal" | "split_stem"
  taskId: string
  audioId: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  vocalUrl?: string
  instrumentalUrl?: string
  stems?: Record<string, string>
  currentJobId?: string
  currentJobProgress?: number
  fieldMappings?: FieldMappings
}

export type SunoMusicVideoData = {
  [key: string]: unknown
  label: string
  taskId: string
  audioId: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
  fieldMappings?: FieldMappings
}

export type SunoMashupData = {
  [key: string]: unknown
  label: string
  model: SunoModel
  customMode: boolean
  style: string
  title: string
  negativeStyle: string
  vocalGender: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type SunoReplaceSectionData = {
  [key: string]: unknown
  label: string
  infillStartS: number
  infillEndS: number
  prompt: string
  tags: string
  title: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type SunoStyleBoostData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  content: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedText?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type SunoAddInstrumentalData = {
  [key: string]: unknown
  label: string
  model: "V4_5PLUS" | "V5" | "V5_5"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type SunoAddVocalsData = {
  [key: string]: unknown
  label: string
  model: "V4_5PLUS" | "V5" | "V5_5"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type SunoConvertWavData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type SunoUploadExtendData = {
  [key: string]: unknown
  label: string
  prompt: string
  model: SunoModel
  style: string
  title: string
  negativeStyle: string
  vocalGender: string
  continueAt: number
  defaultParamFlag: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type AudioIsolationData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type TranscribeData = {
  [key: string]: unknown
  label: string
  provider: TranscribeProvider
  language: string
  diarize?: boolean
  tagAudioEvents?: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  generatedText?: string
  generatedResults?: Array<{ text: string; language: string; jobId: string; timestamp: string }>
  activeResultIndex?: number
}

export interface DialogueLine {
  readonly id: string
  readonly text: string
  readonly voice: string
  readonly voiceLabel?: string
}

export type TextToDialogueData = {
  [key: string]: unknown
  label: string
  dialogue: DialogueLine[]
  stability: number
  languageCode: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export interface AlignmentWord {
  readonly word: string
  readonly start: number
  readonly end: number
}

export type VoiceChangerData = {
  [key: string]: unknown
  label: string
  voiceId: string
  voiceLabel: string
  voiceType: "premade" | "custom" | "library"
  stability: number
  similarityBoost: number
  removeBackgroundNoise: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type DubbingData = {
  [key: string]: unknown
  label: string
  targetLanguage: string
  sourceLanguage?: string
  numSpeakers?: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type VoiceRemixData = {
  [key: string]: unknown
  label: string
  text: string
  voiceDescription: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type VoiceDesignData = {
  [key: string]: unknown
  label: string
  text: string
  voiceDescription: string
  model?: VoiceDesignModel
  loudness?: number
  guidanceScale?: number
  seed?: number
  quality?: number
  shouldEnhance?: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedVoiceId?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type ForcedAlignmentData = {
  [key: string]: unknown
  label: string
  transcript: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  alignmentResults?: AlignmentWord[]
  currentJobId?: string
  currentJobProgress?: number
}

export type ImageToTextData = {
  [key: string]: unknown
  label: string
  detailLevel: "brief" | "detailed" | "structured"
  customPrompt: string
  llmModel?: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  generatedText?: string
  generatedResults?: Array<{ text: string; jobId: string; timestamp: string }>
  activeResultIndex?: number
}

// --- Processing Node Data ---

export type CombineVideosData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  transition: "cut" | "fade" | "dissolve" | "dip-to-black" | "dip-to-white"
  transitionDuration: number
  audioMode: "keep" | "crossfade" | "remove"
  trimStartFrames?: number
  trimEndFrames?: number
  clipOrder?: string[]
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export interface MergeAudioTrack {
  readonly id: string
  readonly sourceNodeId: string
  readonly sourceNodeLabel: string
  readonly sourceType: "audio" | "video"
  readonly role: "dialogue" | "background" | "effect" | "narration"
  readonly volume: number
  readonly startTime: number
}

export type MergeVideoAudioData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  // Main video's embedded audio
  keepOriginalAudio?: boolean
  originalAudioVolume?: number
  originalAudioRole?: "background" | "effect" | "narration"
  // Per-track settings keyed by source node ID
  trackSettings?: Record<string, { role: string; volume?: number; startTime?: number }>
  // Legacy fields (backward compat)
  audioType: "voiceover" | "background" | "both"
  voiceoverVolume: number
  backgroundVolume: number
  audioOffsets?: Record<string, number>
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type AddCaptionsData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  style: CaptionStyle
  position: "bottom" | "top" | "center"
  fontSize: number
  color: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
  // NEW
  autoTranscribe?: boolean
  transcribeProvider?: "whisper" | "incredibly-fast-whisper" | "elevenlabs-stt"
}

export type ResizeVideoData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  targetAspect: "1:1" | "16:9" | "9:16" | "4:5"
  method: "crop" | "pad" | "stretch"
  padColor: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type SocialMediaFormatData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  platform: string
  contentType: string
  specKey: string
  method: "crop" | "pad" | "stretch"
  padColor: string
  formattedText: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type SocialPlatformType = "instagram" | "tiktok" | "youtube" | "linkedin" | "x" | "facebook" | "telegram"

export interface SocialConnection {
  id: string
  platform: string
  platform_user_id: string
  platform_username: string | null
  platform_avatar_url: string | null
  display_name: string | null
}

export type SocialPostData = {
  [key: string]: unknown
  label: string
  platform: SocialPlatformType
  action: string
  connectionId?: string
  caption: string
  title?: string
  description?: string
  tags?: string[]
  privacy?: string
  chatId?: string        // Telegram only
  parseMode?: string     // Telegram only
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  platformPostId?: string
  platformPostUrl?: string
  currentJobId?: string
  generatedResults?: readonly GeneratedResult[]
}

export type TrimAudioData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  audioFormat: "mp3" | "wav" | "aac"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type SplitMediaData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  chunkDuration: number
  audioFormat?: "mp3" | "wav" | "aac"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrls?: string[]
  generatedAudioUrls?: string[]
  selectedAudioChunks?: number[]
  selectedVideoChunks?: number[]
  outputChunkIndex?: number
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
}

export type MixAudioData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  trackCount: number
  trackVolumes: Record<string, number>
  trackOrder?: string[]
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type CombineAudioData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  segmentOrder?: string[]
  segmentSettings?: Record<string, { startTime?: number; endTime?: number; volume?: number }>
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
}

export type AdjustVolumeData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  volume: number
  normalize: boolean
  fadeIn: number
  fadeOut: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedVideoUrl?: string
  lastInputType?: "audio" | "video"
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type TrimVideoData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  /** Trim mode — "time" (default; uses startTime/endTime), "frames" (uses
   *  trimStartFrames/trimEndFrames), or "smart-loop-cut" (worker probes
   *  source for the trailing frame closest to frame 0 and trims there). */
  trimMode?: "time" | "frames" | "smart-loop-cut"
  startTime: number
  endTime: number
  /** Frame-based trim from start. Used when trimMode === "frames". */
  trimStartFrames?: number
  /** Frame-based trim from end. Used when trimMode === "frames". */
  trimEndFrames?: number
  /** Smart-loop-cut lookback window — how many trailing frames to evaluate
   *  as candidate end-frames. Default 16, max 64. */
  smartLoopCutLookback?: number
  outputSilentVideo?: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type ExtractFrameData = {
  [key: string]: unknown
  label: string
  mode: "first" | "last" | "timestamp"
  timestamp: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobProgress?: number
}

export type VideoComposerData = {
  [key: string]: unknown
  label: string
  compositionPrompt: string
  sceneGraph?: Record<string, unknown>
  fps: number
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"
  durationSeconds: number
  backgroundColor: string
  assetOrder?: string[]
  llmModel?: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
}

export type AfterEffectsData = {
  [key: string]: unknown
  label: string
  effectPrompt: string
  effectPlan?: Record<string, unknown>
  inputVideoUrl?: string
  width?: number
  height?: number
  llmModel?: string
  fps: number
  durationSeconds: number
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
}

export type LottieOverlayData = {
  [key: string]: unknown
  label: string
  overlayPrompt: string
  overlayPlan?: Record<string, unknown>
  inputVideoUrl?: string
  width?: number
  height?: number
  lottieAssets?: Array<{ id: string; url: string; name: string; durationSeconds?: number }>
  llmModel?: string
  fps: number
  durationSeconds: number
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
}

export type ThreeDTitleData = {
  [key: string]: unknown
  label: string
  titlePrompt: string
  titlePlan?: Record<string, unknown>
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"
  backgroundColor: string
  backgroundMediaUrl?: string
  llmModel?: string
  fps: number
  durationSeconds: number
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
}

export type MotionGraphicsData = {
  [key: string]: unknown
  label: string
  motionPrompt: string
  motionPlan?: Record<string, unknown>
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"
  backgroundColor: string
  llmModel?: string
  fps: number
  durationSeconds: number
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
}

export interface CompositeLayerConfig {
  id: string
  inputHandle: string      // "video1" | "video2" | "video3" | "video4"
  position: "fullscreen" | "positioned"
  x?: number
  y?: number
  width?: number
  height?: number
  startFrame?: number
  durationInFrames?: number
  opacity: number
  blendMode: "normal" | "multiply" | "screen" | "overlay"
  zIndex?: number
}

export type CompositeData = {
  [key: string]: unknown
  label: string
  layers: CompositeLayerConfig[]
  compositePlan?: Record<string, unknown>
  fps: number
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"
  durationSeconds: number
  backgroundColor: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
}

export type RenderVideoData = {
  [key: string]: unknown
  label: string
  fps: number
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"
  durationSeconds: number
  backgroundColor: string
  assetOrder?: string[]
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type SpeedRampData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  speed: number
  adjustAudio: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type LoopVideoData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  mode: "repeat" | "duration"
  repeatCount: number
  targetDuration: number
  /** Smart-loop-cut preprocess: trim the source clip to its cleanest
   *  loop boundary BEFORE concatenating N copies. Eliminates seam
   *  discontinuity at every internal repeat boundary, not just the
   *  final wrap. Default off. */
  smartLoopCutBeforeRepeat?: boolean
  smartLoopCutLookback?: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type FadeVideoData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  fadeIn: boolean
  fadeInDuration: number
  fadeOut: boolean
  fadeOutDuration: number
  color: "black" | "white"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type TranscodeVideoData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  codec: "h264" | "h265"
  crf: number
  resolution: "original" | "1080p" | "720p" | "480p"
  audioBitrate: "128k" | "192k" | "256k" | "320k"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type ManualEditData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  mode?: "bypass" | "wait"
  editorLoad?: "first" | "all"
  executionStatus?: "idle" | "running" | "awaiting-user" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
  inputVideoUrl?: string
  inputAssets?: Array<{ nodeId: string; url: string; type: "video" | "image" | "audio"; label?: string }>
  isEditorOpen?: boolean
  videoPlayState?: "loop" | "paused" | "stopped"
  pausedAtTime?: number
}

// --- Output Node Data ---

export type SaveToStorageData = {
  [key: string]: unknown
  label: string
  filename: string
  format: "mp4" | "webm" | "mov"
  quality: "draft" | "standard" | "high" | "4k"
  fieldMappings: FieldMappings
  currentJobId?: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  savedUrl?: string
  generatedResults?: readonly GeneratedResult[]
}

export type WebhookOutputData = {
  [key: string]: unknown
  label: string
  url: string
  params: WebhookParam[]
  currentJobId?: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  webhookSuccess?: boolean
  webhookStatusCode?: number
  webhookResponseBody?: string
}

// --- Character Node Data ---

export interface CharacterSheet {
  readonly frontView: string
  readonly sideView: string
  readonly backView: string
  readonly combinedSheet: string
}

export interface CharacterAssetItem {
  readonly name: string
  readonly url: string
  /** Per-variant description (e.g. "smile", "side profile"). Backend persists this on
   *  the character row; surfaced by `getCharacter`. Used by @-mention expansion in
   *  config panels + the runtime prompt builder to attach per-variant fidelity blocks. */
  readonly description?: string
  /** Motion clips (i2v) only — natural-language description of the motion captured. */
  readonly motionDescription?: string
  /** Real-life reference URLs (from the user's photos) that were used to generate
   *  this variant. Used by char-studio to detect stale renders when refs change. */
  readonly realLifeRefs?: ReadonlyArray<string>
}

export type CharacterAssetType =
  | "expressions"
  | "poses"
  | "lighting"
  | "angles"
  | "headAngles"
  | "bodyAngles"
  | "custom"

export interface CharacterVoice {
  voiceId: string      // ElevenLabs voice ID
  voiceName: string    // display name (e.g. "Rachel")
  traits: string       // free-form descriptive traits ("deep, calm, British accent")
}

export interface CharacterPersonality {
  mood: string              // "serious and focused"
  speechStyle: string       // "speaks in short, direct sentences"
  movementStyle: string     // "confident, deliberate movement"
  behavioralNotes: string   // "responds aggressively when challenged"
}

export type CharacterNodeData = {
  [key: string]: unknown
  label: string
  characterDbId: string
  characterName: string
  description: string
  sourceImageUrl: string
  gender: "male" | "female" | "other"
  style: "realistic" | "anime" | "3d-pixar" | "illustration"
  baseOutfit: string
  provider?: string
  /** Identity preservation strength when this Character is fed as a reference.
   *  - "off"     — model is free to creatively reinterpret the face
   *  - "soft"    — encourage facial likeness preservation
   *  - "strict"  — clamp facial identity precisely to the reference photo (default for face-locked workflows)
   *  Defaults to "soft" for backward compatibility. */
  identityLock?: "off" | "soft" | "strict"
  /**
   * Default usage mode for `@kira:N` mentions of this character. Drives the
   * per-image directive in the assembled prompt — "identical" emits the full
   * likeness lock, "face" / "face-pose" / "emotion" / "style" emit narrower
   * directives. Overridden per-mention by a 4-part slug (`@kira:1:smile:face`).
   * Defaults to "identical" (the legacy "match exactly" behavior) when unset.
   * See `packages/shared/src/character-usage-mode.ts`.
   */
  defaultUsageMode?: import("@nodaro/shared").UsageMode
  characterSheet: CharacterSheet | null
  projectId: string
  createdAt: string
  executionStatus: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  generatedResults: GeneratedResult[]
  activeResultIndex: number
  fieldMappings: FieldMappings
  scriptCharacterIndex?: number
  // Asset sheets (combined grid images)
  expressionSheet: string
  poseSheet: string
  lightingSheet: string
  anglesSheet: string
  // Individual cropped images
  expressions: CharacterAssetItem[]
  poses: CharacterAssetItem[]
  lightingVariations: CharacterAssetItem[]
  // `angles` is the legacy single-surface column; the UI now treats it as
  // head-and-shoulders portraits (Head Angles). `bodyAngles` (migration 118)
  // holds full-body natural standing views.
  angles: CharacterAssetItem[]
  bodyAngles: CharacterAssetItem[]
  // Asset generation status
  expressionStatus: "idle" | "running" | "completed" | "failed"
  poseStatus: "idle" | "running" | "completed" | "failed"
  lightingStatus: "idle" | "running" | "completed" | "failed"
  anglesStatus: "idle" | "running" | "completed" | "failed"
  bodyAnglesStatus: "idle" | "running" | "completed" | "failed"
  // Custom variations
  customVariations: Array<{ prompt: string; url: string; createdAt: string }>
  // Motion video clips (i2v) — reuses { name, url }
  motions: CharacterAssetItem[]
  motionStatus: "idle" | "running" | "completed" | "failed"
  // Voice + personality (Phase 1: stored only; Phase 2: auto-injected downstream)
  voice: CharacterVoice | null
  personality: CharacterPersonality | null
  // Real-life reference photos uploaded by the user (face, body, outfit, etc.) — routed
  // per-asset-target via `routePhotosForAsset` in `@/lib/reference-photo-routing`.
  readonly referencePhotos?: ReadonlyArray<{ url: string; kind: ReferencePhotoKind }>
  // Frozen seed prompt captured at first sheet generation — keeps later regens consistent.
  readonly seedPrompt?: string
  // LLM-authored canonical likeness description, derived from referencePhotos + identity fields.
  readonly canonicalDescription?: string
  // Per-variant cache of real-life reference URLs used at last generation (key = variant id,
  // e.g. expression/pose/angle/lighting slug); used to detect stale renders when refs change.
  readonly realLifeRefsByVariant?: Readonly<Record<string, ReadonlyArray<string>>>
  // When true, downstream image-to-image / image-to-video / generate-image nodes
  // wired to this Character will forward `injectCharacterContext: true` +
  // `attachToCharacterId: characterDbId` so the backend route appends the
  // canonical description + an identity-preserve suffix to the prompt.
  // Defaults to false (must explicitly opt in per Character node).
  readonly injectIdentityInPrompts?: boolean
  // ── Character LoRA training (Cloud edition only) ───────────────────────────
  // Read from the DB by character-node.tsx (on-mount backfill) and the modal
  // (post-status-poll). The orchestrator's expandWiredCharacterRefs reads
  // these off CharacterNodeData and stamps them on each ConnectedReference;
  // selectLoraRoutingForMentions then decides whether the LoRA path applies.
  readonly loraReplicateVersion?: string | null
  readonly loraTriggerWord?: string | null
  readonly loraTrainingStatus?: "queued" | "training" | "succeeded" | "failed" | "cancelled" | null
  // Per-CANVAS-NODE default asset selected from the Character Studio's grid
  // (expression / pose / angle / lighting / motion). Drives the canvas
  // thumbnail when set (falls back to `sourceImageUrl`). NOT a property of
  // the underlying `characters` DB row — two character nodes referencing the
  // same DB character can each have their own default. Frontend-only field;
  // never sent to `saveCharacter`.
  readonly defaultAssetUrl?: string
  readonly defaultAssetName?: string
  // Per-canvas-node crop aspect ratio for the default-asset thumbnail AND a
  // node-level override for the per-asset-type aspect-ratio defaults applied
  // by `generate-character`, `generate-character-asset`, and
  // `generate-character-motion`. Frontend-only (lives on node data, not the DB
  // row). When set, the studio passes it through to the routes as
  // `characterNodeAspectRatio`, which loses to an explicit request `aspectRatio`
  // but wins against the per-asset-type default (portrait=3:4, expressions=1:1,
  // poses=9:16, headAngles=3:4, bodyAngles=9:16, lighting=3:4, motions=9:16).
  // Toggling 1:1/3:4/16:9/9:16 also switches the image container's
  // `aspect-ratio` CSS while keeping `object-fit: cover` so the image still
  // crops cleanly without stretching.
  readonly defaultAssetAspectRatio?: CharacterAspectRatio
}

// --- Object Node Data ---

export interface ObjectAssetItem {
  readonly name: string
  readonly url: string
}

export type ObjectAssetType = "angles" | "materials" | "variations" | "custom"

export type ObjectNodeData = {
  [key: string]: unknown
  label: string
  objectDbId: string
  objectName: string
  description: string
  category: "furniture" | "vehicle" | "weapon" | "food" | "clothing" | "electronics" | "nature" | "tool" | "animal" | "other"
  style: "realistic" | "anime" | "3d-pixar" | "illustration"
  provider?: string
  sourceImageUrl: string
  projectId: string
  createdAt: string
  // Only meaningful when category === "animal" — references an entry in packages/shared/src/animals.ts
  animalId?: string
  // Only meaningful when category === "vehicle" — references an entry in packages/shared/src/vehicles.ts
  vehicleId?: string
  // Only meaningful when category === "furniture" — references an entry in packages/shared/src/furniture.ts
  furnitureId?: string
  // Only meaningful when category === "weapon" — references an entry in packages/shared/src/weapons.ts
  weaponId?: string
  executionStatus: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  generatedResults: GeneratedResult[]
  activeResultIndex: number
  fieldMappings: FieldMappings
  // Individual asset images
  angles: ObjectAssetItem[]
  materials: ObjectAssetItem[]
  variations: ObjectAssetItem[]
  // Asset generation status
  anglesStatus: "idle" | "running" | "completed" | "failed"
  materialsStatus: "idle" | "running" | "completed" | "failed"
  variationsStatus: "idle" | "running" | "completed" | "failed"
  // Custom variations
  customVariations: Array<{ prompt: string; url: string; createdAt: string }>
}

// --- Location Node Data ---

export interface LocationAssetItem {
  readonly name: string
  readonly url: string
}

export type LocationAssetType = "timeOfDay" | "weather" | "angles" | "custom"

export type LocationNodeData = {
  [key: string]: unknown
  label: string
  locationDbId: string
  locationName: string
  description: string
  category: "indoor" | "outdoor" | "urban" | "nature" | "fantasy" | "sci-fi" | "historical" | "futuristic" | "other"
  style: "realistic" | "anime" | "3d-pixar" | "illustration"
  provider?: string
  sourceImageUrl: string
  projectId: string
  createdAt: string
  executionStatus: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  generatedResults: GeneratedResult[]
  activeResultIndex: number
  fieldMappings: FieldMappings
  scriptLocationIndex?: number
  // Individual asset images
  timeOfDay: LocationAssetItem[]
  weather: LocationAssetItem[]
  angles: LocationAssetItem[]
  // Asset generation status
  timeOfDayStatus: "idle" | "running" | "completed" | "failed"
  weatherStatus: "idle" | "running" | "completed" | "failed"
  anglesStatus: "idle" | "running" | "completed" | "failed"
  // Custom variations
  customVariations: Array<{ prompt: string; url: string; createdAt: string }>
}

// --- Face Node Data ---

export type FaceNodeData = {
  [key: string]: unknown
  label: string
  faceDbId: string
  faceName: string
  description: string
  sourceImageUrl: string
  style: "realistic" | "anime" | "3d-pixar" | "illustration"
  provider?: string
  projectId: string
  createdAt: string
  executionStatus: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  generatedResults: GeneratedResult[]
  activeResultIndex: number
  fieldMappings: FieldMappings
}

// --- LLM Chat Node Data ---

export type LLMChatData = {
  [key: string]: unknown
  label: string
  systemPrompt: string
  userInput: string
  llmModel?: string
  temperature: number
  maxTokens: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedText?: string
  generatedResults?: Array<{ text: string; jobId?: string; timestamp?: string; systemPrompt?: string; userPrompt?: string; listValue?: string; runId?: string }>
  activeResultIndex?: number
  lastSystemPrompt?: string
  lastUserPrompt?: string
  /** Image reference URLs (manual + DAG-resolved). Always allowed. */
  referenceImageUrls?: readonly string[]
  /** Video reference URLs. Only used when llmModel supports video (Gemini family). */
  referenceVideoUrls?: readonly string[]
  /** Audio reference URLs. Only used when llmModel supports audio (Gemini family). */
  referenceAudioUrls?: readonly string[]
}

// --- AI Writer Node Data ---

export type AIWriterNodeData = {
  [key: string]: unknown
  label: string
  templateId: string
  systemPrompt: string
  userInput: string
  /** @deprecated Single-option dropdown ("claude") was removed; LLM is now picked via `llmModel`. Kept optional for backward compat with saved workflows. */
  provider?: AiWriterProvider
  /** @deprecated Use llmModel instead. Kept optional for backward compat with saved workflows. */
  model?: string
  llmModel?: string
  temperature: number
  maxTokens: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedText?: string
  generatedItems?: string[]
  generatedResults?: Array<{ text: string; jobId?: string; timestamp?: string }>
  activeResultIndex?: number
  createdNodeIds?: string[]
}

// --- Web Scrape Node Data ---

export type WebScrapeNodeData = {
  [key: string]: unknown
  label: string
  actor?: ScraperActorId
  // content-crawler
  url?: string
  mode?: "page" | "site"
  // google-search
  query?: string
  maxResults?: number
  countryCode?: string
  // instagram | tiktok
  target?: string
  resultsLimit?: number
  // execution state
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  // execution result — single structured json output (matches backend ActorOutput)
  generatedJson?: unknown
}

// --- Combine Text Node Data ---

export type CombineTextNodeData = {
  [key: string]: unknown
  label: string
  separator: "newline" | "comma" | "space" | "double-newline" | "stars" | "custom"
  customSeparator: string
  combinedText: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
}

// --- Preview Node Data ---

export interface PreviewItem {
  readonly type: "text" | "image" | "video" | "audio" | "data"
  readonly value: string
  readonly itemKey?: string
  readonly sourceNodeId: string
  readonly sourceHandle?: string
  readonly sourceNodeLabel: string
  readonly visible: boolean
}

export type PreviewNodeData = {
  [key: string]: unknown
  label: string
  previewItems: PreviewItem[]
  /** Persisted ordering by preview item key — survives re-execution */
  itemOrder: string[]
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
}

// --- Split Text Node Data ---

export type SplitTextData = {
  [key: string]: unknown
  label: string
  /** Enum preset ("newline" | "double-newline" | "comma" | "space" | "stars" | "custom") or a literal delimiter string for back-compat with older saved workflows. */
  separator: string
  customSeparator?: string
  trimWhitespace: boolean
  removeEmpty: boolean
  splitResults?: string[]
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
}

// --- Extract Field Node Data ---

export type ExtractFieldNodeData = {
  [key: string]: unknown
  label: string
  /** UX mode: dropdown of known scraper fields vs free-text path. */
  mode: "dropdown" | "custom"
  /** Dot-notation path. Empty string = whole-item mode (returns each array element). */
  field: string
  /**
   * How downstream nodes see this node's output:
   *   - "text" (default): single string, joined by newline if multiple matches. Delimiter-split by downstream lists works.
   *   - "list": structured array of items — acts like a list node, supports item:N and fan-out.
   *   - "json": raw JSON value — feeds another extract-field or any JSON consumer.
   */
  outputType?: "text" | "list" | "json"
  /** Newline-joined preview of extracted values. Always set for display. */
  extractedText?: string
  /** Raw extracted JSON, populated when outputType is "json". */
  generatedJson?: unknown
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
}

// --- JSON Process Node Data ---

export type JsonProcessNodeData = {
  [key: string]: unknown
  label: string
  mode: "visual" | "advanced"
  inputPath: string
  filters: Array<{
    id: string
    field: string
    operator: "equals" | "not_equals" | "contains" | "not_contains" | "starts_with" | "ends_with" | "greater_than" | "less_than" | "is_empty" | "is_not_empty" | "matches_regex" | "in_list"
    value: string | string[]
  }>
  projections: string[]
  expression: string
  processedResult?: unknown
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
}

// --- Filter List Node Data ---

export type FilterListOperator =
  | ">"
  | "<"
  | ">="
  | "<="
  | "="
  | "!="
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "regex"
  | "exists"
  | "not_exists"

export type FilterListCondition = {
  id: string
  field: string
  operator: FilterListOperator
  value: string
  valueType: "static" | "variable"
  /** UI mode for the field input. "dropdown" (default) shows detected
   *  upstream fields + "Custom path…"; "custom" shows a free-text input. */
  mode?: "dropdown" | "custom"
}

export type FilterListNodeData = {
  [key: string]: unknown
  label: string
  conditions: FilterListCondition[]
  conditionLogic: "AND" | "OR"
  /** When true, text operators (contains, starts_with, ends_with, =, !=)
   *  compare case-sensitively. Default false for new nodes (set via
   *  NODE_DEFINITIONS). Legacy nodes without this field are treated as
   *  case-sensitive by the evaluator's default. */
  caseSensitive?: boolean
  listResults?: string[]
  __listResults?: string[]
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
}

// --- Deduplicate Node Data ---

export type DeduplicateNodeData = {
  [key: string]: unknown
  label: string
  field: string
  /** UI mode for the field input. "dropdown" (default) shows detected
   *  upstream fields + "Custom path…"; "custom" shows a free-text input. */
  mode?: "dropdown" | "custom"
  listResults?: string[]
  __listResults?: string[]
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
}

// --- Merge Lists Node Data ---

export type MergeListsNodeData = {
  [key: string]: unknown
  label: string
  /** "concat" (default): append all upstream items in edge order.
   *  "zip": element-wise merge with modulo-wrap — useful for injecting a
   *  single object into every item of a longer list. */
  mode?: "concat" | "zip"
  deduplicate: boolean
  listResults?: string[]
  __listResults?: string[]
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
}

// --- Sort List Node Data ---

export type SortListNodeData = {
  [key: string]: unknown
  label: string
  field: string
  /** UI mode for the field input. "dropdown" (default) shows detected
   *  upstream fields + "Custom path…"; "custom" shows a free-text input. */
  mode?: "dropdown" | "custom"
  sortType: "auto" | "text" | "number" | "date"
  direction: "asc" | "desc"
  listResults?: string[]
  __listResults?: string[]
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
}

// --- Sticky Note Node Data ---

export type StickyNoteData = {
  [key: string]: unknown
  label: string
  text: string
  color: string // Background hex color (e.g., "#fef3c7")
  textColor: string // Text hex color (e.g., "#000000")
  width: number
  height: number
  fontSize: "sm" | "base" | "lg" | "xl"
  bold: boolean
  italic: boolean
  alignment: "left" | "center" | "right"
}

// --- Teleporter Node Data ---

export const TELEPORTER_CHANNEL_COLORS = [
  "#f59e0b", // A = amber
  "#10b981", // B = emerald
  "#8b5cf6", // C = violet
  "#ef4444", // D = red
  "#06b6d4", // E = cyan
  "#ec4899", // F = pink
] as const

export type TeleportSendData = {
  [key: string]: unknown
  label: string
  channel: string
  channelColor: string
  result?: string
}

export type TeleportReceiveData = {
  [key: string]: unknown
  label: string
  channel: string
  channelColor: string
  result?: string
}

export const TELEPORTER_PAN_EVENT = "teleporter-pan-to"

export function isTeleportDefaultLabel(label: string, channel: string): boolean {
  return label === channel || label === `Send ${channel}` || label === `Recv ${channel}`
}

// --- Router Node Data ---

/** AND/OR condition bundle used by the router's conditional mode.
 *  When the group matches, every routeId is added to activeRoutes.
 *  Multiple groups union (deduped) — a route is active iff any group
 *  that activates it matches. */
export type RouterConditionGroup = {
  id: string
  conditions: FilterListCondition[]
  conditionLogic: "AND" | "OR"
  routeIds: string[]
}

export type RouterNodeData = {
  [key: string]: unknown
  label: string
  mode: "radio" | "checkbox" | "conditional"
  routes: Array<{ id: string; name: string; active: boolean }>
  /** Only used when mode === "conditional". */
  conditionGroups?: RouterConditionGroup[]
  // Execution result fields
  activeRoutes?: string[]
  routeOutputs?: Record<string, string | undefined>
  executionStatus?: "idle" | "running" | "completed" | "failed"
}

// --- Scene Node Data ---

export interface SceneCharacterEntry {
  readonly assetId: string
  readonly mood: string
  readonly action: string
  readonly positionInFrame?: "left" | "center" | "right" | "foreground" | "background"
}

export interface SceneObjectEntry {
  readonly assetId: string
  readonly description?: string
}

export interface DialogueAudioResult {
  readonly url: string
  readonly jobId: string
  readonly voiceId: string
  readonly createdAt: string
}

export interface SceneDialogueEntry {
  readonly characterId?: string
  readonly characterName: string
  readonly text: string
  readonly emotion?: string
  readonly voiceId?: string
  readonly generatedAudioResults?: readonly DialogueAudioResult[]
  readonly activeAudioIndex?: number
}

export interface AudioAssignment {
  readonly handleId: string
  readonly sourceNodeId?: string
  readonly dialogueIndex?: number
  readonly role?: "dialogue" | "narration" | "background" | "sfx"
}

export interface SceneLocationEntry {
  readonly assetId: string
  readonly name?: string
  readonly isPrimary?: boolean
  readonly timeOfDay?: "dawn" | "morning" | "noon" | "afternoon" | "sunset" | "evening" | "night"
  readonly weather?: "clear" | "cloudy" | "rainy" | "stormy" | "foggy" | "snowy"
  readonly lighting?: "natural" | "artificial" | "dramatic" | "soft" | "harsh" | "backlit"
}

export type SceneNodeDataType = {
  [key: string]: unknown
  label: string
  sceneName: string
  sceneNumber: number
  duration: number
  summary: string
  characters: SceneCharacterEntry[]
  dialogue: SceneDialogueEntry[]
  locations: SceneLocationEntry[]
  timeOfDay: "dawn" | "morning" | "noon" | "afternoon" | "sunset" | "evening" | "night"
  weather: "clear" | "cloudy" | "rainy" | "stormy" | "foggy" | "snowy"
  lighting: "natural" | "artificial" | "dramatic" | "soft" | "harsh" | "backlit"
  objects: SceneObjectEntry[]
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:3" | "21:9" | "4:5"
  shotType: "extreme-wide" | "wide" | "medium-wide" | "medium" | "medium-close" | "close-up" | "extreme-close-up"
  cameraAngle: "eye-level" | "low-angle" | "high-angle" | "birds-eye" | "worms-eye" | "dutch"
  cameraMovement: "static" | "pan" | "tilt" | "dolly" | "tracking" | "crane" | "handheld" | "zoom"
  depthOfField: "deep" | "medium" | "shallow"
  lensType: "wide" | "normal" | "telephoto"
  mood: string[]
  colorPalette: string[]
  visualStyle: "realistic" | "cinematic" | "anime" | "cartoon" | "noir" | "vintage" | "fantasy" | "sci-fi"
  narration: string
  musicMood: string
  soundEffects: string[]
  transitionIn: "cut" | "fade" | "dissolve" | "wipe"
  transitionOut: "cut" | "fade" | "dissolve" | "wipe"
  directorNotes: string
  referenceUrls: string[]
  generatedPrompt: string
  executionStatus: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  generatedResults: GeneratedResult[]
  activeResultIndex: number
  generatedImageUrl: string
  fieldMappings: FieldMappings
  sourceScriptNodeId: string
  sourceSceneIndex: number
  autoSyncWithScript: boolean
  audioAssignments: AudioAssignment[]
  videoProvider: string
  generatedVideoResults: GeneratedResult[]
  activeVideoResultIndex: number
  generatedVideoUrl: string
  videoExecutionStatus: "idle" | "running" | "completed" | "failed"
}

// --- Sub-Workflow Types ---

export interface SubWorkflowPort {
  readonly id: string
  readonly name: string
  readonly mediaType: "text" | "image" | "video" | "audio" | "any"
}

export type SubWorkflowInputData = {
  [key: string]: unknown
  label: string
  routeId: string
  ports: SubWorkflowPort[]
  /** Injected at runtime during sub-workflow execution — maps port ID to upstream output value */
  __injectedPortValues?: Record<string, string>
}

export type SubWorkflowOutputData = {
  [key: string]: unknown
  label: string
  routeId: string
  ports: SubWorkflowPort[]
  visibleOutputPortId: string
}

export interface SubWorkflowRouteSnapshot {
  readonly routeId: string
  readonly inputLabel: string
  readonly inputPorts: ReadonlyArray<SubWorkflowPort>
  readonly outputPorts: ReadonlyArray<SubWorkflowPort>
  readonly visibleOutputPortId: string
}

export type SubWorkflowData = {
  [key: string]: unknown
  label: string
  referencedWorkflowId: string
  referencedWorkflowName: string
  selectedRouteId: string
  routeSnapshot: SubWorkflowRouteSnapshot | null
  fieldMappings: Record<string, FieldMapping>
  executionStatus: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  outputResults?: Record<string, string>
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  subWorkflowProgress?: { currentNode: string; completed: number; total: number }
  viewMode?: string  // Defaults to "default" (Ports view) when undefined.
}

export type ComponentNodeData = {
  [key: string]: unknown
  label: string
  appSlug: string
  appVersionId: string
  pinnedVersion: number
  componentMetadata: ComponentMetadata
  exposedSettings: Record<string, unknown>
  outputResults?: Record<string, string>
  creatorName: string
  creatorId: string
  estimatedCredits: number
  executionStatus: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

// --- Webhook Parameter Type (shared between trigger + output) ---

export type WebhookParam = {
  id: string
  name: string
  type: "text" | "imageUrl" | "videoUrl" | "audioUrl"
}

// --- Trigger Node Data Types ---

export type WebhookTriggerData = {
  [key: string]: unknown
  label: string
  webhookToken?: string
  webhookUrl?: string
  params: WebhookParam[]
}

export type ScheduleTriggerData = {
  [key: string]: unknown
  label: string
  cron?: string
  timezone?: string
  interval?: string
  maxExecutions?: number
}

export type TelegramTriggerData = {
  [key: string]: unknown
  label: string
  connectionId?: string
  chatIdFilter?: string
  messageTypeFilters?: string[]
  triggerId?: string
  isActive?: boolean
  executionStatus?: "idle" | "running" | "completed" | "failed"
}

export interface GenerativePipelineNodeData {
  [key: string]: unknown
  label?: string
  story_prompt?: string
  target_duration_seconds?: number
  format?: PipelineFormat
  output_resolution?: "720p" | "1080p" | "4K"
  mode?: PipelineMode
  // Server-side runtime fields (read-only on the canvas):
  pipeline_id?: string
  status?: "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled"
  current_stage?: string | null
}

// --- Union Types ---

export type SceneNodeData =
  | TextPromptData
  | UploadImageData
  | UploadVideoData
  | UploadAudioData
  | RSSFeedData
  | YouTubeVideoData
  | ReferenceAudioData
  | ToneData
  | StyleGuideData
  | ProviderData
  | SceneCountData
  | DurationData
  | AspectRatioData
  | MotionData
  | CameraMotionData
  | FramingData
  | LensData
  | CameraFormatData
  | LightingData
  | ColorLookData
  | AtmosphereData
  | ActionFxData
  | StyleData
  | SettingData
  | LoopSubjectData
  | PersonData
  | MoodData
  | PhotographerData
  | AestheticData
  | EraData
  | PoseData
  | StylingData
  | MaterialData
  | AnimalData
  | VehicleData
  | WeaponData
  | PhotoGenreData
  | BackdropData
  | HeldPropData
  | TemporalData
  | ExposureSettingsData
  | RenderQualityData
  | CompositionEffectsData
  | PostProcessEffectsData
  | GenerateScriptData
  | GenerateImageData
  | ModifyImageData
  | UpscaleImageData
  | RemoveBackgroundData
  | ImageToVideoData
  | VideoToVideoData
  | TextToVideoData
  | TextToSpeechData
  | QACheckData
  | GenerateMusicData
  | TextToAudioData
  | SunoGenerateData
  | SunoCoverData
  | SunoExtendData
  | SunoLyricsData
  | SunoSeparateData
  | SunoMusicVideoData
  | SunoMashupData
  | SunoReplaceSectionData
  | SunoStyleBoostData
  | SunoAddInstrumentalData
  | SunoAddVocalsData
  | SunoConvertWavData
  | SunoUploadExtendData
  | TranscribeData
  | ImageToTextData
  | AudioIsolationData
  | TextToDialogueData
  | VoiceChangerData
  | DubbingData
  | VoiceRemixData
  | VoiceDesignData
  | ForcedAlignmentData
  | CombineVideosData
  | MergeVideoAudioData
  | AddCaptionsData
  | ResizeVideoData
  | SocialMediaFormatData
  | TrimAudioData
  | SplitMediaData
  | MixAudioData
  | CombineAudioData
  | AdjustVolumeData
  | TrimVideoData
  | ExtractFrameData
  | VideoComposerData
  | AfterEffectsData
  | LottieOverlayData
  | ThreeDTitleData
  | MotionGraphicsData
  | CompositeData
  | RenderVideoData
  | SpeedRampData
  | LoopVideoData
  | FadeVideoData
  | TranscodeVideoData
  | ManualEditData
  | LipSyncData
  | SpeechToVideoData
  | MotionTransferData
  | VideoUpscaleData
  | ExtendVideoData
  | FaceSwapData
  | GenerateMaskData
  | SaveToStorageData
  | WebhookOutputData
  | SceneNodeDataType
  | CharacterNodeData
  | ObjectNodeData
  | LocationNodeData
  | FaceNodeData
  | LLMChatData
  | AIWriterNodeData
  | WebScrapeNodeData
  | ListNodeData
  | LoopNodeData
  | CombineTextNodeData
  | SplitTextData
  | ExtractFieldNodeData
  | JsonProcessNodeData
  | FilterListNodeData
  | DeduplicateNodeData
  | MergeListsNodeData
  | SortListNodeData
  | PreviewNodeData
  | StickyNoteData
  | TeleportSendData
  | TeleportReceiveData
  | RouterNodeData
  | SubWorkflowInputData
  | SubWorkflowOutputData
  | SubWorkflowData
  | ComponentNodeData
  | WebhookTriggerData
  | ScheduleTriggerData
  | TelegramTriggerData
  | SocialPostData
  | MusicGenreData
  | MusicMoodData
  | InstrumentationData
  | VoiceCharacterData
  | VoiceDeliveryData
  | GenerativePipelineNodeData

export type SceneNodeType =
  | "text-prompt"
  | "list"
  | "loop"
  | "upload-image"
  | "upload-video"
  | "upload-audio"
  | "rss-feed"
  | "youtube-video"
  | "web-scrape"
  | "reference-audio"
  | "tone"
  | "style-guide"
  | "provider"
  | "scene-count"
  | "duration"
  | "aspect-ratio"
  | "motion"
  | "camera-motion"
  | "framing"
  | "lens"
  | "camera-format"
  | "lighting"
  | "color-look"
  | "atmosphere"
  | "action-fx"
  | "style"
  | "setting"
  | "loop-subject"
  | "person"
  | "mood"
  | "photographer"
  | "aesthetic"
  | "era"
  | "pose"
  | "styling"
  | "material"
  | "animal"
  | "vehicle"
  | "weapon"
  | "photo-genre"
  | "backdrop"
  | "held-prop"
  | "temporal"
  | "exposure-settings"
  | "render-quality"
  | "composition-effects"
  | "post-process-effects"
  | "generate-script"
  | "generate-image"
  | "modify-image"
  | "upscale-image"
  | "remove-background"
  | "image-to-video"
  | "video-to-video"
  | "text-to-video"
  | "text-to-speech"
  | "qa-check"
  | "generate-music"
  | "text-to-audio"
  | "suno-generate"
  | "suno-cover"
  | "suno-extend"
  | "suno-lyrics"
  | "suno-separate"
  | "suno-music-video"
  | "suno-mashup"
  | "suno-replace-section"
  | "suno-style-boost"
  | "suno-add-instrumental"
  | "suno-add-vocals"
  | "suno-convert-wav"
  | "suno-upload-extend"
  | "transcribe"
  | "image-to-text"
  | "audio-isolation"
  | "text-to-dialogue"
  | "voice-changer"
  | "dubbing"
  | "voice-remix"
  | "voice-design"
  | "forced-alignment"
  | "combine-videos"
  | "merge-video-audio"
  | "add-captions"
  | "resize-video"
  | "social-media-format"
  | "trim-audio"
  | "split-media"
  | "mix-audio"
  | "combine-audio"
  | "adjust-volume"
  | "trim-video"
  | "extract-frame"
  | "video-composer"
  | "after-effects"
  | "lottie-overlay"
  | "3d-title"
  | "motion-graphics"
  | "composite"
  | "render-video"
  | "speed-ramp"
  | "loop-video"
  | "fade-video"
  | "transcode-video"
  | "manual-edit"
  | "lip-sync"
  | "speech-to-video"
  | "motion-transfer"
  | "video-upscale"
  | "extend-video"
  | "face-swap"
  | "generate-mask"
  | "save-to-storage"
  | "webhook-output"
  | "scene"
  | "character"
  | "face"
  | "object"
  | "location"
  | "llm-chat"
  | "ai-writer"
  | "combine-text"
  | "split-text"
  | "extract-field"
  | "json-process"
  | "filter-list"
  | "deduplicate"
  | "merge-lists"
  | "sort-list"
  | "preview"
  | "sticky-note"
  | "teleport-send"
  | "teleport-receive"
  | "router"
  | "sub-workflow-input"
  | "sub-workflow-output"
  | "sub-workflow"
  | "webhook-trigger"
  | "schedule-trigger"
  | "instagram-post"
  | "tiktok-post"
  | "youtube-upload"
  | "linkedin-post"
  | "x-post"
  | "facebook-post"
  | "telegram-post"
  | "telegram-trigger"
  | "component"
  | "music-genre"
  | "music-mood"
  | "instrumentation"
  | "voice-character"
  | "voice-delivery"
  | "generative-pipeline"

export type WorkflowNode = Node<SceneNodeData, SceneNodeType>
export type WorkflowEdge = Edge

export interface NodeTypeDefinition {
  readonly type: SceneNodeType
  readonly label: string
  readonly category: NodeCategory
  readonly creditCost: number
  readonly inputs: ReadonlyArray<string>
  readonly outputs: ReadonlyArray<string>
  readonly defaultData: SceneNodeData
  readonly width?: number
  readonly height?: number
  readonly exposableFields?: ReadonlyArray<ExposableField>
  readonly exposableOutputs?: ReadonlyArray<ExposableOutput>
  /** When true, node auto-executes on config change or upstream completion (zero-cost inline nodes only). */
  readonly autoExecute?: boolean
}

export const NODE_DEFINITIONS: ReadonlyArray<NodeTypeDefinition> = [
  // Input
  {
    type: "text-prompt",
    label: "Text Prompt",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["prompt"],
    defaultData: { label: "Text Prompt", text: "", variables: {} },
  },
  {
    type: "list",
    label: "List",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: [],
    defaultData: { label: "List", columns: [{ id: "default", name: "Items", handleId: "col_default", type: "text" }], rows: [[""]], fieldMappings: {} } as ListNodeData,
  },
  {
    type: "loop",
    label: "Table",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: [],
    defaultData: { label: "Table", columns: [], rows: [], fieldMappings: {} } as LoopNodeData,
  },
  {
    type: "upload-image",
    label: "Upload Image",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["image"],
    defaultData: { label: "Upload Image", assetId: "", url: "" } as unknown as SceneNodeData,
  },
  {
    type: "upload-video",
    label: "Upload Video",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Upload Video", assetId: "", url: "" } as unknown as SceneNodeData,
  },
  {
    type: "upload-audio",
    label: "Upload Audio",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Upload Audio", assetId: "", url: "" } as unknown as SceneNodeData,
  },
  {
    type: "rss-feed",
    label: "RSS Feed",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["content"],
    defaultData: { label: "RSS Feed", feedUrl: "", itemIndex: 0, extractFields: ["title", "description"] },
  },
  {
    type: "youtube-video",
    label: "Video URL",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Video URL", youtubeUrl: "", videoId: "", title: "", thumbnailUrl: "" },
  },
  {
    type: "web-scrape",
    label: "Web Scrape",
    category: "input",
    creditCost: 5,
    inputs: ["in"],
    outputs: ["json"],
    defaultData: { label: "Web Scrape", actor: "google-search", query: "" } as WebScrapeNodeData,
  },
  {
    type: "reference-audio",
    label: "Reference Audio",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Reference Audio", sourceType: "youtube", youtubeUrl: "", uploadedFileUrl: "", directUrl: "", videoTitle: "", videoThumbnail: "", videoDuration: "", extractedAudioUrl: "", extractionStatus: "idle" },
  },
  {
    type: "webhook-trigger",
    label: "Webhook Trigger",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["payload"],
    defaultData: { label: "Webhook Trigger", params: [] } as unknown as SceneNodeData,
  },
  {
    type: "schedule-trigger",
    label: "Schedule Trigger",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["payload"],
    defaultData: { label: "Schedule Trigger" } as unknown as SceneNodeData,
  },
  // Parameter
  {
    type: "tone",
    label: "Tone",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["tone"],
    defaultData: { label: "Tone", tone: "" },
  },
  {
    type: "style-guide",
    label: "Style Guide",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["style_guide"],
    defaultData: { label: "Style Guide", text: "" },
  },
  {
    type: "provider",
    label: "Provider",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["provider"],
    defaultData: { label: "Provider", category: "image", provider: "nano-banana", model: "" },
  },
  {
    type: "scene-count",
    label: "Scene Count",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["scene_count"],
    defaultData: { label: "Scene Count", count: 5 },
  },
  {
    type: "duration",
    label: "Duration",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["duration"],
    defaultData: { label: "Duration", seconds: 60 },
  },
  {
    type: "aspect-ratio",
    label: "Aspect Ratio",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["aspect_ratio"],
    defaultData: { label: "Aspect Ratio", ratio: "16:9" },
  },
  {
    type: "motion",
    label: "Motion",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Motion", motion: "moderate" },
  },
  {
    type: "camera-motion",
    label: "Camera Motion",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Camera Motion", cameraMotion: "static" },
  },
  {
    type: "framing",
    label: "Framing",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Framing", shotSize: "wide-shot" },
  },
  {
    type: "lens",
    label: "Lens",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Lens", lens: "normal-50mm" },
  },
  {
    type: "camera-format",
    label: "Camera / Film Stock",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Camera / Film Stock", cameraFormat: "35mm-film" },
  },
  {
    type: "lighting",
    label: "Lighting",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Lighting", timeOfDay: "noon" },
  },
  {
    type: "color-look",
    label: "Color / Look",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Color / Look", colorLook: "warm" },
  },
  {
    type: "atmosphere",
    label: "Atmosphere",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Atmosphere", atmosphere: "clear" },
  },
  {
    type: "action-fx",
    label: "Action FX",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Action FX", actionFx: undefined },
  },
  {
    type: "style",
    label: "Style",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Style", style: "cinematic" },
  },
  {
    type: "setting",
    label: "Setting",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Setting", setting: "forest" },
  },
  {
    type: "loop-subject",
    label: "Loop Subject",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Loop Subject", loopSubject: "tunnel" },
  },
  {
    type: "music-genre",
    label: "Music Genre",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Music Genre", ...MUSIC_GENRE_DEFAULT_DATA } as MusicGenreData,
  },
  {
    type: "music-mood",
    label: "Music Mood",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Music Mood", ...MUSIC_MOOD_DEFAULT_DATA } as MusicMoodData,
  },
  {
    type: "instrumentation",
    label: "Instrumentation",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Instrumentation", ...INSTRUMENTATION_DEFAULT_DATA } as InstrumentationData,
  },
  {
    type: "voice-character",
    label: "Voice Character",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Voice Character", ...VOICE_CHARACTER_DEFAULT_DATA } as VoiceCharacterData,
  },
  {
    type: "voice-delivery",
    label: "Voice Delivery",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Voice Delivery", ...VOICE_DELIVERY_DEFAULT_DATA } as VoiceDeliveryData,
  },
  {
    type: "person",
    label: "Person",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Person", type: "stylish-influencer", age: "age-early-20s", maxItemsPerRow: 2 },
  },
  {
    type: "mood",
    label: "Mood",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Mood", mood: "calm" },
  },
  {
    type: "photographer",
    label: "Photographer / Artist Style",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Photographer", photographer: "tim-walker" },
  },
  {
    type: "aesthetic",
    label: "Aesthetic / Microtrend",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Aesthetic", aesthetic: "y2k" },
  },
  {
    type: "era",
    label: "Era / Period",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Era", era: "1990s-mall" },
  },
  {
    type: "pose",
    label: "Pose",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Pose", pose: "standing-upright" },
  },
  {
    type: "styling",
    label: "Styling",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Styling", makeup: "makeup-natural", maxItemsPerRow: 2 },
  },
  {
    type: "material",
    label: "Material",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Material", material: "silk" },
  },
  {
    type: "animal",
    label: "Animal",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Animal", animal: "dog-golden-retriever" },
  },
  {
    type: "vehicle",
    label: "Vehicle",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Vehicle", vehicle: "sedan" },
  },
  {
    type: "weapon",
    label: "Weapon",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Weapon", weapon: "katana" },
  },
  {
    type: "photo-genre",
    label: "Photo Genre",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Photo Genre", photoGenre: "fashion-editorial" },
  },
  {
    type: "backdrop",
    label: "Backdrop",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Backdrop", backdrop: "white-seamless" },
  },
  {
    type: "held-prop",
    label: "Held Prop",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Held Prop", heldProp: "smartphone" },
  },
  {
    type: "temporal",
    label: "Temporal",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Temporal", temporalSpeed: "real-time" },
  },
  {
    type: "exposure-settings",
    label: "Exposure Settings",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Exposure Settings", aperture: "aperture-f1-4", maxItemsPerRow: 2 },
  },
  {
    type: "render-quality",
    label: "Render Quality",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Render Quality", renderQuality: "raytracing" },
  },
  {
    type: "composition-effects",
    label: "Composition Effects",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Composition Effects", compositionEffect: "bursting-through-frame" },
  },
  {
    type: "post-process-effects",
    label: "Post-Process Effects",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Post-Process Effects", postProcess: "vignette-soft" },
  },
  // AI
  {
    type: "generate-script",
    label: "Generate Script",
    category: "ai",
    creditCost: 2,
    inputs: ["in"],
    outputs: ["scenes", "images", "dialogue", "music", "sfx", "characters", "locations"],
    defaultData: { label: "Generate Script", provider: "gemini", model: "gemini-2.5-flash", sceneCount: 5, styleGuide: "", structure: "freeform", tone: "", targetLength: 60, fieldMappings: {} },
  },
  {
    type: "generate-image",
    label: "Generate Image",
    category: "ai",
    creditCost: 5,
    inputs: ["in"],
    outputs: ["image"],
    width: 220,
    defaultData: { label: "Generate Image", prompt: "", provider: "nano-banana-pro", model: "gemini-2.5-flash-image", style: "", aspectRatio: "16:9", negativePrompt: "", fieldMappings: {} },
    exposableOutputs: [{ key: "result", label: "Result", outputType: "image" as const }],
    exposableFields: [
      {
        key: "provider", label: "Model", type: "select" as const,
        options: [
          { value: "flux", label: "Flux" },
          { value: "flux-flex", label: "Flux Flex" },
          { value: "flux-kontext", label: "Flux Kontext" },
          { value: "flux-kontext-max", label: "Flux Kontext Max" },
          { value: "gpt-image", label: "GPT Image" },
          { value: "gpt-image-2", label: "GPT Image 2" },
          { value: "grok", label: "Grok" },
          { value: "ideogram-v3", label: "Ideogram V3" },
          { value: "imagen4", label: "Imagen 4" },
          { value: "imagen4-fast", label: "Imagen 4 Fast" },
          { value: "imagen4-ultra", label: "Imagen 4 Ultra" },
          { value: "nano-banana", label: "Nano Banana" },
          { value: "nano-banana-2", label: "Nano Banana 2" },
          { value: "nano-banana-pro", label: "Nano Banana Pro" },
          { value: "qwen", label: "Qwen" },
          { value: "seedream", label: "Seedream" },
          { value: "seedream-5-lite", label: "Seedream 5 Lite" },
          { value: "z-image", label: "Z-Image" },
          { value: "flux-2-klein", label: "Flux 2 Klein (Open)" },
          { value: "flux-2-pro", label: "Flux 2 Pro (Safety Tolerance)" },
          { value: "flux-2-max", label: "Flux 2 Max (Safety Tolerance)" },
        ],
      },
      {
        key: "aspectRatio", label: "Aspect Ratio", type: "aspect-ratio" as const,
        options: [
          { value: "1:1", label: "1:1 (Square)" },
          { value: "16:9", label: "16:9 (Landscape)" },
          { value: "9:16", label: "9:16 (Portrait)" },
          { value: "4:3", label: "4:3" },
          { value: "3:4", label: "3:4" },
          { value: "3:2", label: "3:2" },
          { value: "2:3", label: "2:3" },
          { value: "5:4", label: "5:4" },
          { value: "4:5", label: "4:5" },
          { value: "21:9", label: "21:9 (Ultra-wide)" },
        ],
      },
      {
        key: "quality", label: "Quality", type: "select" as const,
        options: [
          { value: "medium", label: "Medium (Balanced)" },
          { value: "high", label: "High (Detailed)" },
          { value: "basic", label: "Basic (2K)" },
        ],
      },
      { key: "negativePrompt", label: "Negative Prompt", type: "text" as const },
      {
        key: "style", label: "Style", type: "select" as const,
        options: [{ value: "__none__", label: "None" }, ...IMAGE_STYLE_PRESETS.map(s => ({ value: s.value, label: s.label }))],
      },
    ],
  },
  {
    type: "modify-image",
    label: "Modify Image",
    category: "ai",
    creditCost: 2,
    inputs: ["image"],
    outputs: ["out"],
    width: 260,
    defaultData: {
      label: "Modify Image",
      prompt: "",
      provider: "nano-banana" as ModifyImageProvider,
      fieldMappings: {},
    },
    exposableOutputs: [{ key: "out", label: "Modified Image", outputType: "image" as const }],
    exposableFields: [
      { key: "provider", label: "Model", type: "select" as const, options: MODIFY_IMAGE_PROVIDERS.map(p => ({ value: p, label: p })) },
    ],
  },
  {
    type: "upscale-image",
    label: "Upscale Image",
    category: "ai",
    creditCost: 1,
    inputs: ["image"],
    outputs: ["out"],
    width: 220,
    defaultData: {
      label: "Upscale Image",
      provider: "recraft-upscale" as UpscaleImageProvider,
      fieldMappings: {},
    },
    exposableOutputs: [{ key: "out", label: "Upscaled Image", outputType: "image" as const }],
    exposableFields: [
      {
        key: "provider", label: "Model", type: "select" as const, options: [
          { value: "recraft-upscale", label: "Recraft Upscale" },
          { value: "topaz-image-upscale", label: "Topaz Upscale" },
        ],
      },
    ],
  },
  {
    type: "remove-background",
    label: "Remove Background",
    category: "ai",
    creditCost: 1,
    inputs: ["image"],
    outputs: ["out"],
    width: 220,
    defaultData: {
      label: "Remove Background",
      fieldMappings: {},
    },
    exposableOutputs: [{ key: "out", label: "Image (No BG)", outputType: "image" as const }],
  },
  {
    type: "image-to-video",
    label: "Image to Video",
    category: "ai",
    creditCost: 20,
    width: 220,
    inputs: ["startFrame", "endFrame", "audio"],
    outputs: ["video"],
    defaultData: { label: "Image to Video", provider: "seedance-2-fast", duration: 5, fieldMappings: {} },
    exposableOutputs: [{ key: "result", label: "Result", outputType: "video" as const }],
    exposableFields: [
      {
        key: "provider", label: "Model", type: "select" as const,
        options: [
          { value: "bytedance-lite", label: "Bytedance Lite" },
          { value: "bytedance-pro", label: "Bytedance Pro" },
          { value: "bytedance-pro-fast", label: "Bytedance Pro Fast" },
          { value: "grok-i2v", label: "Grok" },
          { value: "hailuo-2.3", label: "Hailuo 2.3" },
          { value: "hailuo-2.3-pro", label: "Hailuo 2.3 Pro" },
          { value: "hailuo-standard", label: "Hailuo Standard" },
          { value: "kling", label: "Kling" },
          { value: "kling-3.0", label: "Kling 3.0" },
          { value: "kling-master", label: "Kling Master" },
          { value: "kling-turbo", label: "Kling Turbo" },
          { value: "minimax", label: "MiniMax" },
          { value: "runway-kie", label: "Runway" },
          { value: "seedance", label: "Seedance" },
          { value: "veo3", label: "VEO 3.1 (Quality)" },
          { value: "veo3.1", label: "VEO 3.1 (Fast)" },
          { value: "wan-i2v", label: "Wan 2.6" },
          { value: "wan-turbo", label: "Wan Turbo" },
        ],
      },
    ],
  },
  {
    type: "video-to-video",
    label: "Video to Video",
    category: "ai",
    creditCost: 25,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Video to Video", prompt: "", duration: 5, fieldMappings: {} },
  },
  {
    type: "text-to-video",
    label: "Text to Video",
    category: "ai",
    creditCost: 25,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Text to Video", prompt: "", provider: "seedance-2-fast", duration: 5, aspectRatio: "16:9", negativePrompt: "", fieldMappings: {} },
    exposableOutputs: [{ key: "result", label: "Result", outputType: "video" as const }],
    exposableFields: [
      {
        key: "provider", label: "Model", type: "select" as const,
        options: [
          { value: "bytedance-lite", label: "Bytedance Lite" },
          { value: "bytedance-pro", label: "Bytedance Pro" },
          { value: "grok", label: "Grok" },
          { value: "kling", label: "Kling" },
          { value: "kling-3.0", label: "Kling 3.0" },
          { value: "kling-turbo", label: "Kling Turbo" },
          { value: "minimax", label: "MiniMax" },
          { value: "hailuo-standard", label: "MiniMax Standard" },
          { value: "runway-kie", label: "Runway" },
          { value: "seedance", label: "Seedance 1.5" },
          { value: "seedance-2", label: "Seedance 2.0" },
          { value: "seedance-2-fast", label: "Seedance 2.0 Fast" },
          { value: "veo3", label: "VEO 3.1 (Quality)" },
          { value: "veo3.1", label: "VEO 3.1 (Fast)" },
          { value: "wan", label: "Wan 2.6" },
          { value: "wan-turbo", label: "Wan Turbo" },
        ],
      },
      {
        key: "aspectRatio", label: "Aspect Ratio", type: "aspect-ratio" as const,
        options: [
          { value: "16:9", label: "16:9 (Landscape)" },
          { value: "9:16", label: "9:16 (Portrait)" },
          { value: "1:1", label: "1:1 (Square)" },
        ],
      },
      { key: "motion", label: "Motion", type: "slider" as const, min: 1, max: 255, step: 1 },
      { key: "generateAudio", label: "Generate Audio", type: "toggle" as const },
    ],
  },
  {
    type: "text-to-speech",
    label: "Text to Speech",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Text to Speech", provider: "elevenlabs-v3", voiceId: "Rachel", voiceType: "premade", voiceDisplayName: "Rachel", language: "en", speed: 1, stability: 0.5, similarityBoost: 0.75, style: 0, languageCode: "", textSource: "connected", directText: "", fieldMappings: {} },
    exposableOutputs: [{ key: "result", label: "Result", outputType: "audio" as const }],
    exposableFields: [
      {
        key: "provider", label: "Model", type: "select" as const,
        options: [
          { value: "elevenlabs-v3", label: "ElevenLabs v3 (recommended)" },
          { value: "elevenlabs-turbo", label: "ElevenLabs Turbo v2.5 (fast)" },
          { value: "elevenlabs-multilingual", label: "ElevenLabs Multilingual v2" },
        ],
      },
      { key: "stability", label: "Stability", type: "slider" as const, min: 0, max: 1, step: 0.05 },
      { key: "similarity", label: "Similarity", type: "slider" as const, min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    type: "qa-check",
    label: "QA Check",
    category: "ai",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["approved", "rejected"],
    defaultData: { label: "QA Check", provider: "claude", checkType: "quality", threshold: 0.8, fieldMappings: {} },
  },
  {
    type: "generate-music",
    label: "Generate Music",
    category: "ai",
    creditCost: 5,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Generate Music", prompt: "", provider: "suno", duration: 8, genre: "", mood: "", instrumental: true, lyrics: "", referenceAudioUrl: "", referenceYouTubeUrl: "", referenceSource: "none", modelVersion: "stereo-large", fieldMappings: {} },
    exposableOutputs: [{ key: "result", label: "Result", outputType: "audio" as const }],
    exposableFields: [
      { key: "duration", label: "Duration (s)", type: "slider" as const, min: 1, max: 60, step: 1 },
      { key: "instrumental", label: "Instrumental", type: "toggle" as const },
    ],
  },
  {
    type: "text-to-audio",
    label: "Text to Audio",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Text to Audio", prompt: "", provider: "elevenlabs-sfx", duration: 10, fieldMappings: {} },
    exposableOutputs: [{ key: "result", label: "Result", outputType: "audio" as const }],
    exposableFields: [
      { key: "duration", label: "Duration (s)", type: "slider" as const, min: 1, max: 22, step: 0.5 },
    ],
  },
  {
    type: "suno-generate",
    label: "Suno Generate",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Suno Generate", prompt: "", model: "V5_5", lyrics: "", style: "", title: "", negativeStyle: "", fieldMappings: {} } as SunoGenerateData,
  },
  {
    type: "suno-cover",
    label: "Suno Cover",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Suno Cover", prompt: "", model: "V5_5", uploadUrl: "", lyrics: "", style: "", title: "", negativeStyle: "", fieldMappings: {} } as SunoCoverData,
  },
  {
    type: "suno-extend",
    label: "Suno Extend",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Suno Extend", audioId: "", defaultParamFlag: true, prompt: "", model: "V5_5", style: "", title: "", continueAt: 0, negativeStyle: "", fieldMappings: {} } as SunoExtendData,
  },
  {
    type: "suno-lyrics",
    label: "Suno Lyrics",
    category: "ai",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["text"],
    defaultData: { label: "Suno Lyrics", prompt: "", fieldMappings: {} } as SunoLyricsData,
  },
  {
    type: "suno-separate",
    label: "Suno Separate",
    category: "ai",
    creditCost: 2,
    inputs: ["audio"],
    outputs: ["audio"],
    defaultData: { label: "Suno Separate", type: "separate_vocal", taskId: "", audioId: "", fieldMappings: {} } as SunoSeparateData,
  },
  {
    type: "suno-music-video",
    label: "Music Video",
    category: "ai",
    creditCost: 1,
    inputs: ["audio"],
    outputs: ["video"],
    defaultData: { label: "Music Video", taskId: "", audioId: "", fieldMappings: {} } as SunoMusicVideoData,
  },
  {
    type: "suno-mashup",
    label: "Suno Mashup",
    category: "ai",
    creditCost: 4,
    inputs: ["audio1", "audio2"],
    outputs: ["audio"],
    defaultData: { label: "Suno Mashup", model: "V5_5", customMode: false, style: "", title: "", negativeStyle: "", vocalGender: "", fieldMappings: {} } as SunoMashupData,
  },
  {
    type: "suno-replace-section",
    label: "Suno Replace Section",
    category: "ai",
    creditCost: 2,
    inputs: ["audio"],
    outputs: ["audio"],
    defaultData: { label: "Suno Replace Section", infillStartS: 0, infillEndS: 30, prompt: "", tags: "", title: "", fieldMappings: {} } as SunoReplaceSectionData,
  },
  {
    type: "suno-style-boost",
    label: "Suno Style Boost",
    category: "ai",
    creditCost: 1,
    inputs: ["text"],
    outputs: ["text"],
    defaultData: { label: "Suno Style Boost", content: "", fieldMappings: {} } as SunoStyleBoostData,
  },
  {
    type: "suno-add-instrumental",
    label: "Suno Add Instrumental",
    category: "ai",
    creditCost: 4,
    inputs: ["audio"],
    outputs: ["audio"],
    defaultData: { label: "Suno Add Instrumental", model: "V5_5", fieldMappings: {} } as SunoAddInstrumentalData,
  },
  {
    type: "suno-add-vocals",
    label: "Suno Add Vocals",
    category: "ai",
    creditCost: 4,
    inputs: ["audio"],
    outputs: ["audio"],
    defaultData: { label: "Suno Add Vocals", model: "V5_5", fieldMappings: {} } as SunoAddVocalsData,
  },
  {
    type: "suno-convert-wav",
    label: "Suno Convert WAV",
    category: "ai",
    creditCost: 1,
    inputs: ["audio"],
    outputs: ["audio"],
    defaultData: { label: "Suno Convert WAV", fieldMappings: {} } as SunoConvertWavData,
  },
  {
    type: "suno-upload-extend",
    label: "Suno Upload Extend",
    category: "ai",
    creditCost: 4,
    inputs: ["audio"],
    outputs: ["audio"],
    defaultData: { label: "Suno Upload Extend", prompt: "", model: "V5_5", style: "", title: "", negativeStyle: "", vocalGender: "", continueAt: 0, defaultParamFlag: true, fieldMappings: {} } as SunoUploadExtendData,
  },
  {
    type: "transcribe",
    label: "Transcribe",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["text"],
    defaultData: { label: "Transcribe", provider: "elevenlabs-stt", language: "auto", fieldMappings: {} },
  },
  {
    type: "image-to-text",
    label: "Describe Image",
    category: "ai",
    creditCost: 1,
    inputs: ["image"],
    outputs: ["text"],
    defaultData: { label: "Describe Image", detailLevel: "detailed", customPrompt: "", fieldMappings: {} } as ImageToTextData,
  },
  {
    type: "audio-isolation",
    label: "Voice Extractor",
    category: "ai",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: {
      label: "Voice Extractor",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as AudioIsolationData,
  },
  {
    type: "text-to-dialogue",
    label: "Text to Dialogue",
    category: "ai",
    creditCost: 4,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: {
      label: "Text to Dialogue",
      dialogue: [{ id: "1", text: "", voice: "Sarah" }],
      stability: 0.5,
      languageCode: "",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as TextToDialogueData,
  },
  {
    type: "voice-changer",
    label: "Voice Changer",
    category: "ai",
    creditCost: 4,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: {
      label: "Voice Changer",
      voiceId: "",
      voiceLabel: "",
      voiceType: "premade",
      stability: 0.5,
      similarityBoost: 0.75,
      removeBackgroundNoise: false,
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as VoiceChangerData,
  },
  {
    type: "dubbing",
    label: "Dubbing",
    category: "ai",
    creditCost: 8,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: {
      label: "Dubbing",
      targetLanguage: "es",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as DubbingData,
  },
  {
    type: "voice-remix",
    label: "Voice Remix",
    category: "ai",
    creditCost: 4,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: {
      label: "Voice Remix",
      text: "",
      voiceDescription: "",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as VoiceRemixData,
  },
  {
    type: "voice-design",
    label: "Voice Design",
    category: "ai",
    creditCost: 5,
    inputs: ["in"],
    outputs: ["audio", "voiceId"],
    defaultData: {
      label: "Voice Design",
      text: "",
      voiceDescription: "",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as VoiceDesignData,
    exposableOutputs: [
      { key: "audio", label: "Audio", outputType: "audio" as const },
      { key: "voiceId", label: "Voice ID", outputType: "data" as const },
    ],
    exposableFields: [
      {
        key: "model", label: "Model", type: "select" as const,
        options: [
          { value: "eleven_ttv_v3", label: "ElevenLabs v3 (recommended)" },
          { value: "eleven_multilingual_ttv_v2", label: "ElevenLabs Multilingual v2" },
        ],
      },
      { key: "loudness", label: "Loudness", type: "slider" as const, min: -1, max: 1, step: 0.1 },
    ],
  },
  {
    type: "forced-alignment",
    label: "Forced Alignment",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["data"],
    defaultData: {
      label: "Forced Alignment",
      transcript: "",
      fieldMappings: {},
      executionStatus: "idle",
      alignmentResults: [],
    } as ForcedAlignmentData,
  },
  // Processing
  {
    type: "combine-videos",
    label: "Combine Videos",
    category: "processing",
    creditCost: 2,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Combine Videos", transition: "cut", transitionDuration: 0.5, audioMode: "crossfade", fieldMappings: {} },
  },
  {
    type: "merge-video-audio",
    label: "Merge Video & Audio",
    category: "processing",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Merge Video & Audio", audioType: "voiceover", voiceoverVolume: 100, backgroundVolume: 30, keepOriginalAudio: true, originalAudioVolume: 30, originalAudioRole: "background", trackSettings: {}, fieldMappings: {} },
  },
  {
    type: "add-captions",
    label: "Add Captions",
    category: "processing",
    creditCost: 2,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Add Captions", style: "subtitle", position: "bottom", fontSize: 24, color: "#ffffff", fieldMappings: {} },
  },
  {
    type: "resize-video",
    label: "Resize Video",
    category: "processing",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Resize Video", targetAspect: "9:16", method: "crop", padColor: "#000000", fieldMappings: {} },
  },
  {
    type: "social-media-format",
    label: "Social Media Format",
    category: "processing",
    creditCost: 0,
    inputs: ["media", "text"],
    outputs: ["media", "text"],
    defaultData: {
      label: "Social Media Format",
      platform: "instagram",
      contentType: "feed-square",
      specKey: "instagram:feed-square",
      method: "pad",
      padColor: "#000000",
      formattedText: "",
      fieldMappings: {},
    } as SocialMediaFormatData,
  },
  {
    type: "trim-audio",
    label: "Trim Audio",
    category: "processing",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Trim Audio", audioFormat: "mp3", fieldMappings: {} },
  },
  {
    type: "split-media",
    label: "Split Media",
    category: "processing",
    creditCost: 2,
    inputs: ["video-in", "audio-in"],
    outputs: ["video-out", "audio-out"],
    defaultData: { label: "Split Media", chunkDuration: 10, audioFormat: "mp3", fieldMappings: {} },
  },
  {
    type: "mix-audio",
    label: "Mix Audio",
    category: "processing",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Mix Audio", trackCount: 2, trackVolumes: {}, fieldMappings: {} },
  },
  {
    type: "combine-audio",
    label: "Combine Audio",
    category: "processing",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Combine Audio", segmentOrder: [], segmentSettings: {}, fieldMappings: {} },
  },
  {
    type: "adjust-volume",
    label: "Adjust Volume",
    category: "processing",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Adjust Volume", volume: 100, normalize: false, fadeIn: 0, fadeOut: 0, fieldMappings: {} },
  },
  {
    type: "trim-video",
    label: "Trim Video",
    category: "processing",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Trim Video", startTime: 0, endTime: 0, fieldMappings: {} },
  },
  {
    type: "extract-frame",
    label: "Extract Frame",
    category: "processing",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["image"],
    defaultData: {
      label: "Extract Frame",
      mode: "first",
      timestamp: 0,
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as ExtractFrameData,
  },
  {
    type: "video-composer",
    label: "Compose Video",
    category: "processing",
    creditCost: 2,
    inputs: ["in"],
    outputs: ["composition"],
    defaultData: {
      label: "Compose Video",
      compositionPrompt: "",
      fps: 30,
      aspectRatio: "16:9",
      durationSeconds: 30,
      backgroundColor: "#000000",
      fieldMappings: {},
      executionStatus: "idle",
    } as VideoComposerData,
  },
  {
    type: "after-effects",
    label: "After Effects",
    category: "processing",
    creditCost: 2,
    inputs: ["in"],
    outputs: ["composition"],
    defaultData: {
      label: "After Effects",
      effectPrompt: "",
      fps: 30,
      durationSeconds: 10,
      fieldMappings: {},
      executionStatus: "idle",
    } as AfterEffectsData,
  },
  {
    type: "lottie-overlay",
    label: "Lottie Overlay",
    category: "processing",
    creditCost: 2,
    inputs: ["in", "lottie"],
    outputs: ["composition"],
    defaultData: {
      label: "Lottie Overlay",
      overlayPrompt: "",
      fps: 30,
      durationSeconds: 10,
      fieldMappings: {},
      executionStatus: "idle",
    } as LottieOverlayData,
  },
  {
    type: "3d-title",
    label: "3D Title",
    category: "ai",
    creditCost: 3,
    inputs: ["background"],
    outputs: ["composition"],
    defaultData: {
      label: "3D Title",
      titlePrompt: "",
      aspectRatio: "16:9",
      backgroundColor: "#000000",
      fps: 30,
      durationSeconds: 10,
      fieldMappings: {},
      executionStatus: "idle",
    } as ThreeDTitleData,
  },
  {
    type: "motion-graphics",
    label: "Motion Graphics",
    category: "ai",
    creditCost: 2,
    inputs: ["in"],
    outputs: ["composition"],
    defaultData: {
      label: "Motion Graphics",
      motionPrompt: "",
      aspectRatio: "16:9",
      backgroundColor: "#00000000",
      fps: 30,
      durationSeconds: 5,
      fieldMappings: {},
      executionStatus: "idle",
    } as MotionGraphicsData,
  },
  {
    type: "composite",
    label: "Composite",
    category: "processing",
    creditCost: 0,
    inputs: ["video1", "video2", "video3", "video4"],
    outputs: ["composition"],
    defaultData: {
      label: "Composite",
      layers: [],
      fps: 30,
      aspectRatio: "16:9",
      durationSeconds: 10,
      backgroundColor: "#000000",
      executionStatus: "idle",
    } as CompositeData,
  },
  {
    type: "render-video",
    label: "Render Video",
    category: "processing",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: {
      label: "Render Video",
      fps: 30,
      aspectRatio: "16:9",
      durationSeconds: 30,
      backgroundColor: "#000000",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as RenderVideoData,
  },
  {
    type: "speed-ramp",
    label: "Adjust Speed",
    category: "processing",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Adjust Speed", speed: 1.0, adjustAudio: true, fieldMappings: {} },
  },
  {
    type: "loop-video",
    label: "Loop Video",
    category: "processing",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Loop Video", mode: "repeat", repeatCount: 2, targetDuration: 10, fieldMappings: {} },
  },
  {
    type: "fade-video",
    label: "Fade In/Out",
    category: "processing",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Fade In/Out", fadeIn: true, fadeInDuration: 0.5, fadeOut: true, fadeOutDuration: 0.5, color: "black", fieldMappings: {} },
  },
  {
    type: "transcode-video",
    label: "Transcode Video",
    category: "processing",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Transcode Video", codec: "h264", crf: 23, resolution: "original", audioBitrate: "128k", fieldMappings: {} },
  },
  {
    type: "manual-edit",
    label: "Manual Edit",
    category: "processing",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Manual Edit", fieldMappings: {} },
  },
  // Lip Sync / AI Avatar
  {
    type: "lip-sync",
    label: "Lip Sync",
    category: "ai",
    creditCost: 40,
    inputs: ["image", "audio"],
    outputs: ["video"],
    defaultData: {
      label: "Lip Sync",
      provider: "kling-avatar",
      resolution: "720p",
      prompt: "",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as LipSyncData,
    exposableOutputs: [{ key: "result", label: "Result", outputType: "video" as const }],
    exposableFields: [
      {
        key: "provider", label: "Model", type: "select" as const,
        options: [
          { value: "kling-avatar", label: "Kling Avatar" },
          { value: "kling-avatar-pro", label: "Kling Avatar Pro" },
          { value: "infinitalk", label: "InfiniTalk" },
        ],
      },
      {
        key: "resolution", label: "Resolution", type: "select" as const,
        options: [
          { value: "720p", label: "720p" },
          { value: "1080p", label: "1080p" },
        ],
      },
    ],
  },
  // Speech-to-Video (Wan 2.2 S2V)
  {
    type: "speech-to-video",
    label: "Speech to Video",
    category: "ai",
    creditCost: 4,
    inputs: ["image", "audio", "prompt"],
    outputs: ["video"],
    defaultData: {
      label: "Speech to Video",
      prompt: "A person speaking naturally",
      resolution: "480p",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as SpeechToVideoData,
  },
  // Motion Transfer (Kling 2.6 Motion Control)
  {
    type: "motion-transfer",
    label: "Motion Transfer",
    category: "ai",
    creditCost: 30,
    inputs: ["image", "video"],
    outputs: ["out"],
    defaultData: {
      label: "Motion Transfer",
      prompt: "",
      characterOrientation: "video",
      resolution: "720p",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as MotionTransferData,
  },
  // Upscale Video (Topaz)
  {
    type: "video-upscale",
    label: "Upscale Video",
    category: "processing",
    creditCost: 15,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: {
      label: "Upscale Video",
      provider: "topaz",
      upscaleFactor: "2",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as VideoUpscaleData,
  },
  {
    type: "extend-video",
    label: "Extend Video",
    category: "ai",
    creditCost: 40,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: {
      label: "Extend Video",
      provider: "veo-extend",
      prompt: "",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as ExtendVideoData,
    exposableOutputs: [{ key: "result", label: "Result", outputType: "video" as const }],
    exposableFields: [
      {
        key: "provider", label: "Model", type: "select" as const,
        options: [
          { value: "veo-extend", label: "VEO Extend" },
          { value: "runway-extend", label: "Runway Extend" },
        ],
      },
    ],
  },
  {
    type: "face-swap",
    label: "Face Swap",
    category: "ai",
    creditCost: 16,
    inputs: ["face", "in"],
    outputs: ["out"],
    defaultData: {
      label: "Face Swap",
      provider: "roop",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as FaceSwapData,
    exposableOutputs: [{ key: "result", label: "Result", outputType: "video" as const }],
  },
  {
    type: "generate-mask",
    label: "Generate Mask",
    category: "ai",
    creditCost: 2,
    inputs: ["image"],
    outputs: ["image", "mask"],
    width: 220,
    defaultData: {
      label: "Generate Mask",
      prompt: "",
      threshold: 0.3,
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as GenerateMaskData,
    exposableOutputs: [
      { key: "image", label: "Image", outputType: "image" as const },
      { key: "mask", label: "Mask", outputType: "image" as const },
    ],
  },
  // Output
  {
    type: "save-to-storage",
    label: "Save to Storage",
    category: "output",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["asset"],
    defaultData: { label: "Save to Storage", filename: "", format: "mp4", quality: "standard", fieldMappings: {} },
  },
  {
    type: "webhook-output",
    label: "Webhook Output",
    category: "output",
    creditCost: 0,
    inputs: ["in"],
    outputs: [],
    defaultData: { label: "Webhook Output", url: "", params: [] },
  },
  // Character
  {
    type: "character",
    label: "Character",
    category: "character",
    creditCost: 5,
    inputs: ["in"],
    outputs: ["characterRef"],
    // PR #2410 removed the `maxWidth: '220px'` wrapper so the node could be
    // resized horizontally via BaseNode's NodeResizeControl. Without an
    // initial `width`, newly-created character nodes render at React Flow's
    // default (which can be very wide). Set the canonical 220px so the node
    // matches its pre-#2410 visual size on creation but stays freely resizable.
    width: 220,
    defaultData: {
      label: "Character",
      characterDbId: "",
      characterName: "",
      description: "",
      sourceImageUrl: "",
      gender: "other",
      style: "realistic",
      baseOutfit: "",
      characterSheet: null,
      projectId: "",
      createdAt: "",
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
      fieldMappings: {},
      expressionSheet: "",
      poseSheet: "",
      lightingSheet: "",
      anglesSheet: "",
      expressions: [],
      poses: [],
      lightingVariations: [],
      angles: [],
      bodyAngles: [],
      expressionStatus: "idle",
      poseStatus: "idle",
      lightingStatus: "idle",
      anglesStatus: "idle",
      bodyAnglesStatus: "idle",
      customVariations: [],
      motions: [],
      motionStatus: "idle",
      voice: null,
      personality: null,
    } as CharacterNodeData,
  },
  // Face
  {
    type: "face",
    label: "Face",
    category: "face",
    creditCost: 5,
    inputs: ["in"],
    outputs: ["faceRef"],
    defaultData: {
      label: "Face",
      faceDbId: "",
      faceName: "",
      description: "",
      sourceImageUrl: "",
      style: "realistic",
      projectId: "",
      createdAt: "",
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
      fieldMappings: {},
    } as FaceNodeData,
  },
  // Object
  {
    type: "object",
    label: "Object",
    category: "object",
    creditCost: 5,
    inputs: ["in"],
    outputs: ["objectRef"],
    defaultData: {
      label: "Object",
      objectDbId: "",
      objectName: "",
      description: "",
      category: "other",
      style: "realistic",
      sourceImageUrl: "",
      projectId: "",
      createdAt: "",
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
      fieldMappings: {},
      angles: [],
      materials: [],
      variations: [],
      anglesStatus: "idle",
      materialsStatus: "idle",
      variationsStatus: "idle",
      customVariations: [],
    } as ObjectNodeData,
  },
  // Location
  {
    type: "location",
    label: "Location",
    category: "location",
    creditCost: 5,
    inputs: ["in"],
    outputs: ["locationRef"],
    defaultData: {
      label: "Location",
      locationDbId: "",
      locationName: "",
      description: "",
      category: "other",
      style: "realistic",
      sourceImageUrl: "",
      projectId: "",
      createdAt: "",
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
      fieldMappings: {},
      timeOfDay: [],
      weather: [],
      angles: [],
      timeOfDayStatus: "idle",
      weatherStatus: "idle",
      anglesStatus: "idle",
      customVariations: [],
    } as LocationNodeData,
  },
  // Scene
  {
    type: "scene",
    label: "Scene",
    category: "scene",
    creditCost: 0,
    inputs: ["in", "audio1", "audio2", "audio3", "audio4", "audio5"],
    outputs: ["prompt", "imageRefs", "narration", "dialogue", "duration"],
    defaultData: {
      label: "Scene",
      sceneName: "",
      sceneNumber: 1,
      duration: 5,
      summary: "",
      characters: [],
      dialogue: [],
      locations: [],
      timeOfDay: "noon",
      weather: "clear",
      lighting: "natural",
      objects: [],
      aspectRatio: "16:9",
      shotType: "medium",
      cameraAngle: "eye-level",
      cameraMovement: "static",
      depthOfField: "medium",
      lensType: "normal",
      mood: [],
      colorPalette: [],
      visualStyle: "cinematic",
      narration: "",
      musicMood: "",
      soundEffects: [],
      transitionIn: "cut",
      transitionOut: "cut",
      directorNotes: "",
      referenceUrls: [],
      generatedPrompt: "",
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
      generatedImageUrl: "",
      fieldMappings: {},
      sourceScriptNodeId: "",
      sourceSceneIndex: -1,
      autoSyncWithScript: false,
      audioAssignments: [],
      videoProvider: "minimax",
      generatedVideoResults: [],
      activeVideoResultIndex: 0,
      generatedVideoUrl: "",
      videoExecutionStatus: "idle",
    } as SceneNodeDataType,
  },
  // LLM Chat
  {
    type: "llm-chat",
    label: "LLM Chat",
    category: "ai",
    creditCost: 3,
    inputs: ["prompt", "references", "system-prompt"],
    outputs: ["text"],
    defaultData: {
      label: "LLM Chat",
      systemPrompt: "",
      userInput: "",
      temperature: 0.7,
      maxTokens: 2048,
      fieldMappings: {},
    } as LLMChatData,
    exposableOutputs: [{ key: "result", label: "Result", outputType: "text" as const }],
    exposableFields: [
      { key: "systemPrompt", label: "System Prompt", type: "text" as const },
      { key: "userInput", label: "User Prompt", type: "text" as const },
      { key: "temperature", label: "Temperature", type: "slider" as const, min: 0, max: 2, step: 0.1 },
      { key: "maxTokens", label: "Max Tokens", type: "slider" as const, min: 256, max: 16384, step: 256 },
    ],
  },
  // AI Agent
  {
    type: "ai-writer",
    label: "AI Agent",
    category: "ai",
    creditCost: 2,
    inputs: ["in"],
    outputs: ["text"],
    defaultData: {
      label: "AI Agent",
      templateId: "custom",
      systemPrompt: "",
      userInput: "",
      temperature: 0.7,
      maxTokens: 4096,
      fieldMappings: {},
    } as AIWriterNodeData,
    exposableOutputs: [{ key: "result", label: "Result", outputType: "text" as const }],
    exposableFields: [
      { key: "temperature", label: "Temperature", type: "slider" as const, min: 0, max: 1, step: 0.1 },
      { key: "maxTokens", label: "Max Tokens", type: "slider" as const, min: 256, max: 16384, step: 256 },
    ],
  },
  // Utility
  {
    type: "combine-text",
    label: "Combine Text",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["text"],
    autoExecute: true,
    defaultData: {
      label: "Combine Text",
      separator: "newline",
      customSeparator: "",
      combinedText: "",
    } as CombineTextNodeData,
  },
  {
    type: "split-text",
    label: "Split Text",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    autoExecute: true,
    defaultData: {
      label: "Split Text",
      separator: "newline",
      customSeparator: "",
      trimWhitespace: true,
      removeEmpty: true,
    } as SplitTextData,
  },
  {
    type: "extract-field",
    label: "Extract Field",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["text"],
    autoExecute: true,
    defaultData: {
      label: "Extract Field",
      mode: "dropdown",
      field: "",
    } as ExtractFieldNodeData,
  },
  {
    type: "json-process",
    label: "JSON Process",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    autoExecute: true,
    defaultData: {
      label: "JSON Process",
      mode: "visual",
      inputPath: "",
      filters: [],
      projections: [],
      expression: "",
    } as JsonProcessNodeData,
  },
  {
    type: "filter-list",
    label: "Filter List",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    autoExecute: true,
    defaultData: {
      label: "Filter List",
      conditions: [],
      conditionLogic: "AND",
      caseSensitive: false,
    } as FilterListNodeData,
  },
  {
    type: "deduplicate",
    label: "Remove Duplicates",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    autoExecute: true,
    defaultData: {
      label: "Remove Duplicates",
      field: "",
      mode: "dropdown",
    } as DeduplicateNodeData,
  },
  {
    type: "merge-lists",
    label: "Merge Lists",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    autoExecute: true,
    defaultData: {
      label: "Merge Lists",
      mode: "concat",
      deduplicate: false,
    } as MergeListsNodeData,
  },
  {
    type: "sort-list",
    label: "Sort List",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    autoExecute: true,
    defaultData: {
      label: "Sort List",
      field: "",
      mode: "dropdown",
      sortType: "auto",
      direction: "asc",
    } as SortListNodeData,
  },
  {
    type: "preview",
    label: "Preview",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: {
      label: "Preview",
      previewItems: [],
      itemOrder: [],
    } as PreviewNodeData,
  },
  {
    type: "router",
    label: "Router",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["route_a", "route_b"],
    autoExecute: true,
    defaultData: {
      label: "Router",
      mode: "radio" as const,
      routes: [
        { id: "default_a", name: "Route A", active: true },
        { id: "default_b", name: "Route B", active: false },
      ],
    } as RouterNodeData,
  },
  {
    type: "sticky-note",
    label: "Sticky Note",
    category: "utility",
    creditCost: 0,
    inputs: [],
    outputs: [],
    defaultData: {
      label: "Sticky Note",
      text: "I'm a note\nDouble click to customize",
      color: "#2d2d44", // Dark background
      textColor: "#ffffff", // White text
      width: 840,
      height: 540,
      fontSize: "base",
      bold: false,
      italic: false,
      alignment: "left",
    } as StickyNoteData,
  },
  {
    type: "teleport-send",
    label: "Teleport Send",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: {
      label: "A",
      channel: "A",
      channelColor: "#f59e0b",
    } as TeleportSendData,
  },
  {
    type: "teleport-receive",
    label: "Teleport Receive",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: {
      label: "A",
      channel: "A",
      channelColor: "#f59e0b",
    } as TeleportReceiveData,
  },
  // Sub-Workflow
  {
    type: "sub-workflow-input",
    label: "Sub-Workflow Input",
    category: "utility",
    creditCost: 0,
    inputs: [],
    outputs: ["out"],
    defaultData: {
      label: "Sub-Workflow Input",
      routeId: "",
      ports: [{ id: "", name: "Input", mediaType: "any" }],
    } as SubWorkflowInputData,
  },
  {
    type: "sub-workflow-output",
    label: "Sub-Workflow Output",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: [],
    defaultData: {
      label: "Sub-Workflow Output",
      routeId: "",
      ports: [{ id: "", name: "Output", mediaType: "any" }],
      visibleOutputPortId: "",
    } as SubWorkflowOutputData,
  },
  {
    type: "sub-workflow",
    label: "Sub-Workflow",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: {
      label: "Sub-Workflow",
      referencedWorkflowId: "",
      referencedWorkflowName: "",
      selectedRouteId: "",
      routeSnapshot: null,
      fieldMappings: {},
      executionStatus: "idle",
    } as SubWorkflowData,
  },
  // Social Media
  {
    type: "instagram-post",
    label: "Instagram Post",
    category: "output",
    creditCost: 1,
    inputs: ["in"],
    outputs: [],
    defaultData: {
      label: "Instagram Post",
      platform: "instagram",
      action: "post-image",
      caption: "",
      fieldMappings: {},
    } as SocialPostData,
  },
  {
    type: "tiktok-post",
    label: "TikTok Post",
    category: "output",
    creditCost: 1,
    inputs: ["in"],
    outputs: [],
    defaultData: {
      label: "TikTok Post",
      platform: "tiktok",
      action: "post-video",
      caption: "",
      fieldMappings: {},
    } as SocialPostData,
  },
  {
    type: "youtube-upload",
    label: "YouTube Upload",
    category: "output",
    creditCost: 1,
    inputs: ["in"],
    outputs: [],
    defaultData: {
      label: "YouTube Upload",
      platform: "youtube",
      action: "upload-video",
      caption: "",
      title: "",
      description: "",
      tags: [],
      privacy: "private",
      fieldMappings: {},
    } as SocialPostData,
  },
  {
    type: "linkedin-post",
    label: "LinkedIn Post",
    category: "output",
    creditCost: 1,
    inputs: ["in"],
    outputs: [],
    defaultData: {
      label: "LinkedIn Post",
      platform: "linkedin",
      action: "post-image",
      caption: "",
      fieldMappings: {},
    } as SocialPostData,
  },
  {
    type: "x-post",
    label: "X Post",
    category: "output",
    creditCost: 1,
    inputs: ["in"],
    outputs: [],
    defaultData: {
      label: "X Post",
      platform: "x",
      action: "post-tweet",
      caption: "",
      fieldMappings: {},
    } as SocialPostData,
  },
  {
    type: "facebook-post",
    label: "Facebook Post",
    category: "output",
    creditCost: 1,
    inputs: ["in"],
    outputs: [],
    defaultData: {
      label: "Facebook Post",
      platform: "facebook",
      action: "post-image",
      caption: "",
      fieldMappings: {},
    } as SocialPostData,
  },
  {
    type: "telegram-post",
    label: "Telegram Post",
    category: "output",
    creditCost: 1,
    inputs: ["in"],
    outputs: [],
    defaultData: {
      label: "Telegram Post",
      platform: "telegram",
      action: "send-message",
      caption: "",
      fieldMappings: {},
    } as SocialPostData,
  },
  {
    type: "telegram-trigger",
    label: "Telegram Trigger",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["text", "imageUrl", "videoUrl", "audioUrl", "chatId", "messageId"],
    defaultData: {
      label: "Telegram Trigger",
      messageTypeFilters: ["text", "photo", "video", "audio", "document"],
    } as TelegramTriggerData,
  },
  // Components
  {
    type: "component",
    label: "Component",
    category: "utility" as const,
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: {
      label: "Component",
      appSlug: "",
      appVersionId: "",
      pinnedVersion: 0,
      componentMetadata: { inputs: [], outputs: [], exposedSettings: [] },
      exposedSettings: {},
      creatorName: "",
      creatorId: "",
      estimatedCredits: 0,
      executionStatus: "idle",
    } as ComponentNodeData,
  },
  // Generative Pipeline (Story → Video)
  {
    type: "generative-pipeline",
    label: "Story → Video",
    category: "scene",
    creditCost: 30,
    inputs: ["story_prompt"],
    outputs: ["final_video"],
    defaultData: {
      label: "Story → Video",
      target_duration_seconds: 60,
      format: "short_film",
      output_resolution: "1080p",
      mode: "manual",
    } as GenerativePipelineNodeData,
  },
]

export const NODE_DEF_MAP: ReadonlyMap<string, NodeTypeDefinition> = new Map(NODE_DEFINITIONS.map((d) => [d.type, d]))
