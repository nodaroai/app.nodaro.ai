"use client"

import { useMemo, useState, useCallback, useEffect, Suspense, memo } from "react"
import { lazyWithRetry } from "@/lib/lazy-with-retry"
import { ImageIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CachedImage } from "@/components/ui/cached-image"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { getCachedCredits, prefetchModelCredits } from "@/ee/hooks/use-model-credits"
import { Button } from "@/components/ui/button"
import { X, Plus, Wand2 } from "lucide-react"
import { toast } from "sonner"
import type {
  ImageToVideoData,
  VideoToVideoData,
  TextToVideoData,
  GenerateVideoNodeData,
  GenerateVideoProNodeData,
  EditVideoProNodeData,
  MotionTransferData,
  VideoUpscaleData,
  ExtendVideoData,
  SpeechToVideoData,
  FaceSwapData,
  VideoRetakeData,
  GeneratedScript,
  GeneratedScriptResult,
  CharacterNodeData,
  SwitchXData,
  VideoAnalysisNodeData,
} from "@/types/nodes"
import { GENERATE_VIDEO_PRO_MAX_DURATION_FALLBACK, VIDEO_I2V_MODELS, VIDEO_T2V_MODELS, VIDEO_V2V_MODELS, VIDEO_GEN_MODELS, GVP_PROVIDERS, MOTION_TRANSFER_MODELS, KIE_VIDEO_DURATIONS, KIE_T2V_DURATIONS, VIDEO_DURATION_OPTIONS, VIDEO_FPS_OPTIONS, PROVIDERS_WITH_END_FRAME, KLING3_DURATIONS, VIDEO_RATIOS, SEEDANCE_2_VIDEO_RATIOS, PROVIDERS_WITH_REFERENCES, V2V_DURATION_OPTIONS, V2V_RESOLUTION_OPTIONS, V2V_ALEPH_ASPECT_RATIOS, EXTEND_VIDEO_MODELS, getVideoResolutionOptions, getAspectRatiosForVideoModel, getVideoModelCapabilitiesTooltip } from "./model-options"
import { isSeedance2Provider, defaultVideoAspectRatio, MODEL_CATALOG, SEEDANCE_2_REF_LIMITS, VIDEO_PROMPT_MAX, getMaxVideoPromptChars, getMaxNegativePromptChars, buildVideoCreditModelIdentifier, characterMentionSlug, characterMentionableAssetArrays, DEFAULT_LABEL_BY_SOURCE, locationMentionSlug, resolveEffectiveSourceType, FRAME_TARGET_HANDLES, VIDEO_ANALYSIS_TIER_ORDER, VIDEO_ANALYSIS_TIER_LABELS, VIDEO_ANALYSIS_TIERS, DEFAULT_VIDEO_ANALYSIS_TIER, isVideoAnalysisTier, LLM_MODELS } from "@nodaro/shared"
import type { ReferenceSource, ConnectedReference } from "@nodaro/shared"
import { resolveSeedance2Inputs } from "@nodaro/prompts"
import { probeVideoAnalysis } from "@/lib/api"
import { entityActiveImageUrl } from "@/lib/entity-output-url"
import { PromptLengthCounter } from "./prompt-length-counter"
import { ModelSearchSelect } from "./model-search-select"
import { ModelDescriptionHint } from "./model-description-hint"
import { MappableField } from "./mappable-field"
import { TagTextarea } from "./tag-textarea"
import type { RefImageItem } from "./tag-textarea"
// `{video:N}` / `{audio:N}` autocomplete builders live in a neutral module to
// avoid a circular import (this file imports `usePromptEditorRefs`, which in
// turn consumes these builders). Imported here so the config-panel
// `referenceImages` can append them (full image+video+audio parity with the
// inline/modal surface), and re-exported so callers + the Task 3.1 test keep
// importing them from `../video-configs`.
import { buildVideoRefVideoAutocomplete, buildVideoRefAudioAutocomplete } from "./video-audio-ref-items"
export { buildVideoRefVideoAutocomplete, buildVideoRefAudioAutocomplete }
import { PromptEditor } from "./prompt-editor"
import { usePromptEditorRefs } from "@/components/nodes/inline-node-prompt/use-prompt-editor-refs"
// Lazy-loaded so the heavy Kling3 studio panel ships in its OWN chunk instead
// of being statically bundled into the video-configs chunk. config-panel.tsx
// lazy-imports the same module path, so both share a single on-demand chunk.
const Kling3StudioConfig = lazyWithRetry(() => import("./kling3-studio-config").then(m => ({ default: m.Kling3StudioConfig })))
import { AspectRatioSelector } from "./aspect-ratio-selector"
import { CameraMotionPicker } from "./camera-motion-picker"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Checkbox } from "@/components/ui/checkbox"
import { ConnectedMediaList, getSourceThumbnail } from "./connected-media-list"
import { InjectedReferenceList } from "./injected-reference-list"
import { SeedanceReferenceTip } from "./seedance-reference-tip"
import { FramesAndReferencesTip } from "./frames-references-tip"
import { removeMentionToken, makeRemoveWiredSource, appendSuppressedSlug } from "./injected-reference-helpers"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { PromptFieldFinalView, PromptFieldModeToggle } from "./prompt-field-final-view"
import { useFinalPromptSegments, negativeRoutingCaption } from "./use-final-prompt-segments"
import { usePromptFieldMode } from "@/hooks/use-prompt-field-mode"
import { ConnectedCinematographySources } from "./connected-cinematography-sources"
import { ExtraRefsSection } from "./extra-refs-section"
import type { ConfigProps, SourceNodeInfo } from "./types"
import { PromptHelperButton } from "./prompt-helper-button"
import { SpanRangeSlider } from "./span-range-slider"
import { SnippetMenuButton } from "./snippet-menu-button"
import { useSnippetPool } from "@/hooks/queries/use-prompt-snippets-queries"

// ---------------------------------------------------------------------------
// Character @-mention autocomplete — builds the RefImageItem[] passed as
// `referenceImages` to <TagTextarea>. Each wired upstream character expands
// into a canonical entry plus one entry per asset variant (expressions /
// poses / motions / angles / bodyAngles / lighting) so typing `@kira-smile`
// in the prompt resolves the right asset. Mirrors the editor-side builder in
// image-configs.tsx (GenerateImageConfig / ModifyImageConfig) — simplified
// because video data types have no `characterDefinitionIds` (only wired
// upstreams). Generic image upstreams (generate-image, upload-image, etc.)
// are included so users can also reference them positionally via the @
// suggestion list, mirroring image-configs behavior.
// ---------------------------------------------------------------------------

const VIDEO_REF_SOURCE_BY_TYPE: Record<string, ReferenceSource> = {
  "upload-image": "wired-image",
  "generate-image": "wired-image",
  "edit-image": "wired-image",
  "image-to-image": "wired-image",
  "modify-image": "wired-image",
  "upscale-image": "wired-image",
  "remove-background": "wired-image",
  "extract-frame": "wired-image",
  "scene": "wired-image",
  "character": "wired-character",
  "face": "wired-face",
  "object": "wired-object",
  "creature": "wired-creature",
  "location": "wired-location",
}

/** Location variant buckets — kept in lockstep with backend
 *  `LOCATION_VARIANT_BUCKETS` in payload-builder.ts and the runtime path in
 *  `execute-node.ts`. */
const VIDEO_LOCATION_VARIANT_BUCKETS = [
  "timeOfDay",
  "weather",
  "seasons",
  "angles",
  "lighting",
  "atmosphereMotions",
] as const

interface VideoRefAutocompleteEntry {
  readonly id: string
  readonly url: string
  readonly defaultName: string
  readonly source: ReferenceSource
  /**
   * The CONSUMER node's target handle this upstream is wired into
   * (`"references"` / `"imageReferences"` for image refs, `"startFrame"` /
   * `"endFrame"` for frames). Carried so the `{image:N}` token numbering in
   * `toRefImageItems` can exclude frames — editor token N must equal backend
   * `reference_image_urls` slot N (frames are appended at the tail by
   * `resolveSeedance2Inputs`, never numbered). The connected-references DISPLAY
   * path (`toConnectedReferences`) ignores this field, so its output is
   * unchanged.
   */
  readonly targetHandle?: string
  readonly characterSlug?: string
  readonly variantSlug?: string
  readonly variantDisplayName?: string
  /** Character asset bucket this entry came from ("boards", "expressions", …);
   *  undefined = canonical. Display-only (menu ordering + Board badge). */
  readonly bucket?: string
  /**
   * Location fields, populated for `source === "wired-location"` entries.
   * Mirror the analogous character fields. The canonical entry has only
   * `locationSlug` set; per-variant entries set bucket + slug + displayName
   * as well. Slice 3 of Location Studio Phase 2 #2 surfaces these in the
   * `@`-autocomplete.
   */
  readonly locationSlug?: string
  readonly locationVariantBucket?: string
  readonly locationVariantSlug?: string
  readonly locationVariantDisplayName?: string
  readonly defaultUsageMode?: import("@nodaro/shared").UsageMode
  /** Character LoRA training status — drives `<TrainedPill>` in autocomplete. */
  readonly loraTrainingStatus?: string | null
}

export function buildVideoRefAutocomplete(
  sources: ReadonlyArray<SourceNodeInfo>,
): VideoRefAutocompleteEntry[] {
  const out: VideoRefAutocompleteEntry[] = []
  for (const s of sources) {
    const effectiveType = resolveEffectiveSourceType(s.type, s.sourceHandle)
    const refSource = VIDEO_REF_SOURCE_BY_TYPE[effectiveType]
    if (!refSource) continue
    const nd = s.nodeData ?? {}

    // Character upstream: expand into canonical + one entry per asset variant
    // so the `@kira` / `@kira-smile` typeahead in the prompt editor sees them.
    if (effectiveType === "character") {
      const charData = nd as unknown as CharacterNodeData
      const charName = charData.characterName || s.label || "Character"
      const slug = characterMentionSlug(charName)
      if (slug) {
        const defaultUsageMode = charData.defaultUsageMode
        const loraTrainingStatus = charData.loraTrainingStatus ?? null
        const canonicalUrl =
          charData.defaultAssetUrl ||
          charData.sourceImageUrl ||
          (nd.generatedImageUrl as string) ||
          (nd.url as string) ||
          ""
        if (canonicalUrl) {
          out.push({
            id: s.id,
            url: canonicalUrl,
            defaultName: charName,
            source: "wired-character",
            targetHandle: s.targetHandle,
            characterSlug: slug,
            variantSlug: undefined,
            variantDisplayName: "canonical",
            defaultUsageMode,
            loraTrainingStatus,
          })
        }
        // All {name,url}[] variant buckets (incl. wardrobe + detail close-ups) +
        // sheets — single source of truth shared with the image expansion sites.
        const assetArrays = characterMentionableAssetArrays(charData as unknown as Record<string, unknown>)
        for (const [arrayName, items] of Object.entries(assetArrays)) {
          for (const item of items) {
            if (!item.url) continue
            const variantSlug = characterMentionSlug(item.name)
            if (!variantSlug) continue
            out.push({
              id: `${s.id}_${arrayName}_${variantSlug}`,
              url: item.url,
              defaultName: `${charName} / ${item.name}`,
              source: "wired-character",
              targetHandle: s.targetHandle,
              characterSlug: slug,
              variantSlug,
              bucket: arrayName,
              variantDisplayName: item.name,
              defaultUsageMode,
              loraTrainingStatus,
            })
          }
        }
        continue
      }
      // Unnamed character — fall through to generic upstream handling.
    }

    // Location upstream: expand into canonical + per-bucket-variant entries
    // so `@oldlibrary:1` and `@oldlibrary:1:weather/rain` both surface in
    // the autocomplete. Mirrors `expandLocationNodeIntoRefs` in
    // execute-node.ts (runtime path) for slice 3 of Location Studio Phase 2 #2.
    if (effectiveType === "location") {
      const locName = (nd.locationName as string) || s.label || "Location"
      const locSlug = locationMentionSlug(locName) || undefined
      const sourceUrl = nd.sourceImageUrl as string | undefined
      if (sourceUrl && locSlug) {
        out.push({
          id: s.id,
          url: sourceUrl,
          defaultName: locName,
          source: "wired-location",
          targetHandle: s.targetHandle,
          locationSlug: locSlug,
          locationVariantDisplayName: "canonical",
        })
        for (const bucket of VIDEO_LOCATION_VARIANT_BUCKETS) {
          const items = nd[bucket]
          if (!Array.isArray(items)) continue
          for (const item of items) {
            const variantName = (item as { name?: string }).name
            const variantUrl = (item as { url?: string }).url
            if (!variantName || !variantUrl) continue
            const variantSlug = locationMentionSlug(variantName)
            if (!variantSlug) continue
            out.push({
              id: `${s.id}_${bucket}_${variantSlug}`,
              url: variantUrl,
              defaultName: `${locName} / ${variantName}`,
              source: "wired-location",
              targetHandle: s.targetHandle,
              locationSlug: locSlug,
              locationVariantBucket: bucket,
              locationVariantSlug: variantSlug,
              locationVariantDisplayName: variantName,
            })
          }
        }
        continue
      }
      // Fall through to generic upstream handling when the location has no
      // source image yet (still-rendering or empty node).
    }

    const url =
      entityActiveImageUrl(nd) ||
      (nd.generatedImageUrl as string) ||
      (nd.url as string) ||
      (nd.sourceImageUrl as string) ||
      (nd.referenceImageUrl as string) ||
      ""
    if (!url) continue
    out.push({
      id: s.id,
      url,
      defaultName: s.label || s.type,
      source: refSource,
      targetHandle: s.targetHandle,
    })
  }
  return out
}

/**
 * Convert the autocomplete entries into `ConnectedReference[]` for the
 * `<InjectedReferenceList>` component. Drops the imageIndex (which is just
 * the position in this list — the component recomputes it).
 */
function toConnectedReferences(entries: ReadonlyArray<VideoRefAutocompleteEntry>): ConnectedReference[] {
  return entries.map((ref) => ({
    id: ref.id,
    defaultName: ref.defaultName,
    source: ref.source,
    url: ref.url,
    characterSlug: ref.characterSlug,
    variantSlug: ref.variantSlug,
    variantDisplayName: ref.variantDisplayName,
    locationSlug: ref.locationSlug,
    locationVariantBucket: ref.locationVariantBucket,
    locationVariantSlug: ref.locationVariantSlug,
    locationVariantDisplayName: ref.locationVariantDisplayName,
    defaultUsageMode: ref.defaultUsageMode,
  }))
}

// Frame target handles (start/end keyframes) are excluded from `{image:N}`
// numbering — see the shared `FRAME_TARGET_HANDLES` (single source of truth,
// also consumed by the inline/modal builder in `connected-references.ts` so the
// two surfaces can't drift). A wired start frame must NOT steal slot 1; the
// backend appends frames at the TAIL of `reference_image_urls`.
export function toRefImageItems(entries: ReadonlyArray<VideoRefAutocompleteEntry>): RefImageItem[] {
  return entries
    .filter((ref) => !FRAME_TARGET_HANDLES.has(ref.targetHandle ?? ""))
    .map((ref, i) => ({
    url: ref.url,
    label: ref.defaultName,
    // Map `wired-location` → "location" so the autocomplete renders cyan
    // location pills (slice 3 of Location Studio Phase 2 #2). Other
    // `wired-*` sources keep the existing "character" routing — they
    // share the violet pill until their own pill types ship.
    source:
      ref.source === "wired-image" ? "wired"
      : ref.source === "wired-location" ? "location"
      : "character",
    index: i + 1,
    defaultLabel: DEFAULT_LABEL_BY_SOURCE[ref.source],
    characterSlug: ref.characterSlug,
    variantSlug: ref.variantSlug,
    variantDisplayName: ref.variantDisplayName,
    bucket: ref.bucket,
    locationSlug: ref.locationSlug,
    locationVariantBucket: ref.locationVariantBucket,
    locationVariantSlug: ref.locationVariantSlug,
    locationVariantDisplayName: ref.locationVariantDisplayName,
    defaultUsageMode: ref.defaultUsageMode,
    loraTrainingStatus: ref.loraTrainingStatus,
  }))
}

function ImageToVideoConfigImpl({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, onUpdateNode, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<ImageToVideoData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("video", "prompt")
  const negativeSnippets = useSnippetPool("video", "negative")
  // Per-field Edit⇄Final toggle (persisted in node data). Provider-less path —
  // this panel's preview was provider-less; behavior-preserving downgrade per
  // spec (no buildImagePrompt-style upgrade in this task).
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const negativeFieldMode = usePromptFieldMode(nodeId ?? "", "negativePrompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    negativePrompt: data.negativePrompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
    negativeSnippets,
    // Predict the video provider's negative routing (native vs appended Avoid:)
    // via the shared helper — matches the panel's own effective provider.
    videoProvider: data.provider || "seedance-2-fast",
  })
  useEffect(() => { prefetchModelCredits(VIDEO_I2V_MODELS.map((m) => m.value)) }, [])
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  const currentI2VProvider = data.provider || "seedance-2-fast"

  // Fail-safe: when the current provider doesn't expose a resolution lever
  // (or the cached value isn't in its valid set), clear/snap so admin
  // defaults and stale state can't poison the request payload. Same for
  // duration — the rendered Select defaults to allowedDurations[0] when
  // data.duration is invalid, but without a snap data.duration carries the
  // stale value into the request and into credit pricing.
  // Note: reads from VIDEO_DURATION_OPTIONS (not KIE_VIDEO_DURATIONS) so
  // providers spliced in outside MODEL_CATALOG (LTX 2.3) are also covered.
  useEffect(() => {
    const updates: Partial<ImageToVideoData> = {}
    const opts = getVideoResolutionOptions(currentI2VProvider)
    if (opts) {
      if (data.resolution && !opts.some((o) => o.value === data.resolution)) {
        updates.resolution = opts[0]?.value
      }
    } else if (data.resolution !== undefined) {
      updates.resolution = undefined
    }
    const baseDurations = VIDEO_DURATION_OPTIONS[currentI2VProvider]?.map((o) => o.value) ?? null
    if (baseDurations && data.duration && !baseDurations.includes(data.duration)) {
      updates.duration = baseDurations[0]
    }
    // Aspect ratio — snap a stale EXPLICIT value (e.g. Seedance's "adaptive" /
    // "21:9" / "4:3" / "3:4") to the new provider's first valid option when it
    // isn't in that provider's set. Reads the same option source the dropdown
    // renders, so it's data-driven (no hardcoded provider list) and prevents a
    // backend Zod reject at generate-time. Left untouched when unset (undefined
    // resolves to the provider's own run default).
    const aspectOpts = getAspectRatiosForVideoModel(currentI2VProvider)
    if (data.aspectRatio && !aspectOpts.some((o) => o.value === data.aspectRatio)) {
      updates.aspectRatio = aspectOpts[0]?.value as ImageToVideoData["aspectRatio"]
    }
    if (Object.keys(updates).length > 0) {
      onUpdate(updates)
    }
  }, [currentI2VProvider]) // eslint-disable-line react-hooks/exhaustive-deps

  const baseDurations = KIE_VIDEO_DURATIONS[data.provider || "seedance-2-fast"] || null
  // Hailuo 2.3 Pro/Standard: 1080P only supports 6s duration
  const allowedDurations = baseDurations && (data.provider === "hailuo-2.3-pro" || data.provider === "hailuo-2.3") && data.resolution === "1080P"
    ? baseDurations.filter((d) => d <= 6)
    : baseDurations
  const supportsEndFrame = PROVIDERS_WITH_END_FRAME.includes(data.provider || "seedance-2-fast")
  const supportsReferences = PROVIDERS_WITH_REFERENCES.includes(data.provider || "seedance-2-fast")
  const isVeo = data.provider === "veo3" || data.provider === "veo3.1" || data.provider === "veo3_lite"
  const isVeoRefMode = isVeo && data.veoMode === "reference"

  const connectedImages = useMemo(() => {
    const imageTypes = ["generate-image", "upload-image", "character", "object", "location", "edit-image", "image-to-image", "scene"]
    return sources.filter((s) => imageTypes.includes(s.type) && s.targetHandle !== "references").map((s) => {
      let displayLabel = s.label
      if (s.targetHandle === "startFrame") {
        displayLabel = `Start: ${s.label}`
      } else if (s.targetHandle === "endFrame") {
        displayLabel = `End: ${s.label}`
      }

      return {
        id: s.id,
        type: s.type,
        label: displayLabel,
        imageUrl: getSourceThumbnail(s),
        targetHandle: s.targetHandle,
      }
    })
  }, [sources])

  const connectedRefImages = useMemo(() => {
    return sources.filter((s) => s.targetHandle === "references").map((s) => ({
      id: s.id, type: s.type, label: s.label, imageUrl: getSourceThumbnail(s),
    }))
  }, [sources])
  // Sources wired specifically into the `references` handle. Pre-filtered here
  // so `<ConnectedMediaList>` only sees (and reorders) the reference-image
  // connections — start/end frame edges live in their own pre-existing media
  // list above and have their own ordering field.
  const refSources = useMemo(
    () => sources.filter((s) => s.targetHandle === "references"),
    [sources],
  )

  // Character @-mention autocomplete: wired-character upstreams expand into
  // canonical + per-variant entries (mirrors image-configs.tsx Task 6 + 8b3b3c13).
  const refImagesForAutocomplete = useMemo<RefImageItem[]>(
    () => [
      // Image refs (frame-excluded) first, then the independently-numbered
      // reference-VIDEO + reference-AUDIO items — full {image:N}/{video:N}/
      // {audio:N} parity with the inline/modal surface (usePromptEditorRefs).
      // The video/audio builders self-gate on referenceModalityForHandle, so
      // they yield [] for panels with no such handle wired (no-op there).
      ...toRefImageItems(buildVideoRefAutocomplete(sources)),
      ...buildVideoRefVideoAutocomplete(sources),
      ...buildVideoRefAudioAutocomplete(sources),
    ],
    [sources],
  )


  const maxRefImages = data.provider === "grok-i2v" ? 6 : data.provider === "kling-3-omni" ? 7 : 3

  const hasEndFrame = connectedImages.some((img) => img.targetHandle === "endFrame")

  if (data.provider === "kling-3.0") {
    return <Suspense fallback={null}><Kling3StudioConfig data={data} onUpdate={onUpdate} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} nodes={nodes} edges={edges} onUpdateNode={onUpdateNode} nodeId={nodeId} /></Suspense>
  }

  return (
    <div className="flex flex-col gap-3">
      {connectedImages.length > 0 && (
        <ConnectedMediaList
          sources={sources}
          mediaOrder={data.connectedImageOrder ?? []}
          onUpdateOrder={(order) => onUpdate({ connectedImageOrder: order })}
          acceptedTypes={new Set(["generate-image", "upload-image", "character", "object", "location", "edit-image", "image-to-image", "scene"])}
          mediaType="image"
          primaryLabel="Start Frame"
        />
      )}

      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <ModelSearchSelect
          value={data.provider || "seedance-2-fast"}
          onChange={(v) => onUpdate({ provider: v as ImageToVideoData["provider"] })}
          options={VIDEO_I2V_MODELS}
          getTooltip={getVideoModelCapabilitiesTooltip}
          ariaLabel="Provider"
        />
      </MappableField>
      <ModelDescriptionHint modelId={data.provider} />

      {isSeedance2Provider(currentI2VProvider) && (() => {
        const s2 = resolveSeedance2Inputs({
          firstFrameUrl: connectedImages.some((img) => img.targetHandle !== "endFrame") ? "first" : undefined,
          lastFrameUrl: hasEndFrame ? "last" : undefined,
          refImageUrls: Array.from({ length: connectedRefImages.length }, (_, i) => `r${i}`),
          refVideoUrls: Array.from({ length: ((data.referenceVideoUrls as readonly unknown[] | undefined) ?? []).length }, (_, i) => `v${i}`),
          refAudioUrls: Array.from({ length: ((data.referenceAudioUrls as readonly unknown[] | undefined) ?? []).length }, (_, i) => `a${i}`),
        })
        const label = s2.mode === "reference"
          ? "Reference — frames used as prompt-directed references"
          : s2.mode === "first-last-frame" ? "First + Last Frame (exact)" : "First Frame (exact)"
        return (
          <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 p-2">
            <span className="text-[11px] font-medium text-foreground">Mode: {label}</span>
            {s2.promptSuffix && (
              <span className="text-[10px] leading-snug text-muted-foreground">
                Appended to prompt: “{s2.promptSuffix}”
              </span>
            )}
            {s2.droppedRefImages > 0 && (
              <span className="text-[10px] leading-snug text-amber-500">
                {s2.droppedRefImages} reference image{s2.droppedRefImages > 1 ? "s" : ""} over the 9-image limit will be dropped (frames kept).
              </span>
            )}
          </div>
        )
      })()}

      {/* VEO mode toggle */}
      {isVeo && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Generation Mode</Label>
          <Select value={data.veoMode || "frame-to-frame"} onValueChange={(v) => onUpdate({ veoMode: v as "frame-to-frame" | "reference" })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="frame-to-frame">Frame-to-Frame</SelectItem>
              <SelectItem value="reference">Reference Mode</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground px-1">
            {isVeoRefMode
              ? "Reference mode uses 1-3 reference images to guide generation (not as start/end frames)."
              : "Frame-to-frame mode uses start and optional end frame images."}
          </p>
        </div>
      )}

      {/* Reference images section (Grok / VEO reference mode). Drag-to-reorder
          is essential because the positional Image-N letters in the assembled
          prompt are assigned by array index — without reorder the user can't
          control which character is "Image 1" vs "Image 2". */}
      {supportsReferences && (!isVeo || isVeoRefMode) && connectedRefImages.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Reference Images ({connectedRefImages.length}/{maxRefImages})</Label>
          <ConnectedMediaList
            sources={refSources}
            mediaOrder={data.connectedRefImageOrder ?? []}
            onUpdateOrder={(order) => onUpdate({ connectedRefImageOrder: order })}
            mediaType="image"
          />
          <p className="text-[10px] text-muted-foreground px-1">
            Connect image nodes to the References handle. Up to {maxRefImages} additional reference images.
          </p>
        </div>
      )}

      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
        <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => onUpdate({ prompt: v })} target="prompt" media="video" />
        <PromptHelperButton nodeType="image-to-video" currentPrompt={data.prompt || ""} provider={data.provider} duration={data.duration} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — node has no prompt yet"
            minHeightRem={3 * 1.5}
          />
        ) : (
          <>
            <PromptEditor
              rows={3}
              value={data.prompt || ""}
              onChange={(v) => onUpdate({ prompt: v })}
              placeholder="Describe the motion or animation you want..."
              referenceImages={refImagesForAutocomplete}
              nodeRefs={nodeRefs}
              refMap={refMap}
              snippets={promptSnippets}
            />
            <PromptLengthCounter value={data.prompt || ""} max={getMaxVideoPromptChars(currentI2VProvider)} modelLabel={currentI2VProvider} />
          </>
        )}
      </MappableField>

      {/* Negative Prompt — always visible. Kling family providers send it
          natively as `negative_prompt`; non-native providers get it
          appended to the prompt as "Avoid: …" by the backend helper. */}
      <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={negativeFieldMode.mode} onToggle={negativeFieldMode.toggle} />
        <SnippetMenuButton pool={negativeSnippets} value={(data as Record<string, unknown>).negativePrompt as string || ""} onInsert={(v) => onUpdate({ negativePrompt: v })} target="negative" media="video" />
      </span>}>
        {negativeFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.negativeSegments}
            plainText={finalPrompt.negativeText}
            placeholder="Final negative prompt preview — nothing to avoid yet"
            routingCaption={negativeRoutingCaption(finalPrompt.negativeRouting)}
            minHeightRem={2 * 1.5}
          />
        ) : (
          <>
            <Textarea
              rows={2}
              value={(data as Record<string, unknown>).negativePrompt as string || ""}
              onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
              placeholder="Things to avoid..."
            />
            <PromptLengthCounter value={(data as Record<string, unknown>).negativePrompt as string || ""} max={getMaxNegativePromptChars(currentI2VProvider)} modelLabel={currentI2VProvider} noun="negative prompt" />
          </>
        )}
      </MappableField>

      {/* Unified injected-references list — shows wired upstreams, character
          canonicals, @-mention variants AND canonical fallbacks in the final
          API order. Drag to reorder; × removes the edge, mention token, or
          adds to the canonical-suppression list. */}
      <InjectedReferenceList
        connectedReferences={toConnectedReferences(buildVideoRefAutocomplete(sources))}
        prompt={data.prompt || ""}
        referenceOrder={data.referenceOrder}
        suppressedCanonicalCharacterIds={data.suppressedCanonicalCharacterIds}
        onUpdateReferenceOrder={(order) => onUpdate({ referenceOrder: order })}
        onRemoveWiredSource={
          nodeId
            ? makeRemoveWiredSource(
                nodeId,
                edges ?? [],
                useWorkflowStore.getState().deleteEdge,
              )
            : undefined
        }
        onRemoveMention={(token) => onUpdate({ prompt: removeMentionToken(data.prompt || "", token) })}
        onSuppressCanonical={(slug) =>
          onUpdate({ suppressedCanonicalCharacterIds: appendSuppressedSlug(data.suppressedCanonicalCharacterIds, slug) })
        }
        label="Injected references"
      />
      <SeedanceReferenceTip provider={data.provider} />
      <FramesAndReferencesTip
        hasFrame={connectedImages.some((img) => img.targetHandle === "startFrame" || img.targetHandle === "endFrame")}
        hasReference={connectedRefImages.length > 0}
      />

      <ExtraRefsSection
        extraRefs={data.extraRefs}
        onChange={(next) => onUpdate({ extraRefs: next })}
        consumerNodeId={nodeId}
        nodes={nodes}
        edges={edges ?? []}
      />

      {(data.provider === "veo3" || data.provider === "veo3.1" || data.provider === "veo3_lite") && (
        <>
          <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <AspectRatioSelector
              options={[
                { value: "Auto", label: "Auto (from image)" },
                { value: "16:9", label: "16:9 (Landscape)" },
                { value: "9:16", label: "9:16 (Portrait)" },
              ]}
              value={data.aspectRatio || "16:9"}
              onValueChange={(v) => onUpdate({ aspectRatio: v as ImageToVideoData["aspectRatio"] })}
            />
          </MappableField>
          {(() => {
            const opts = getVideoResolutionOptions(currentI2VProvider)
            return opts && opts.length > 0 ? (
              <div>
                <Label className="text-xs">Resolution</Label>
                <Select
                  value={(data.resolution as string) || opts[0].value}
                  onValueChange={(v) => onUpdate({ resolution: v })}
                >
                  <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {opts.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  4K generates the base at 1080p, then upscales to 4K automatically in the same run (billed at the 4K rate).
                </p>
              </div>
            ) : null
          })()}
          <div>
            <Label className="text-xs">Seed (optional)</Label>
            <Input
              type="number"
              min={10000}
              max={99999}
              placeholder="10000–99999"
              value={data.seed ?? ""}
              onChange={(e) => onUpdate({ seed: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
            />
            <p className="text-[10px] text-muted-foreground mt-1">Same seed produces similar results. Leave empty for random.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 px-1">
              <input
                type="checkbox"
                id="generateAudio"
                checked={data.generateAudio !== false}
                onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
                className="rounded border-muted-foreground/40"
              />
              <label htmlFor="generateAudio" className="text-xs">Generate Audio</label>
            </div>
            <p className="text-xs text-muted-foreground px-1">VEO 3.1 creates AI audio from the prompt. Disable for silent video, then use Add Audio node.</p>
          </div>
          {/* VEO auto-translate — the provider silently translates
              non-English prompts (and lightly rewrites English ones).
              Disable when the exact wording is load-bearing, e.g. the
              perfect-loop seal phrase. */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 px-1">
              <input
                type="checkbox"
                id="i2v-enableTranslation"
                checked={data.enableTranslation !== false}
                onChange={(e) => onUpdate({ enableTranslation: e.target.checked })}
                className="rounded border-muted-foreground/40"
              />
              <label htmlFor="i2v-enableTranslation" className="text-xs">Auto-translate prompt to English</label>
            </div>
            <p className="text-xs text-muted-foreground px-1">
              Prompts are auto-translated to English before VEO sees them (default on). Disable to keep prompts verbatim — useful for non-English prompts or when exact wording matters (e.g. the perfect-loop seal phrase).
            </p>
          </div>
        </>
      )}
      <MappableField field="duration" label="Duration (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        {allowedDurations ? (
          <Select
            value={String(allowedDurations.includes(data.duration) ? data.duration : allowedDurations[0])}
            onValueChange={(v) => onUpdate({ duration: parseInt(v, 10) })}
          >
            <SelectTrigger aria-label="Duration (seconds)"><SelectValue /></SelectTrigger>
            <SelectContent>
              {allowedDurations.map((d) => (
                <SelectItem key={d} value={String(d)}>{d} seconds</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            type="number"
            min={1}
            max={30}
            value={data.duration ?? ""}
            onChange={(e) => onUpdate({ duration: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
          />
        )}
      </MappableField>
      {allowedDurations && allowedDurations.length === 1 && (
        <p className="text-xs text-muted-foreground px-1">
          {`${data.provider || "This provider"} produces ~${allowedDurations[0]} second videos.`}
        </p>
      )}
      {supportsEndFrame && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">End Frame (optional)</Label>
          <p className="text-xs text-muted-foreground px-1">
            Connect an image node to the &quot;End Frame&quot; handle for start-to-end frame video generation.
          </p>
        </div>
      )}
      {/* Loop trim — generic smart-loop-cut post-process */}
      <div className="flex flex-col gap-1.5 pt-2 border-t border-border">
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="loopTrim-enabled"
            checked={data.loopTrim?.enabled ?? false}
            onChange={(e) => onUpdate({
              loopTrim: e.target.checked
                ? { enabled: true, framesToTest: data.loopTrim?.framesToTest ?? 16, quality: data.loopTrim?.quality ?? "precise" }
                : { enabled: false },
            })}
            className="rounded border-muted-foreground/40"
          />
          <label htmlFor="loopTrim-enabled" className="text-xs">Loop trim</label>
        </div>
        {data.loopTrim?.enabled && (
          <>
            <div className="px-1">
              <label htmlFor="loopTrim-frames" className="text-[10px] text-muted-foreground">
                Frames to test: {data.loopTrim.framesToTest ?? 16}
              </label>
              <input
                id="loopTrim-frames"
                type="range"
                min={4}
                max={64}
                step={1}
                value={data.loopTrim.framesToTest ?? 16}
                onChange={(e) => onUpdate({
                  loopTrim: { ...data.loopTrim!, framesToTest: parseInt(e.target.value, 10) },
                })}
                className="w-full h-1.5 rounded-lg cursor-pointer accent-[#ff0073]"
              />
            </div>
            <div className="px-1">
              <label htmlFor="loopTrim-quality" className="text-[10px] text-muted-foreground">Quality</label>
              <Select
                value={data.loopTrim.quality ?? "precise"}
                onValueChange={(v) => onUpdate({
                  loopTrim: { ...data.loopTrim!, quality: v as "lossless" | "precise" },
                })}
              >
                <SelectTrigger id="loopTrim-quality" className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="precise">Precise — frame-precise, slight quality drop</SelectItem>
                  <SelectItem value="lossless">Lossless — keyframe-only, byte-perfect</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!connectedImages.some((img) => img.targetHandle === "endFrame") && (
              <p className="px-1 text-[10px] text-amber-500/80 leading-snug">
                Works best when start and end frames are pinned to the same image. Without an end frame, the algorithm picks the best loop point it can find but the result may not be seamless.
              </p>
            )}
          </>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="motionEnabled"
            checked={!!data.motionEnabled}
            onChange={(e) => onUpdate({ motionEnabled: e.target.checked, ...(!e.target.checked ? { motion: undefined } : {}) })}
            className="rounded border-muted-foreground/40"
          />
          <label htmlFor="motionEnabled" className="text-xs">Motion hint (injected into prompt)</label>
        </div>
        {data.motionEnabled && (
          <MappableField field="motion" label="Motion" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Select
              value={data.motion || "moderate"}
              onValueChange={(v) => onUpdate({ motion: v as ImageToVideoData["motion"] })}
            >
              <SelectTrigger aria-label="Motion"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="subtle">Subtle</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="dynamic">Dynamic</SelectItem>
              </SelectContent>
            </Select>
          </MappableField>
        )}
      </div>

      {data.provider === "kling" && (
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="klingSound"
            checked={(data as Record<string, unknown>).kling3Sound !== false}
            onChange={(e) => onUpdate({ kling3Sound: e.target.checked })}
            className="rounded border-muted-foreground/40"
          />
          <label htmlFor="klingSound" className="text-xs">Enable Sound</label>
        </div>
      )}

      {(data.provider === "kling-turbo" || data.provider === "kling-master") && (
        <div>
          <Label className="text-xs">CFG Scale ({String((data as Record<string, unknown>).cfgScale ?? 0.5)})</Label>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={((data as Record<string, unknown>).cfgScale as number) ?? ""}
            onChange={(e) => onUpdate({ cfgScale: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">0 = creative, 1 = strict prompt adherence</p>
        </div>
      )}

      {data.provider === "kling-3-omni" && (
        <>
          <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <AspectRatioSelector
              options={VIDEO_RATIOS}
              value={data.aspectRatio || "16:9"}
              onValueChange={(v) => onUpdate({ aspectRatio: v as ImageToVideoData["aspectRatio"] })}
            />
          </MappableField>
          <div>
            <Label className="text-xs">Quality</Label>
            <Select
              value={data.resolution || "720p"}
              onValueChange={(v) => onUpdate({ resolution: v })}
            >
              <SelectTrigger aria-label="Quality"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="720p">Standard (720p)</SelectItem>
                <SelectItem value="1080p">Pro (1080p)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="kling3OmniAudio"
              checked={data.generateAudio !== false}
              onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="kling3OmniAudio" className="text-xs">Generate Audio</label>
          </div>
        </>
      )}

      {data.provider === "grok-i2v" && (
        <>
          <div>
            <Label className="text-xs">Resolution</Label>
            <Select
              value={data.resolution || "480p"}
              onValueChange={(v) => onUpdate({ resolution: v })}
            >
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="480p">480p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Mode</Label>
            <Select
              value={data.grokMode || "normal"}
              onValueChange={(v) => onUpdate({ grokMode: v as "fun" | "normal" | "spicy" })}
            >
              <SelectTrigger aria-label="Mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="fun">Fun</SelectItem>
                <SelectItem value="spicy">Spicy</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {data.provider === "seedance" && (
        <>
          <div>
            <Label className="text-xs">Resolution</Label>
            <Select
              value={data.resolution || "480p"}
              onValueChange={(v) => onUpdate({ resolution: v })}
            >
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="480p">480p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <AspectRatioSelector
              options={[
                { value: "16:9", label: "16:9 (Landscape)" },
                { value: "9:16", label: "9:16 (Portrait)" },
                { value: "1:1", label: "1:1 (Square)" },
                { value: "21:9", label: "21:9 (Ultra-wide)" },
              ]}
              value={data.aspectRatio || "16:9"}
              onValueChange={(v) => onUpdate({ aspectRatio: v as ImageToVideoData["aspectRatio"] })}
            />
          </MappableField>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="seedanceFixedLens"
              checked={data.cameraFixed || false}
              onChange={(e) => onUpdate({ cameraFixed: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="seedanceFixedLens" className="text-xs">Fixed Lens (no camera movement)</label>
          </div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="seedanceAudio"
              checked={data.generateAudio || false}
              onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="seedanceAudio" className="text-xs">Generate Audio</label>
          </div>
        </>
      )}

      {isSeedance2Provider(data.provider) && (
        <>
          <div>
            <Label className="text-xs">Resolution</Label>
            <Select
              value={data.resolution || "480p"}
              onValueChange={(v) => onUpdate({ resolution: v })}
            >
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                {/* Catalog-driven: seedance-2/-fast expose 480p/720p/1080p; seedance-2-mini 480p/720p */}
                {(getVideoResolutionOptions(currentI2VProvider) ?? []).map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <AspectRatioSelector
              options={SEEDANCE_2_VIDEO_RATIOS}
              value={data.aspectRatio || defaultVideoAspectRatio(currentI2VProvider)}
              onValueChange={(v) => onUpdate({ aspectRatio: v as ImageToVideoData["aspectRatio"] })}
            />
          </MappableField>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="seedance2Audio"
              checked={data.generateAudio ?? true}
              onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="seedance2Audio" className="text-xs">Generate Audio (default on)</label>
          </div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="seedance2WebSearch"
              checked={data.webSearch || false}
              onChange={(e) => onUpdate({ webSearch: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="seedance2WebSearch" className="text-xs">Enable Web Search</label>
          </div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="seedance2Nsfw"
              checked={data.nsfwChecker || false}
              onChange={(e) => onUpdate({ nsfwChecker: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="seedance2Nsfw" className="text-xs">NSFW Content Filter</label>
          </div>
        </>
      )}

      {(data.provider === "wan-i2v" || data.provider === "wan-turbo") && (
        <div>
          <Label className="text-xs">Resolution</Label>
          <Select
            value={data.resolution || (data.provider === "wan-turbo" ? "480p" : "720p")}
            onValueChange={(v) => onUpdate({ resolution: v })}
          >
            <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
            <SelectContent>
              {data.provider === "wan-turbo" ? (
                <>
                  <SelectItem value="480p">480p</SelectItem>
                  <SelectItem value="720p">720p</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="720p">720p</SelectItem>
                  <SelectItem value="1080p">1080p</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {(data.provider === "hailuo-2.3-pro" || data.provider === "hailuo-2.3" || data.provider === "hailuo-standard") && (
        <div>
          <Label className="text-xs">Resolution</Label>
          <Select
            value={data.resolution || (data.provider === "hailuo-standard" ? "512P" : "768P")}
            onValueChange={(v) => {
              const updates: Record<string, unknown> = { resolution: v }
              // 1080P only supports 6s — snap duration if needed
              if (v === "1080P" && data.duration && data.duration > 6) {
                updates.duration = 6
              }
              onUpdate(updates)
            }}
          >
            <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
            <SelectContent>
              {data.provider === "hailuo-standard" ? (
                <>
                  <SelectItem value="512P">512P</SelectItem>
                  <SelectItem value="768P">768P</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="768P">768P</SelectItem>
                  <SelectItem value="1080P">1080P (6s max)</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {(data.provider === "bytedance-lite" || data.provider === "bytedance-pro") && (
        <>
          <div>
            <Label className="text-xs">Resolution</Label>
            <Select
              value={data.resolution || "480p"}
              onValueChange={(v) => onUpdate({ resolution: v })}
            >
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="480p">480p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="bytedanceCameraFixed"
              checked={data.cameraFixed || false}
              onChange={(e) => onUpdate({ cameraFixed: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="bytedanceCameraFixed" className="text-xs">Camera Fixed</label>
          </div>
          <div>
            <Label className="text-xs">Seed (-1 for random)</Label>
            <Input
              type="number"
              min={-1}
              max={2147483647}
              value={data.seed ?? -1}
              onChange={(e) => onUpdate({ seed: parseInt(e.target.value, 10) })}
            />
          </div>
        </>
      )}

      {data.provider === "bytedance-pro-fast" && (
        <div>
          <Label className="text-xs">Resolution</Label>
          <Select
            value={data.resolution || "720p"}
            onValueChange={(v) => onUpdate({ resolution: v })}
          >
            <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="720p">720p</SelectItem>
              <SelectItem value="1080p">1080p</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage}
          alt="Connected image"
          onClose={() => setLightboxImage(null)}
        />
      )}

      <ConnectedCinematographySources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
    </div>
  )
}

// Memoized so an unrelated ConfigPanel re-render (stable configProps) skips
// reconciling this large subtree. See the topology-signature memos in
// config-panel.tsx that keep configProps' source/ref props stable.
export const ImageToVideoConfig = memo(ImageToVideoConfigImpl)

const V2V_IMAGE_TYPES = ["generate-image", "upload-image", "character", "object", "location", "edit-image", "image-to-image", "scene"]

function VideoToVideoConfigImpl({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<VideoToVideoData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("video", "prompt")
  const negativeSnippets = useSnippetPool("video", "negative")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const negativeFieldMode = usePromptFieldMode(nodeId ?? "", "negativePrompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    negativePrompt: data.negativePrompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
    negativeSnippets,
    // Video negative-routing prediction — matches this panel's effective provider.
    videoProvider: data.provider || "wan",
  })
  const provider = data.provider || "wan"
  const isWan = provider === "wan" || provider === "wan-flash"
  const isWanFlash = provider === "wan-flash"
  const isAleph = provider === "runway-aleph"
  const isVideoEdit = provider === "wan-videoedit"

  useEffect(() => {
    const updates: Partial<VideoToVideoData> = {}
    if (isVideoEdit) {
      // Snap any stale/invalid values that would fail route Zod validation
      if (!["0", "5", "10"].includes(data.videoEditDuration as string)) updates.videoEditDuration = "0"
      if (data.audioSetting !== undefined && !["auto", "origin"].includes(data.audioSetting)) updates.audioSetting = undefined
      if (!["720p", "1080p"].includes(data.v2vResolution as string)) updates.v2vResolution = "1080p"
    } else {
      // Clear wan-videoedit-exclusive fields when switching to another provider
      if (data.videoEditDuration !== undefined) updates.videoEditDuration = undefined
      if (data.audioSetting !== undefined) updates.audioSetting = undefined
      if (data.promptExtend !== undefined) updates.promptExtend = undefined
    }
    if (Object.keys(updates).length > 0) onUpdate(updates)
  }, [isVideoEdit]) // eslint-disable-line react-hooks/exhaustive-deps

  const connectedImages = useMemo(() => {
    return sources.filter((s) => V2V_IMAGE_TYPES.includes(s.type)).map((s) => ({
      id: s.id, type: s.type, label: s.label, imageUrl: getSourceThumbnail(s),
    }))
  }, [sources])

  // Character @-mention autocomplete: wired-character upstreams expand into
  // canonical + per-variant entries (mirrors image-configs.tsx Task 6 + 8b3b3c13).
  const refImagesForAutocomplete = useMemo<RefImageItem[]>(
    () => [
      // Image refs (frame-excluded) first, then the independently-numbered
      // reference-VIDEO + reference-AUDIO items — full {image:N}/{video:N}/
      // {audio:N} parity with the inline/modal surface (usePromptEditorRefs).
      // The video/audio builders self-gate on referenceModalityForHandle, so
      // they yield [] for panels with no such handle wired (no-op there).
      ...toRefImageItems(buildVideoRefAutocomplete(sources)),
      ...buildVideoRefVideoAutocomplete(sources),
      ...buildVideoRefAudioAutocomplete(sources),
    ],
    [sources],
  )

  return (
    <div className="flex flex-col gap-3">
      {connectedImages.length > 0 && (
        <ConnectedMediaList
          sources={sources}
          mediaOrder={data.connectedImageOrder ?? []}
          onUpdateOrder={(order) => onUpdate({ connectedImageOrder: order })}
          acceptedTypes={new Set(V2V_IMAGE_TYPES)}
          mediaType="image"
        />
      )}
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <ModelSearchSelect
          value={provider}
          onChange={(v) => onUpdate({ provider: v as VideoToVideoData["provider"] })}
          options={VIDEO_V2V_MODELS}
          getTooltip={getVideoModelCapabilitiesTooltip}
          ariaLabel="Provider"
        />
      </MappableField>
      <ModelDescriptionHint modelId={data.provider} />

      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
        <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => onUpdate({ prompt: v })} target="prompt" media="video" />
        <PromptHelperButton nodeType="video-to-video" currentPrompt={data.prompt || ""} provider={data.provider} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — node has no prompt yet"
            minHeightRem={3 * 1.5}
          />
        ) : (
          <>
            <PromptEditor
              rows={3}
              value={data.prompt}
              onChange={(v) => onUpdate({ prompt: v })}
              placeholder="Describe what to change or continue..."
              referenceImages={refImagesForAutocomplete}
              nodeRefs={nodeRefs}
              refMap={refMap}
              snippets={promptSnippets}
            />
            <PromptLengthCounter value={data.prompt} max={getMaxVideoPromptChars(provider)} modelLabel={provider} />
          </>
        )}
      </MappableField>

      {/* Negative Prompt — always visible. Wan family providers send it
          natively as `negative_prompt`; non-native providers get it
          appended to the prompt as "Avoid: …" by the backend helper. */}
      <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={negativeFieldMode.mode} onToggle={negativeFieldMode.toggle} />
        <SnippetMenuButton pool={negativeSnippets} value={data.negativePrompt || ""} onInsert={(v) => onUpdate({ negativePrompt: v || undefined })} target="negative" media="video" />
      </span>}>
        {negativeFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.negativeSegments}
            plainText={finalPrompt.negativeText}
            placeholder="Final negative prompt preview — nothing to avoid yet"
            routingCaption={negativeRoutingCaption(finalPrompt.negativeRouting)}
            minHeightRem={2 * 1.5}
          />
        ) : (
          <>
            <TagTextarea
              value={data.negativePrompt || ""}
              onChange={(v) => onUpdate({ negativePrompt: v || undefined })}
              placeholder="What to avoid..."
              rows={2}
              nodeRefs={nodeRefs}
              referenceImages={refImagesForAutocomplete}
              displayMode={variableDisplayMode}
              refMap={refMap}
              snippets={negativeSnippets}
            />
            <PromptLengthCounter value={data.negativePrompt || ""} max={getMaxNegativePromptChars(provider)} modelLabel={provider} noun="negative prompt" />
          </>
        )}
      </MappableField>

      <ExtraRefsSection
        extraRefs={data.extraRefs}
        onChange={(next) => onUpdate({ extraRefs: next })}
        consumerNodeId={nodeId}
        nodes={nodes}
        edges={edges ?? []}
      />

      {/* Unified injected-references list. */}
      <InjectedReferenceList
        connectedReferences={toConnectedReferences(buildVideoRefAutocomplete(sources))}
        prompt={data.prompt || ""}
        referenceOrder={data.referenceOrder}
        suppressedCanonicalCharacterIds={data.suppressedCanonicalCharacterIds}
        onUpdateReferenceOrder={(order) => onUpdate({ referenceOrder: order })}
        onRemoveWiredSource={
          nodeId
            ? makeRemoveWiredSource(
                nodeId,
                edges ?? [],
                useWorkflowStore.getState().deleteEdge,
              )
            : undefined
        }
        onRemoveMention={(token) => onUpdate({ prompt: removeMentionToken(data.prompt || "", token) })}
        onSuppressCanonical={(slug) =>
          onUpdate({ suppressedCanonicalCharacterIds: appendSuppressedSlug(data.suppressedCanonicalCharacterIds, slug) })
        }
        label="Injected references"
      />
      <SeedanceReferenceTip provider={data.provider} />

      {/* Wan / Wan Flash: Duration & Resolution */}
      {isWan && (
        <>
          <MappableField field="v2vDuration" label="Duration" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Select value={data.v2vDuration || "5"} onValueChange={(v) => onUpdate({ v2vDuration: v as "5" | "10" })}>
              <SelectTrigger aria-label="Duration"><SelectValue /></SelectTrigger>
              <SelectContent>
                {V2V_DURATION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </MappableField>
          <MappableField field="v2vResolution" label="Resolution" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Select value={data.v2vResolution || "1080p"} onValueChange={(v) => onUpdate({ v2vResolution: v as "720p" | "1080p" })}>
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                {V2V_RESOLUTION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </MappableField>
        </>
      )}

      {/* Wan Flash: Audio & Multi-shots */}
      {isWanFlash && (
        <>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="v2vAudio"
              checked={data.audio || false}
              onChange={(e) => onUpdate({ audio: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="v2vAudio" className="text-xs">Generate Audio (affects pricing)</label>
          </div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="v2vMultiShots"
              checked={data.multiShots || false}
              onChange={(e) => onUpdate({ multiShots: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="v2vMultiShots" className="text-xs">Multi-shot composition</label>
          </div>
        </>
      )}

      {/* Runway Aleph: Aspect Ratio & Seed */}
      {isAleph && (
        <>
          <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Select value={data.aspectRatio || ""} onValueChange={(v) => onUpdate({ aspectRatio: v || undefined })}>
              <SelectTrigger aria-label="Aspect Ratio"><SelectValue placeholder="Auto" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Auto</SelectItem>
                {V2V_ALEPH_ASPECT_RATIOS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </MappableField>
          <MappableField field="seed" label="Seed" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Input
              type="number"
              min={0}
              value={data.seed ?? ""}
              onChange={(e) => onUpdate({ seed: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Random"
            />
          </MappableField>
        </>
      )}

      {/* Wan 2.7 VideoEdit: Duration, Resolution, Audio Setting, Prompt Extend, Negative Prompt, Seed */}
      {isVideoEdit && (
        <>
          <MappableField field="videoEditDuration" label="Duration" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Select
              value={data.videoEditDuration || "0"}
              onValueChange={(v) => onUpdate({ videoEditDuration: v as "0" | "5" | "10" })}
            >
              <SelectTrigger aria-label="Duration"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Auto</SelectItem>
                <SelectItem value="5">5 seconds</SelectItem>
                <SelectItem value="10">10 seconds</SelectItem>
              </SelectContent>
            </Select>
          </MappableField>
          <MappableField field="v2vResolution" label="Resolution" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Select
              value={data.v2vResolution || "1080p"}
              onValueChange={(v) => onUpdate({ v2vResolution: v as "720p" | "1080p" })}
            >
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                {V2V_RESOLUTION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </MappableField>
          <MappableField field="audioSetting" label="Audio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Select
              value={data.audioSetting || "auto"}
              onValueChange={(v) => onUpdate({ audioSetting: v as "auto" | "origin" })}
            >
              <SelectTrigger aria-label="Audio Setting"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (AI-generated)</SelectItem>
                <SelectItem value="origin">Original audio</SelectItem>
              </SelectContent>
            </Select>
          </MappableField>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="v2vPromptExtend"
              checked={data.promptExtend || false}
              onChange={(e) => onUpdate({ promptExtend: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="v2vPromptExtend" className="text-xs">Expand prompt with AI</label>
          </div>
          <MappableField field="seed" label="Seed" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Input
              type="number"
              min={0}
              value={data.seed ?? ""}
              onChange={(e) => onUpdate({ seed: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Random"
            />
          </MappableField>
        </>
      )}

      <ConnectedCinematographySources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
    </div>
  )
}

export const VideoToVideoConfig = memo(VideoToVideoConfigImpl)

const SWITCHX_MODE_HELP: Record<string, string> = {
  auto: "AI masks the foreground subject — relight it, restyle/replace the background.",
  fill: "Keep the whole scene — restyle the entire frame from your reference/prompt.",
  select: "Provide one keyframe mask image (e.g. wire a Generate Mask node into the Mask input); the AI propagates it across the video.",
  custom: "Provide a full per-frame alpha matte video for frame-accurate control.",
}

function SwitchXConfigImpl({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, nodeId }: ConfigProps<SwitchXData> & { nodeId?: string }) {
  const mode = data.alphaMode ?? "auto"
  // Rich prompt UX (matches Generate Video / Video-to-Video): snippets, edit/final
  // toggle, @-reference autocomplete + variables, "generate with AI" helper.
  const promptSnippets = useSnippetPool("video", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
    videoProvider: "beeble",
  })
  const refImagesForAutocomplete = useMemo<RefImageItem[]>(
    () => [
      // Image refs (frame-excluded) first, then the independently-numbered
      // reference-VIDEO + reference-AUDIO items — full {image:N}/{video:N}/
      // {audio:N} parity with the inline/modal surface (usePromptEditorRefs).
      // The video/audio builders self-gate on referenceModalityForHandle, so
      // they yield [] for panels with no such handle wired (no-op there).
      ...toRefImageItems(buildVideoRefAutocomplete(sources)),
      ...buildVideoRefVideoAutocomplete(sources),
      ...buildVideoRefAudioAutocomplete(sources),
    ],
    [sources],
  )

  // Fail-safe (Provider-Enum-Sync step 12b): snap stale values when the mode
  // changes so the route's Zod never rejects — clear the mask when leaving the
  // mask modes, clear the keyframe outside select, snap an out-of-range resolution.
  useEffect(() => {
    const updates: Partial<SwitchXData> = {}
    if (mode !== "select" && mode !== "custom" && data.maskUrl) updates.maskUrl = undefined
    if (mode !== "select" && data.alphaKeyframeIndex !== undefined) updates.alphaKeyframeIndex = undefined
    if (data.maxResolution !== 720 && data.maxResolution !== 1080) updates.maxResolution = 1080
    if (Object.keys(updates).length > 0) onUpdate(updates)
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] text-muted-foreground/70 -mb-1">Powered by SwitchX · Beeble</div>

      <MappableField field="alphaMode" label="Mode" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={mode} onValueChange={(v) => onUpdate({ alphaMode: v as SwitchXData["alphaMode"] })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto — mask the subject</SelectItem>
            <SelectItem value="fill">Fill — restyle whole frame</SelectItem>
            <SelectItem value="select">Select — keyframe mask</SelectItem>
            <SelectItem value="custom">Custom — matte video</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <p className="text-[11px] text-muted-foreground/70 -mt-1">{SWITCHX_MODE_HELP[mode]}</p>

      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
        <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => onUpdate({ prompt: v })} target="prompt" media="video" />
        <PromptHelperButton nodeType="switchx" currentPrompt={data.prompt || ""} onAccept={(prompt) => onUpdate({ prompt })} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — node has no prompt yet"
            minHeightRem={3 * 1.5}
          />
        ) : (
          <>
            <PromptEditor
              rows={3}
              value={data.prompt}
              onChange={(v) => onUpdate({ prompt: v })}
              placeholder="Describe the desired look (a connected reference image is strongly recommended)…"
              referenceImages={refImagesForAutocomplete}
              nodeRefs={nodeRefs}
              refMap={refMap}
              snippets={promptSnippets}
            />
            <PromptLengthCounter value={data.prompt} max={2000} modelLabel="SwitchX" />
          </>
        )}
      </MappableField>

      {mode === "select" && (
        <MappableField field="alphaKeyframeIndex" label="Keyframe index" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Input
            type="number"
            min={0}
            className="h-8 text-xs"
            value={data.alphaKeyframeIndex ?? 0}
            onChange={(e) => onUpdate({ alphaKeyframeIndex: Math.max(0, parseInt(e.target.value, 10) || 0) })}
          />
        </MappableField>
      )}

      <MappableField field="maxResolution" label="Resolution" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={String(data.maxResolution ?? 1080)} onValueChange={(v) => onUpdate({ maxResolution: Number(v) as 720 | 1080 })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1080">1080p</SelectItem>
            <SelectItem value="720">720p</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>

      <MappableField field="seed" label="Seed (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          type="number"
          min={0}
          max={4294967295}
          className="h-8 text-xs"
          placeholder="Random"
          value={data.seed ?? ""}
          onChange={(e) => {
            const v = e.target.value.trim()
            onUpdate({ seed: v === "" ? undefined : Math.max(0, parseInt(v, 10) || 0) })
          }}
        />
      </MappableField>
    </div>
  )
}

export const SwitchXConfig = memo(SwitchXConfigImpl)

const MOTION_VIDEO_NODE_TYPES = new Set(["image-to-video", "text-to-video", "video-to-video", "upload-video", "motion-transfer", "extend-video", "speech-to-video"])

function MotionTransferConfigImpl({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<MotionTransferData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("video", "prompt")
  const negativeSnippets = useSnippetPool("video", "negative")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const negativeFieldMode = usePromptFieldMode(nodeId ?? "", "negativePrompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    negativePrompt: data.negativePrompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
    negativeSnippets,
    // Video negative-routing prediction — matches this panel's effective provider.
    videoProvider: data.provider || "kling",
  })
  const provider = data.provider || "kling"

  // Detect video duration from connected upstream video node's metadata or URL
  const connectedVideoInfo = useMemo(() => {
    for (const s of sources) {
      if (MOTION_VIDEO_NODE_TYPES.has(s.type)) {
        // Try metadata duration first (instant, no network)
        const meta = s.nodeData?.metadata as { durationSeconds?: number } | undefined
        if (meta?.durationSeconds && meta.durationSeconds > 0) {
          return { durationSeconds: meta.durationSeconds }
        }
        const url = (s.nodeData?.generatedVideoUrl as string) || (s.nodeData?.videoUrl as string) || (s.nodeData?.url as string)
        if (url) return { url }
      }
    }
    return undefined
  }, [sources])

  useEffect(() => {
    if (!connectedVideoInfo) {
      if (data.videoDuration != null) onUpdate({ videoDuration: undefined })
      return
    }
    // If we already have duration from metadata, use it directly
    if ("durationSeconds" in connectedVideoInfo) {
      const dur = Math.floor(connectedVideoInfo.durationSeconds!)
      if (dur !== data.videoDuration) onUpdate({ videoDuration: dur })
      return
    }
    // Fallback: load video metadata from URL
    const video = document.createElement("video")
    video.preload = "metadata"
    video.src = connectedVideoInfo.url!
    video.onloadedmetadata = () => {
      if (video.duration && video.duration !== Infinity && isFinite(video.duration)) {
        const dur = Math.floor(video.duration)
        if (dur !== data.videoDuration) onUpdate({ videoDuration: dur })
      }
    }
    return () => { video.onloadedmetadata = null; video.src = "" }
  }, [connectedVideoInfo])

  // Fail-safe (Provider Enum Sync step 12b): when the provider changes, snap a
  // stale resolution to a valid option for the NEW provider. wan-animate
  // exposes 480p/580p/720p; kling exposes 720p/1080p. Without this, a value set
  // under one provider (e.g. 1080p on Kling) persists after switching to
  // wan-animate — the dropdown hides it but the stale value is still forwarded.
  // The route enum is the union of both sets so it won't 400, but an
  // unsupported resolution would otherwise reach the model. Mirrors
  // ImageToVideoConfig / LipSyncConfig.
  useEffect(() => {
    const isWanAnimate = provider === "wan-animate-move" || provider === "wan-animate-replace"
    const valid: readonly string[] = isWanAnimate ? ["480p", "580p", "720p"] : ["720p", "1080p"]
    if (data.resolution && !valid.includes(data.resolution)) {
      onUpdate({ resolution: valid[0] as MotionTransferData["resolution"] })
    }
  }, [provider]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <ModelSearchSelect
          value={provider}
          onChange={(v) => onUpdate({ provider: v as MotionTransferData["provider"] })}
          options={MOTION_TRANSFER_MODELS}
          ariaLabel="Provider"
        />
      </MappableField>
      <MappableField field="prompt" label="Prompt (Optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
        <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => onUpdate({ prompt: v.slice(0, VIDEO_PROMPT_MAX) })} target="prompt" media="video" />
        <PromptHelperButton nodeType="motion-transfer" currentPrompt={data.prompt || ""} provider={data.provider} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — node has no prompt yet"
            minHeightRem={2 * 1.5}
          />
        ) : (
          <>
            <TagTextarea
              value={data.prompt}
              onChange={(v) => onUpdate({ prompt: v.slice(0, VIDEO_PROMPT_MAX) })}
              placeholder="Optional: Describe the motion transfer..."
              rows={2}
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
              snippets={promptSnippets}
            />
            <PromptLengthCounter value={data.prompt} max={getMaxVideoPromptChars(provider)} modelLabel={provider} />
          </>
        )}
      </MappableField>
      {/* Negative Prompt — always visible. Kling 2.6/3.0 send it natively as
          `negative_prompt`; Wan Animate gets it appended to the prompt as
          "Avoid: …" by the backend helper. */}
      <MappableField field="negativePrompt" label="Negative Prompt (Optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={negativeFieldMode.mode} onToggle={negativeFieldMode.toggle} />
        <SnippetMenuButton pool={negativeSnippets} value={data.negativePrompt ?? ""} onInsert={(v) => onUpdate({ negativePrompt: v.slice(0, VIDEO_PROMPT_MAX) })} target="negative" media="video" />
      </span>}>
        {negativeFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.negativeSegments}
            plainText={finalPrompt.negativeText}
            placeholder="Final negative prompt preview — nothing to avoid yet"
            routingCaption={negativeRoutingCaption(finalPrompt.negativeRouting)}
            minHeightRem={2 * 1.5}
          />
        ) : (
          <>
            <TagTextarea
              value={data.negativePrompt ?? ""}
              onChange={(v) => onUpdate({ negativePrompt: v.slice(0, VIDEO_PROMPT_MAX) })}
              placeholder="Optional: Describe what to avoid…"
              rows={2}
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
              snippets={negativeSnippets}
            />
            <PromptLengthCounter value={data.negativePrompt} max={getMaxNegativePromptChars(provider)} modelLabel={provider} noun="negative prompt" />
          </>
        )}
      </MappableField>
      {provider !== "wan-animate-move" && provider !== "wan-animate-replace" && (
        <MappableField field="characterOrientation" label="Character Orientation" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Select
            value={data.characterOrientation || "video"}
            onValueChange={(v) => onUpdate({ characterOrientation: v as MotionTransferData["characterOrientation"] })}
          >
            <SelectTrigger aria-label="Character Orientation"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="image">Image (same as picture{provider === "kling" ? ", max 10s" : ""})</SelectItem>
              <SelectItem value="video">Video (consistent with video{provider === "kling" ? ", max 30s" : ""})</SelectItem>
            </SelectContent>
          </Select>
        </MappableField>
      )}
      {provider === "kling-3.0" && (
        <MappableField field="backgroundSource" label="Background Source" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Select
            value={data.backgroundSource || "input_video"}
            onValueChange={(v) => onUpdate({ backgroundSource: v as MotionTransferData["backgroundSource"] })}
          >
            <SelectTrigger aria-label="Background Source"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="input_video">Input Video</SelectItem>
              <SelectItem value="input_image">Input Image</SelectItem>
            </SelectContent>
          </Select>
        </MappableField>
      )}
      <MappableField field="resolution" label="Resolution" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.resolution || (provider === "wan-animate-move" || provider === "wan-animate-replace" ? "480p" : "720p")}
          onValueChange={(v) => onUpdate({ resolution: v as MotionTransferData["resolution"] })}
        >
          <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
          <SelectContent>
            {provider === "wan-animate-move" || provider === "wan-animate-replace" ? (
              <>
                <SelectItem value="480p">480p</SelectItem>
                <SelectItem value="580p">580p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
              </>
            ) : (
              <>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
      </MappableField>
      {data.videoDuration != null && (
        <p className="text-xs text-muted-foreground px-1">
          ~{data.videoDuration}s video detected. Cost scales with duration.
        </p>
      )}
      <p className="text-xs text-muted-foreground px-1">
        {({ "kling-3.0": "Uses Kling 3.0 Motion Control. Connect image and video inputs.",
           "wan-animate-move": "Moves character from image within the video scene (~1s output).",
           "wan-animate-replace": "Replaces character in video with character from image (~1s output).",
        } as Record<string, string>)[provider] ?? "Uses Kling 2.6 Motion Control. Connect image and video inputs."}
      </p>

      {/* Unified injected-references list — surfaces wired character canonicals
          + @-mention variants from the optional motion prompt. */}
      <InjectedReferenceList
        connectedReferences={toConnectedReferences(buildVideoRefAutocomplete(sources))}
        prompt={data.prompt || ""}
        referenceOrder={data.referenceOrder}
        suppressedCanonicalCharacterIds={data.suppressedCanonicalCharacterIds}
        onUpdateReferenceOrder={(order) => onUpdate({ referenceOrder: order })}
        onRemoveWiredSource={
          nodeId
            ? makeRemoveWiredSource(
                nodeId,
                edges ?? [],
                useWorkflowStore.getState().deleteEdge,
              )
            : undefined
        }
        onRemoveMention={(token) => onUpdate({ prompt: removeMentionToken(data.prompt || "", token) })}
        onSuppressCanonical={(slug) =>
          onUpdate({ suppressedCanonicalCharacterIds: appendSuppressedSlug(data.suppressedCanonicalCharacterIds, slug) })
        }
        label="Injected references"
      />
      <SeedanceReferenceTip provider={data.provider} />
    </div>
  )
}

export const MotionTransferConfig = memo(MotionTransferConfigImpl)

export function VideoUpscaleConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs }: ConfigProps<VideoUpscaleData>) {
  // Topaz uses the "topaz-video" credit row (NOT the "topaz" processing
  // row, which is 1 CR for image processing). Backend route maps the
  // selector → identifier in upscaleCreditModel(); we mirror it here so
  // the dropdown labels show what's actually charged.
  useEffect(() => { prefetchModelCredits(["veo-1080p", "veo-4k", "topaz-video"]) }, [])
  const provider = data.provider || "topaz"
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={provider}
          onValueChange={(v) => onUpdate({ provider: v as VideoUpscaleData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="topaz">{`Topaz factor-based (${getCachedCredits("topaz-video") ?? 19} CR)`}</SelectItem>
            <SelectItem value="veo-1080p">{`VEO 1080p (${getCachedCredits("veo-1080p") ?? 2} CR)`}</SelectItem>
            <SelectItem value="veo-4k">{`VEO 4K (${getCachedCredits("veo-4k") ?? 38} CR)`}</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>

      {provider === "topaz" && (
        <MappableField field="upscaleFactor" label="Upscale Factor" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Select
            value={data.upscaleFactor || "2"}
            onValueChange={(v) => onUpdate({ upscaleFactor: v as VideoUpscaleData["upscaleFactor"] })}
          >
            <SelectTrigger aria-label="Upscale Factor"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1x (no upscale, AI enhance only)</SelectItem>
              <SelectItem value="2">2x (recommended)</SelectItem>
              <SelectItem value="4">4x (maximum)</SelectItem>
            </SelectContent>
          </Select>
        </MappableField>
      )}

      <p className="text-xs text-muted-foreground px-1">
        {provider === "topaz"
          ? "Uses Topaz Video Upscaler. Max 50MB input video."
          : "Upscales a VEO video to higher resolution. Connect an upstream VEO video node."}
      </p>
    </div>
  )
}

function TextToVideoConfigImpl({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<TextToVideoData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("video", "prompt")
  const negativeSnippets = useSnippetPool("video", "negative")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const negativeFieldMode = usePromptFieldMode(nodeId ?? "", "negativePrompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    negativePrompt: data.negativePrompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
    negativeSnippets,
    // Video negative-routing prediction — matches this panel's effective provider.
    videoProvider: data.provider || "seedance-2-fast",
  })
  useEffect(() => { prefetchModelCredits(VIDEO_T2V_MODELS.map((m) => m.value)) }, [])
  const currentProvider = data.provider || "seedance-2-fast"
  const allowedDurations = KIE_T2V_DURATIONS[currentProvider] || null
  const isSeedance2 = isSeedance2Provider(currentProvider)

  // Fail-safe: keep `data.resolution` and `data.duration` consistent with
  // the current provider's valid sets, or clear/snap when invalid.
  // See ImageToVideoConfig for the rationale.
  // Note: reads from VIDEO_DURATION_OPTIONS (not KIE_T2V_DURATIONS) so
  // providers spliced in outside MODEL_CATALOG (LTX 2.3) are also covered.
  useEffect(() => {
    const updates: Partial<TextToVideoData> = {}
    const opts = getVideoResolutionOptions(currentProvider)
    if (opts) {
      if (data.resolution && !opts.some((o) => o.value === data.resolution)) {
        updates.resolution = opts[0]?.value
      }
    } else if (data.resolution !== undefined) {
      updates.resolution = undefined
    }
    const baseDurations = VIDEO_DURATION_OPTIONS[currentProvider]?.map((o) => o.value) ?? null
    if (baseDurations && data.duration && !baseDurations.includes(data.duration)) {
      updates.duration = baseDurations[0]
    }
    // Aspect ratio — snap a stale EXPLICIT value (Seedance "adaptive"/"21:9"/
    // "4:3"/"3:4") to the new provider's first valid option. See ImageToVideo
    // for the rationale; data-driven off the dropdown's own option source.
    const aspectOpts = getAspectRatiosForVideoModel(currentProvider)
    if (data.aspectRatio && !aspectOpts.some((o) => o.value === data.aspectRatio)) {
      updates.aspectRatio = aspectOpts[0]?.value as TextToVideoData["aspectRatio"]
    }
    if (Object.keys(updates).length > 0) {
      onUpdate(updates)
    }
  }, [currentProvider]) // eslint-disable-line react-hooks/exhaustive-deps

  const T2V_IMAGE_TYPES = ["generate-image", "upload-image", "character", "object", "location", "edit-image", "image-to-image", "scene"]

  const connectedRefImages = useMemo(() => {
    return sources.filter((s) => T2V_IMAGE_TYPES.includes(s.type)).map((s) => ({
      id: s.id, type: s.type, label: s.label, imageUrl: getSourceThumbnail(s),
    }))
  }, [sources])
  // Same filter as `connectedRefImages` above but kept as the original
  // SourceNodeInfo shape — passed straight into `<ConnectedMediaList>` for
  // drag-to-reorder. Without explicit ordering, the positional Image-N
  // letters in the assembled t2v prompt are assigned by upstream edge order
  // (which the user has no control over).
  const refSources = useMemo(
    () => sources.filter((s) => T2V_IMAGE_TYPES.includes(s.type)),
    [sources],
  )

  const connectedRefVideos = useMemo(
    () => sources.filter((s) => s.targetHandle === "reference-videos"),
    [sources],
  )
  const connectedRefAudio = useMemo(
    () => sources.filter((s) => s.targetHandle === "reference-audio"),
    [sources],
  )

  // Character @-mention autocomplete: wired-character upstreams expand into
  // canonical + per-variant entries (mirrors image-configs.tsx Task 6 + 8b3b3c13).
  const refImagesForAutocomplete = useMemo<RefImageItem[]>(
    () => [
      // Image refs (frame-excluded) first, then the independently-numbered
      // reference-VIDEO + reference-AUDIO items — full {image:N}/{video:N}/
      // {audio:N} parity with the inline/modal surface (usePromptEditorRefs).
      // The video/audio builders self-gate on referenceModalityForHandle, so
      // they yield [] for panels with no such handle wired (no-op there).
      ...toRefImageItems(buildVideoRefAutocomplete(sources)),
      ...buildVideoRefVideoAutocomplete(sources),
      ...buildVideoRefAudioAutocomplete(sources),
    ],
    [sources],
  )

  if (data.provider === "kling-3.0") {
    return <Suspense fallback={null}><Kling3StudioConfig data={data as unknown as ImageToVideoData} onUpdate={onUpdate} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} nodes={nodes} /></Suspense>
  }

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <ModelSearchSelect
          value={currentProvider}
          onChange={(v) => onUpdate({ provider: v })}
          options={VIDEO_T2V_MODELS}
          getTooltip={getVideoModelCapabilitiesTooltip}
          ariaLabel="Provider"
        />
      </MappableField>
      <ModelDescriptionHint modelId={currentProvider} />
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
        <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => onUpdate({ prompt: v })} target="prompt" media="video" />
        <PromptHelperButton nodeType="text-to-video" currentPrompt={data.prompt || ""} provider={currentProvider} duration={data.duration} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — node has no prompt yet"
            minHeightRem={3 * 1.5}
          />
        ) : (
          <>
            <PromptEditor
              rows={3}
              value={data.prompt}
              onChange={(v) => onUpdate({ prompt: v })}
              placeholder="Describe the video to generate..."
              referenceImages={refImagesForAutocomplete}
              nodeRefs={nodeRefs}
              refMap={refMap}
              snippets={promptSnippets}
            />
            <PromptLengthCounter value={data.prompt} max={getMaxVideoPromptChars(currentProvider)} modelLabel={currentProvider} />
          </>
        )}
      </MappableField>
      <ExtraRefsSection
        extraRefs={data.extraRefs}
        onChange={(next) => onUpdate({ extraRefs: next })}
        consumerNodeId={nodeId}
        nodes={nodes}
        edges={edges ?? []}
      />

      {/* Unified injected-references list — surfaces wired character canonicals
          AND @-mention variants that the prompt-builder will resolve. */}
      <InjectedReferenceList
        connectedReferences={toConnectedReferences(buildVideoRefAutocomplete(sources))}
        prompt={data.prompt || ""}
        referenceOrder={data.referenceOrder}
        suppressedCanonicalCharacterIds={data.suppressedCanonicalCharacterIds}
        onUpdateReferenceOrder={(order) => onUpdate({ referenceOrder: order })}
        onRemoveWiredSource={
          nodeId
            ? makeRemoveWiredSource(
                nodeId,
                edges ?? [],
                useWorkflowStore.getState().deleteEdge,
              )
            : undefined
        }
        onRemoveMention={(token) => onUpdate({ prompt: removeMentionToken(data.prompt || "", token) })}
        onSuppressCanonical={(slug) =>
          onUpdate({ suppressedCanonicalCharacterIds: appendSuppressedSlug(data.suppressedCanonicalCharacterIds, slug) })
        }
        label="Injected references"
      />
      <SeedanceReferenceTip provider={data.provider} />

      <MappableField field="duration" label="Duration (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        {allowedDurations ? (
          <Select
            value={String(allowedDurations.includes(data.duration) ? data.duration : allowedDurations[0])}
            onValueChange={(v) => onUpdate({ duration: parseInt(v, 10) })}
          >
            <SelectTrigger aria-label="Duration (seconds)"><SelectValue /></SelectTrigger>
            <SelectContent>
              {allowedDurations.map((d) => (
                <SelectItem key={d} value={String(d)}>{d} seconds</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            type="number"
            min={1}
            max={30}
            value={data.duration ?? ""}
            onChange={(e) => onUpdate({ duration: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
          />
        )}
      </MappableField>
      {allowedDurations && allowedDurations.length === 1 && (
        <p className="text-xs text-muted-foreground px-1">
          {`${data.provider || "This provider"} produces ~${allowedDurations[0]} second videos.`}
        </p>
      )}
      {(data.provider === "veo3" || data.provider === "veo3.1" || data.provider === "veo3_lite") && (
        <>
          {(() => {
            const opts = getVideoResolutionOptions(currentProvider)
            return opts && opts.length > 0 ? (
              <div>
                <Label className="text-xs">Resolution</Label>
                <Select
                  value={(data.resolution as string) || opts[0].value}
                  onValueChange={(v) => onUpdate({ resolution: v })}
                >
                  <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {opts.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  4K generates the base at 1080p, then upscales to 4K automatically in the same run (billed at the 4K rate).
                </p>
              </div>
            ) : null
          })()}
          <div>
            <Label className="text-xs">Seed (optional)</Label>
            <Input
              type="number"
              min={10000}
              max={99999}
              placeholder="10000–99999"
              value={data.seed ?? ""}
              onChange={(e) => onUpdate({ seed: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
            />
            <p className="text-[10px] text-muted-foreground mt-1">Same seed produces similar results. Leave empty for random.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 px-1">
              <input
                type="checkbox"
                id="t2v-enableTranslation"
                checked={data.enableTranslation !== false}
                onChange={(e) => onUpdate({ enableTranslation: e.target.checked })}
                className="rounded border-muted-foreground/40"
              />
              <label htmlFor="t2v-enableTranslation" className="text-xs">Auto-translate prompt to English</label>
            </div>
            <p className="text-xs text-muted-foreground px-1">
              Prompts are auto-translated to English before VEO sees them (default on). Disable to keep prompts verbatim.
            </p>
          </div>
        </>
      )}
      {data.provider === "kling" && (
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="t2vKlingSound"
            checked={(data as Record<string, unknown>).kling3Sound !== false}
            onChange={(e) => onUpdate({ kling3Sound: e.target.checked })}
            className="rounded border-muted-foreground/40"
          />
          <label htmlFor="t2vKlingSound" className="text-xs">Enable Sound</label>
        </div>
      )}

      {data.provider === "kling-turbo" && (
        <div>
          <Label className="text-xs">CFG Scale ({String((data as Record<string, unknown>).cfgScale ?? 0.5)})</Label>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={((data as Record<string, unknown>).cfgScale as number) ?? ""}
            onChange={(e) => onUpdate({ cfgScale: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">0 = creative, 1 = strict prompt adherence</p>
        </div>
      )}

      {isSeedance2 && (
        <>
          {connectedRefImages.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Reference Images ({connectedRefImages.length}/{SEEDANCE_2_REF_LIMITS.images})</Label>
              <ConnectedMediaList
                sources={refSources}
                mediaOrder={data.connectedRefImageOrder ?? []}
                onUpdateOrder={(order) => onUpdate({ connectedRefImageOrder: order })}
                mediaType="image"
              />
            </div>
          )}
          {connectedRefVideos.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Reference Videos ({connectedRefVideos.length}/{SEEDANCE_2_REF_LIMITS.videos})</Label>
              <div className="flex flex-col gap-1">
                {connectedRefVideos.map((s) => (
                  <div key={s.id} className="text-[10px] px-2 py-1 rounded bg-muted/50 text-muted-foreground truncate">
                    {s.label}
                  </div>
                ))}
              </div>
            </div>
          )}
          {connectedRefAudio.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Reference Audio ({connectedRefAudio.length}/{SEEDANCE_2_REF_LIMITS.audio})</Label>
              <div className="flex flex-col gap-1">
                {connectedRefAudio.map((s) => (
                  <div key={s.id} className="text-[10px] px-2 py-1 rounded bg-muted/50 text-muted-foreground truncate">
                    {s.label}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <Label className="text-xs">Resolution</Label>
            <Select
              value={(data.resolution as string) || "480p"}
              onValueChange={(v) => onUpdate({ resolution: v })}
            >
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                {/* Catalog-driven: seedance-2/-fast expose 480p/720p/1080p; seedance-2-mini 480p/720p */}
                {(getVideoResolutionOptions(currentProvider) ?? []).map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="seedance2T2VAudio"
              checked={(data.generateAudio as boolean | undefined) ?? true}
              onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="seedance2T2VAudio" className="text-xs">Generate Audio (default on)</label>
          </div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="seedance2T2VWebSearch"
              checked={(data.webSearch as boolean | undefined) || false}
              onChange={(e) => onUpdate({ webSearch: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="seedance2T2VWebSearch" className="text-xs">Enable Web Search</label>
          </div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="seedance2T2VNsfw"
              checked={(data.nsfwChecker as boolean | undefined) || false}
              onChange={(e) => onUpdate({ nsfwChecker: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="seedance2T2VNsfw" className="text-xs">NSFW Content Filter</label>
          </div>
        </>
      )}

      {/* Seedance defaults to adaptive (preview = run, matching execute-node's
          effectiveT2vAspect); non-Seedance keeps no default → undefined, so the run
          still sends undefined (provider's own default) rather than a 16:9 the run
          wouldn't send. */}
      <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <AspectRatioSelector
          options={isSeedance2 ? SEEDANCE_2_VIDEO_RATIOS : VIDEO_RATIOS}
          value={data.aspectRatio || (isSeedance2 ? defaultVideoAspectRatio(currentProvider) : undefined)}
          onValueChange={(v) => onUpdate({ aspectRatio: v as TextToVideoData["aspectRatio"] })}
        />
      </MappableField>
      <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={negativeFieldMode.mode} onToggle={negativeFieldMode.toggle} />
        <SnippetMenuButton pool={negativeSnippets} value={data.negativePrompt || ""} onInsert={(v) => onUpdate({ negativePrompt: v })} target="negative" media="video" />
      </span>}>
        {negativeFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.negativeSegments}
            plainText={finalPrompt.negativeText}
            placeholder="Final negative prompt preview — nothing to avoid yet"
            routingCaption={negativeRoutingCaption(finalPrompt.negativeRouting)}
            minHeightRem={2 * 1.5}
          />
        ) : (
          <>
            <TagTextarea
              rows={2}
              value={data.negativePrompt}
              onChange={(v) => onUpdate({ negativePrompt: v })}
              placeholder="Things to avoid..."
              nodeRefs={nodeRefs}
              referenceImages={refImagesForAutocomplete}
              displayMode={variableDisplayMode}
              refMap={refMap}
              snippets={negativeSnippets}
            />
            <PromptLengthCounter value={data.negativePrompt} max={getMaxNegativePromptChars(currentProvider)} modelLabel={currentProvider} noun="negative prompt" />
          </>
        )}
      </MappableField>

      <ConnectedCinematographySources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
    </div>
  )
}

export const TextToVideoConfig = memo(TextToVideoConfigImpl)

// ---------------------------------------------------------------------------
// GenerateVideoConfig — unified i2v + t2v configuration panel for the
// `generate-video` node (Task 7.2). Renders the structural superset of the
// legacy ImageToVideoConfig + TextToVideoConfig controls, gated by the chosen
// provider. The runtime path re-dispatches generate-video as i2v or t2v based
// on whether an upstream image is wired (see execute-node.ts ~line 2014); the
// config here just exposes every lever the chosen provider supports.
//
// Differences vs legacy i2v/t2v configs:
//   - Provider dropdown uses VIDEO_GEN_MODELS (i2v ∪ t2v) instead of the
//     per-mode sets.
//   - Duration map: VIDEO_DURATION_OPTIONS — merged i2v + t2v per provider.
//   - Reference handle ids match generate-video-handle-migration.ts:
//     "imageReferences" / "videoReferences" / "audioReferences"
//     (legacy nodes had "references" / "reference-videos" / "reference-audio").
//   - Reference image ordering uses `data.referenceImageOrder` (legacy was
//     `connectedRefImageOrder`).
//   - Kling 3.0 dispatches to Kling3StudioConfig (same as i2v/t2v).
// ---------------------------------------------------------------------------
function GenerateVideoConfigImpl({ data: rawData, onUpdate: rawOnUpdate, sources, fieldMappings, onMapField, nodes, edges, onUpdateNode, variableDisplayMode, nodeId }: ConfigProps<GenerateVideoNodeData> & { nodeId?: string }) {
  // Single source for the prompt editor's @-refs / variables / snippets — shared
  // with the inline canvas editor + quick-edit modal so they never drift. Supplies
  // referenceImages (was the local refImagesForAutocomplete via buildVideoRefAutocomplete;
  // the hook's buildImageConnectedReferences is the validated superset and also
  // surfaces video extraRefs), nodeRefs, refMap (were function props), and
  // promptSnippets (was useSnippetPool("video","prompt")).
  const { referenceImages, nodeRefs, refMap, promptSnippets } = usePromptEditorRefs(nodeId ?? "")
  const negativeSnippets = useSnippetPool("video", "negative")
  useEffect(() => { prefetchModelCredits(VIDEO_GEN_MODELS.map((m) => m.value)) }, [])
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  // GenerateVideoNodeData is structurally `ImageToVideoData & TextToVideoData`
  // (with Omits to resolve conflicts) — but the Omit×2 intersection collapses
  // field types into `{}` for TypeScript's narrowing. Treat the data as
  // ImageToVideoData + the generate-video-only `referenceImageOrder` field
  // here since the i2v shape is the structural superset that covers every
  // control rendered below. The unified provider type is widened separately
  // via `currentProvider`. This mirrors the t2v config which casts
  // GenerateVideoNodeData → ImageToVideoData when dispatching to Kling3Studio.
  type DataView = ImageToVideoData & { referenceImageOrder?: readonly string[] }
  const data = rawData as unknown as DataView
  const onUpdate = rawOnUpdate as unknown as (u: Partial<DataView>) => void

  // Per-field Edit⇄Final toggle (provider-less path — preserves the prior
  // provider-less preview behavior; no buildImagePrompt upgrade in this task
  // even though `currentProvider` is in scope — kept tight per spec).
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const negativeFieldMode = usePromptFieldMode(nodeId ?? "", "negativePrompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    negativePrompt: data.negativePrompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
    negativeSnippets,
    // Video negative-routing prediction — matches this panel's effective provider
    // (the unified node's `currentProvider`, resolved by image presence at run).
    videoProvider: (rawData.provider || "seedance-2-fast") as string,
  })

  const currentProvider = (rawData.provider || "seedance-2-fast") as string

  // A wired-in Character enables the optional "save result to character"
  // control — the finished clip is appended to that character's
  // reference_videos_by_variant on completion (see
  // ImageToVideoData.attachReferenceVideoVariant). Hidden when no Character is
  // connected (the attach has nowhere to go).
  const connectedCharacter = useMemo(
    () => sources.find((s) => s.type === "character"),
    [sources],
  )

  // Fail-safe: snap stale resolution + duration + fps values that don't apply
  // to the current provider. Same Provider-Enum-Sync step-12b pattern as
  // i2v/t2v — without this, persisted values + admin defaults leak across
  // provider changes and trigger backend Zod enum rejections at generate-time.
  useEffect(() => {
    const updates: Partial<ImageToVideoData> & { fps?: unknown } = {}
    const opts = getVideoResolutionOptions(currentProvider)
    if (opts) {
      if (data.resolution && !opts.some((o) => o.value === data.resolution)) {
        updates.resolution = opts[0]?.value
      }
    } else if (data.resolution !== undefined) {
      updates.resolution = undefined
    }
    const baseDurations = VIDEO_DURATION_OPTIONS[currentProvider]?.map((o) => o.value) ?? null
    if (baseDurations && data.duration && !baseDurations.includes(data.duration)) {
      updates.duration = baseDurations[0]
    }
    // fps lever — only providers in VIDEO_FPS_OPTIONS (LTX 2.3 Pro/Fast today)
    // expose fps. Snap or clear when switching providers so stale values from
    // LTX don't leak into providers without an fps lever.
    const fpsOpts = VIDEO_FPS_OPTIONS[currentProvider]
    const currentFps = data.fps as number | undefined
    if (fpsOpts) {
      if (currentFps !== undefined && !fpsOpts.some((o) => o.value === currentFps)) {
        updates.fps = fpsOpts[0]?.value
      }
    } else if (currentFps !== undefined) {
      updates.fps = undefined
    }
    // Aspect ratio — snap a stale EXPLICIT value to the new provider's first
    // valid option whenever it isn't in that provider's set. Data-driven off the
    // dropdown's own option source (no hardcoded provider list), so it covers
    // Gemini Omni's 16:9/9:16-only set AND Seedance's wider set ("adaptive",
    // "21:9", "4:3", "3:4") leaking into a provider that lacks them — preventing
    // a backend Zod reject at generate-time. Providers whose set includes the
    // value (e.g. VEO's "Auto") are left untouched; an unset value stays unset.
    const aspectOpts = getAspectRatiosForVideoModel(currentProvider)
    if (data.aspectRatio && !aspectOpts.some((o) => o.value === data.aspectRatio)) {
      updates.aspectRatio = aspectOpts[0]?.value as ImageToVideoData["aspectRatio"]
    }
    if (currentProvider === "gemini-omni-video") {
      // Persist the 8s default when duration is unset so the dropdown, the credit
      // identifier, and the KIE payload all agree (the credit id + provider both
      // default to 8 when undefined, while the dropdown would otherwise show the
      // first option, 4s). The generic snap above handles non-tier values (e.g. 5→4).
      if (data.duration == null) {
        updates.duration = 8
      }
    }
    if (Object.keys(updates).length > 0) {
      onUpdate(updates as Partial<ImageToVideoData>)
    }
  }, [currentProvider]) // eslint-disable-line react-hooks/exhaustive-deps

  // LTX 2.3 Fast: when duration > 10s, the model only supports 1080p output at
  // 24 or 25 fps. Snap resolution + fps when the user lands in that band so
  // backend Zod doesn't reject the stale 2k/4k/48/50 values that were valid at
  // shorter durations. Runs on both provider AND duration changes — the
  // constraint depends on duration so the provider-only effect above can't
  // catch the case where the user bumps duration from 8s -> 16s while on Fast.
  const currentDuration = data.duration
  useEffect(() => {
    if (currentProvider !== "ltx-2.3-fast") return
    if (currentDuration === undefined || currentDuration <= 10) return
    const updates: Partial<ImageToVideoData> & { fps?: unknown } = {}
    if (data.resolution !== "1080p") {
      updates.resolution = "1080p"
    }
    const currentFps = data.fps as number | undefined
    if (currentFps !== undefined && currentFps !== 24 && currentFps !== 25) {
      updates.fps = 25
    }
    if (Object.keys(updates).length > 0) {
      onUpdate(updates as Partial<ImageToVideoData>)
    }
  }, [currentProvider, currentDuration]) // eslint-disable-line react-hooks/exhaustive-deps

  const baseDurations = VIDEO_DURATION_OPTIONS[currentProvider]?.map((o) => o.value) ?? null
  // Hailuo 2.3 Pro/Standard: 1080P only supports 6s duration
  const allowedDurations = baseDurations && (currentProvider === "hailuo-2.3-pro" || currentProvider === "hailuo-2.3") && data.resolution === "1080P"
    ? baseDurations.filter((d) => d <= 6)
    : baseDurations
  const supportsEndFrame = PROVIDERS_WITH_END_FRAME.includes(currentProvider)
  const supportsReferences = PROVIDERS_WITH_REFERENCES.includes(currentProvider)
  const isVeo = currentProvider === "veo3" || currentProvider === "veo3.1" || currentProvider === "veo3_lite"
  const isVeoRefMode = isVeo && data.veoMode === "reference"
  const isSeedance2 = isSeedance2Provider(currentProvider)

  const connectedImages = useMemo(() => {
    const imageTypes = ["generate-image", "upload-image", "character", "object", "location", "edit-image", "image-to-image", "scene"]
    return sources.filter((s) => imageTypes.includes(s.type) && s.targetHandle !== "imageReferences").map((s) => {
      let displayLabel = s.label
      if (s.targetHandle === "startFrame") {
        displayLabel = `Start: ${s.label}`
      } else if (s.targetHandle === "endFrame") {
        displayLabel = `End: ${s.label}`
      }

      return {
        id: s.id,
        type: s.type,
        label: displayLabel,
        imageUrl: getSourceThumbnail(s),
        targetHandle: s.targetHandle,
      }
    })
  }, [sources])

  const connectedRefImages = useMemo(() => {
    return sources.filter((s) => s.targetHandle === "imageReferences").map((s) => ({
      id: s.id, type: s.type, label: s.label, imageUrl: getSourceThumbnail(s),
    }))
  }, [sources])

  // Sources wired specifically into the `imageReferences` handle. Pre-filtered
  // here so `<ConnectedMediaList>` only sees (and reorders) the reference-image
  // connections — start/end frame edges live in their own pre-existing media
  // list above and have their own ordering field.
  const refSources = useMemo(
    () => sources.filter((s) => s.targetHandle === "imageReferences"),
    [sources],
  )

  // Seedance-2 reference video / audio sources (t2v-only on the legacy node;
  // generate-video accepts them under the renamed handle ids).
  const connectedRefVideos = useMemo(
    () => sources.filter((s) => s.targetHandle === "videoReferences"),
    [sources],
  )
  const connectedRefAudio = useMemo(
    () => sources.filter((s) => s.targetHandle === "audioReferences"),
    [sources],
  )

  // Gemini Omni shares a 7-unit input budget: images (1 each) + startFrame (1) +
  // videos (2 each) ≤ 7. Surface the remaining image budget in the label and an
  // over-quota warning below, so the user isn't surprised by the runtime rejection.
  const geminiVideoCount = connectedRefVideos.length
  const geminiHasStartFrame = connectedImages.some((i) => i.targetHandle === "startFrame")
  const geminiQuotaUsed = (geminiHasStartFrame ? 1 : 0) + connectedRefImages.length + geminiVideoCount * 2
  const geminiQuotaExceeded = currentProvider === "gemini-omni-video" && geminiQuotaUsed > 7
  const maxRefImages = currentProvider === "grok-i2v" ? 6 : currentProvider === "kling-3-omni" ? 7 : currentProvider === "gemini-omni-video" ? Math.max(0, 7 - geminiVideoCount * 2 - (geminiHasStartFrame ? 1 : 0)) : 3

  const hasEndFrame = connectedImages.some((img) => img.targetHandle === "endFrame")

  if (currentProvider === "kling-3.0") {
    return <Suspense fallback={null}><Kling3StudioConfig data={data as unknown as ImageToVideoData} onUpdate={onUpdate as (u: Partial<ImageToVideoData>) => void} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} nodes={nodes} edges={edges} onUpdateNode={onUpdateNode} nodeId={nodeId} /></Suspense>
  }

  return (
    <div className="flex flex-col gap-3">
      {connectedImages.length > 0 && (
        <ConnectedMediaList
          sources={sources}
          mediaOrder={data.connectedImageOrder ?? []}
          onUpdateOrder={(order) => onUpdate({ connectedImageOrder: order })}
          acceptedTypes={new Set(["generate-image", "upload-image", "character", "object", "location", "edit-image", "image-to-image", "scene"])}
          mediaType="image"
          primaryLabel="Start Frame"
        />
      )}

      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <ModelSearchSelect
          value={currentProvider}
          onChange={(v) => onUpdate({ provider: v as ImageToVideoData["provider"] })}
          options={VIDEO_GEN_MODELS}
          getTooltip={getVideoModelCapabilitiesTooltip}
          ariaLabel="Provider"
        />
      </MappableField>
      <ModelDescriptionHint modelId={currentProvider} />

      {/* Seedance 2 resolved-mode indicator — the backend resolver
          (resolveSeedance2Inputs) decides frames-vs-references from the
          connected inputs at run time, so the panel only DISPLAYS the
          resolved mode + the prompt directive it appends. Mirror of the
          indicator in ImageToVideoConfigImpl. */}
      {isSeedance2 && (() => {
        const s2 = resolveSeedance2Inputs({
          firstFrameUrl: connectedImages.some((img) => img.targetHandle !== "endFrame") ? "first" : undefined,
          lastFrameUrl: hasEndFrame ? "last" : undefined,
          refImageUrls: Array.from({ length: connectedRefImages.length }, (_, i) => `r${i}`),
          refVideoUrls: Array.from({ length: connectedRefVideos.length }, (_, i) => `v${i}`),
          refAudioUrls: Array.from({ length: connectedRefAudio.length }, (_, i) => `a${i}`),
        })
        const label = s2.mode === "reference"
          ? "Reference — frames used as prompt-directed references"
          : s2.mode === "first-last-frame" ? "First + Last Frame (exact)" : "First Frame (exact)"
        return (
          <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 p-2">
            <span className="text-[11px] font-medium text-foreground">Mode: {label}</span>
            {s2.promptSuffix && (
              <span className="text-[10px] leading-snug text-muted-foreground">
                Appended to prompt: “{s2.promptSuffix}”
              </span>
            )}
            {s2.droppedRefImages > 0 && (
              <span className="text-[10px] leading-snug text-amber-500">
                {s2.droppedRefImages} reference image{s2.droppedRefImages > 1 ? "s" : ""} over the 9-image limit will be dropped (frames kept).
              </span>
            )}
          </div>
        )
      })()}

      {/* VEO mode toggle */}
      {isVeo && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Generation Mode</Label>
          <Select value={data.veoMode || "frame-to-frame"} onValueChange={(v) => onUpdate({ veoMode: v as "frame-to-frame" | "reference" })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="frame-to-frame">Frame-to-Frame</SelectItem>
              <SelectItem value="reference">Reference Mode</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground px-1">
            {isVeoRefMode
              ? "Reference mode uses 1-3 reference images to guide generation (not as start/end frames)."
              : "Frame-to-frame mode uses start and optional end frame images."}
          </p>
        </div>
      )}

      {/* Reference images section (Grok / VEO reference mode / Seedance 2). */}
      {(supportsReferences && (!isVeo || isVeoRefMode)) && connectedRefImages.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Reference Images ({connectedRefImages.length}/{isSeedance2 ? SEEDANCE_2_REF_LIMITS.images : maxRefImages})</Label>
          <ConnectedMediaList
            sources={refSources}
            mediaOrder={data.referenceImageOrder ?? []}
            onUpdateOrder={(order) => onUpdate({ referenceImageOrder: order })}
            mediaType="image"
          />
          <p className="text-[10px] text-muted-foreground px-1">
            Connect image nodes to the References handle. Up to {isSeedance2 ? SEEDANCE_2_REF_LIMITS.images : maxRefImages} additional reference images.
          </p>
        </div>
      )}

      {/* Seedance 2 reference videos */}
      {isSeedance2 && connectedRefVideos.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Reference Videos ({connectedRefVideos.length}/{SEEDANCE_2_REF_LIMITS.videos})</Label>
          <div className="flex flex-col gap-1">
            {connectedRefVideos.map((s) => (
              <div key={s.id} className="text-[10px] px-2 py-1 rounded bg-muted/50 text-muted-foreground truncate">
                {s.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Seedance 2 reference audio */}
      {isSeedance2 && connectedRefAudio.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Reference Audio ({connectedRefAudio.length}/{SEEDANCE_2_REF_LIMITS.audio})</Label>
          <div className="flex flex-col gap-1">
            {connectedRefAudio.map((s) => (
              <div key={s.id} className="text-[10px] px-2 py-1 rounded bg-muted/50 text-muted-foreground truncate">
                {s.label}
              </div>
            ))}
          </div>
        </div>
      )}

      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
        <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => onUpdate({ prompt: v })} target="prompt" media="video" />
        <PromptHelperButton nodeType="image-to-video" currentPrompt={data.prompt || ""} provider={currentProvider} duration={data.duration} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — node has no prompt yet"
            minHeightRem={3 * 1.5}
          />
        ) : (
          <>
            <PromptEditor
              rows={3}
              value={data.prompt || ""}
              onChange={(v) => onUpdate({ prompt: v })}
              placeholder={connectedImages.length > 0 ? "Describe the motion or animation you want..." : "Describe the video to generate..."}
              referenceImages={referenceImages}
              nodeRefs={nodeRefs}
              refMap={refMap}
              snippets={promptSnippets}
            />
            <PromptLengthCounter value={data.prompt || ""} max={getMaxVideoPromptChars(currentProvider)} modelLabel={currentProvider} />
          </>
        )}
      </MappableField>

      {/* Negative Prompt — always visible. Kling family providers send it
          natively as `negative_prompt`; non-native providers get it
          appended to the prompt as "Avoid: …" by the backend helper. */}
      <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={negativeFieldMode.mode} onToggle={negativeFieldMode.toggle} />
        <SnippetMenuButton pool={negativeSnippets} value={(data as Record<string, unknown>).negativePrompt as string || ""} onInsert={(v) => onUpdate({ negativePrompt: v })} target="negative" media="video" />
      </span>}>
        {negativeFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.negativeSegments}
            plainText={finalPrompt.negativeText}
            placeholder="Final negative prompt preview — nothing to avoid yet"
            routingCaption={negativeRoutingCaption(finalPrompt.negativeRouting)}
            minHeightRem={2 * 1.5}
          />
        ) : (
          <>
            <Textarea
              rows={2}
              value={(data as Record<string, unknown>).negativePrompt as string || ""}
              onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
              placeholder="Things to avoid..."
            />
            <PromptLengthCounter value={(data as Record<string, unknown>).negativePrompt as string || ""} max={getMaxNegativePromptChars(currentProvider)} modelLabel={currentProvider} noun="negative prompt" />
          </>
        )}
      </MappableField>

      {/* Unified injected-references list */}
      <InjectedReferenceList
        connectedReferences={toConnectedReferences(buildVideoRefAutocomplete(sources))}
        prompt={data.prompt || ""}
        referenceOrder={data.referenceOrder}
        suppressedCanonicalCharacterIds={data.suppressedCanonicalCharacterIds}
        onUpdateReferenceOrder={(order) => onUpdate({ referenceOrder: order })}
        onRemoveWiredSource={
          nodeId
            ? makeRemoveWiredSource(
                nodeId,
                edges ?? [],
                useWorkflowStore.getState().deleteEdge,
              )
            : undefined
        }
        onRemoveMention={(token) => onUpdate({ prompt: removeMentionToken(data.prompt || "", token) })}
        onSuppressCanonical={(slug) =>
          onUpdate({ suppressedCanonicalCharacterIds: appendSuppressedSlug(data.suppressedCanonicalCharacterIds, slug) })
        }
        label="Injected references"
      />
      <SeedanceReferenceTip provider={data.provider} />
      <FramesAndReferencesTip
        hasFrame={connectedImages.some((img) => img.targetHandle === "startFrame" || img.targetHandle === "endFrame")}
        hasReference={connectedRefImages.length > 0}
      />

      <ExtraRefsSection
        extraRefs={data.extraRefs}
        onChange={(next) => onUpdate({ extraRefs: next })}
        consumerNodeId={nodeId}
        nodes={nodes}
        edges={edges ?? []}
      />

      {isVeo && (
        <>
          <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <AspectRatioSelector
              options={[
                { value: "Auto", label: "Auto (from image)" },
                { value: "16:9", label: "16:9 (Landscape)" },
                { value: "9:16", label: "9:16 (Portrait)" },
              ]}
              value={data.aspectRatio || "16:9"}
              onValueChange={(v) => onUpdate({ aspectRatio: v as ImageToVideoData["aspectRatio"] })}
            />
          </MappableField>
          {(() => {
            const opts = getVideoResolutionOptions(currentProvider)
            return opts && opts.length > 0 ? (
              <div>
                <Label className="text-xs">Resolution</Label>
                <Select
                  value={(data.resolution as string) || opts[0].value}
                  onValueChange={(v) => onUpdate({ resolution: v })}
                >
                  <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {opts.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  4K generates the base at 1080p, then upscales to 4K automatically in the same run (billed at the 4K rate).
                </p>
              </div>
            ) : null
          })()}
          <div>
            <Label className="text-xs">Seed (optional)</Label>
            <Input
              type="number"
              min={10000}
              max={99999}
              placeholder="10000–99999"
              value={data.seed ?? ""}
              onChange={(e) => onUpdate({ seed: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
            />
            <p className="text-[10px] text-muted-foreground mt-1">Same seed produces similar results. Leave empty for random.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 px-1">
              <input
                type="checkbox"
                id="gv-generateAudio"
                checked={data.generateAudio !== false}
                onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
                className="rounded border-muted-foreground/40"
              />
              <label htmlFor="gv-generateAudio" className="text-xs">Generate Audio</label>
            </div>
            <p className="text-xs text-muted-foreground px-1">VEO 3.1 creates AI audio from the prompt. Disable for silent video, then use Add Audio node.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 px-1">
              <input
                type="checkbox"
                id="gv-enableTranslation"
                checked={data.enableTranslation !== false}
                onChange={(e) => onUpdate({ enableTranslation: e.target.checked })}
                className="rounded border-muted-foreground/40"
              />
              <label htmlFor="gv-enableTranslation" className="text-xs">Auto-translate prompt to English</label>
            </div>
            <p className="text-xs text-muted-foreground px-1">
              Prompts are auto-translated to English before VEO sees them (default on). Disable to keep prompts verbatim — useful for non-English prompts or when exact wording matters (e.g. the perfect-loop seal phrase).
            </p>
          </div>
        </>
      )}
      <MappableField field="duration" label="Duration (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        {allowedDurations ? (
          <Select
            value={String(allowedDurations.includes(data.duration as number) ? data.duration : allowedDurations[0])}
            onValueChange={(v) => onUpdate({ duration: parseInt(v, 10) })}
            disabled={currentProvider === "gemini-omni-video" && connectedRefVideos.length > 0}
          >
            <SelectTrigger aria-label="Duration (seconds)"><SelectValue /></SelectTrigger>
            <SelectContent>
              {allowedDurations.map((d) => (
                <SelectItem key={d} value={String(d)}>{d} seconds</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            type="number"
            min={1}
            max={30}
            value={data.duration ?? ""}
            onChange={(e) => onUpdate({ duration: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
          />
        )}
      </MappableField>
      {currentProvider === "gemini-omni-video" && connectedRefVideos.length > 0 && (
        <p className="text-[11px] text-muted-foreground">Duration is set automatically from the source clip.</p>
      )}
      {allowedDurations && allowedDurations.length === 1 && (
        <p className="text-xs text-muted-foreground px-1">
          {`${currentProvider || "This provider"} produces ~${allowedDurations[0]} second videos.`}
        </p>
      )}
      {supportsEndFrame && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">End Frame (optional)</Label>
          <p className="text-xs text-muted-foreground px-1">
            Connect an image node to the &quot;End Frame&quot; handle for start-to-end frame video generation.
          </p>
        </div>
      )}
      {/* Loop trim — generic smart-loop-cut post-process */}
      <div className="flex flex-col gap-1.5 pt-2 border-t border-border">
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="gv-loopTrim-enabled"
            checked={data.loopTrim?.enabled ?? false}
            onChange={(e) => onUpdate({
              loopTrim: e.target.checked
                ? { enabled: true, framesToTest: data.loopTrim?.framesToTest ?? 16, quality: data.loopTrim?.quality ?? "precise" }
                : { enabled: false },
            })}
            className="rounded border-muted-foreground/40"
          />
          <label htmlFor="gv-loopTrim-enabled" className="text-xs">Loop trim</label>
        </div>
        {data.loopTrim?.enabled && (
          <>
            <div className="px-1">
              <label htmlFor="gv-loopTrim-frames" className="text-[10px] text-muted-foreground">
                Frames to test: {data.loopTrim.framesToTest ?? 16}
              </label>
              <input
                id="gv-loopTrim-frames"
                type="range"
                min={4}
                max={64}
                step={1}
                value={data.loopTrim.framesToTest ?? 16}
                onChange={(e) => onUpdate({
                  loopTrim: { ...data.loopTrim!, framesToTest: parseInt(e.target.value, 10) },
                })}
                className="w-full h-1.5 rounded-lg cursor-pointer accent-[#ff0073]"
              />
            </div>
            <div className="px-1">
              <label htmlFor="gv-loopTrim-quality" className="text-[10px] text-muted-foreground">Quality</label>
              <Select
                value={data.loopTrim.quality ?? "precise"}
                onValueChange={(v) => onUpdate({
                  loopTrim: { ...data.loopTrim!, quality: v as "lossless" | "precise" },
                })}
              >
                <SelectTrigger id="gv-loopTrim-quality" className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="precise">Precise — frame-precise, slight quality drop</SelectItem>
                  <SelectItem value="lossless">Lossless — keyframe-only, byte-perfect</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!connectedImages.some((img) => img.targetHandle === "endFrame") && (
              <p className="px-1 text-[10px] text-amber-500/80 leading-snug">
                Works best when start and end frames are pinned to the same image. Without an end frame, the algorithm picks the best loop point it can find but the result may not be seamless.
              </p>
            )}
          </>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="gv-motionEnabled"
            checked={!!data.motionEnabled}
            onChange={(e) => onUpdate({ motionEnabled: e.target.checked, ...(!e.target.checked ? { motion: undefined } : {}) })}
            className="rounded border-muted-foreground/40"
          />
          <label htmlFor="gv-motionEnabled" className="text-xs">Motion hint (injected into prompt)</label>
        </div>
        {data.motionEnabled && (
          <MappableField field="motion" label="Motion" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Select
              value={data.motion || "moderate"}
              onValueChange={(v) => onUpdate({ motion: v as ImageToVideoData["motion"] })}
            >
              <SelectTrigger aria-label="Motion"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="subtle">Subtle</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="dynamic">Dynamic</SelectItem>
              </SelectContent>
            </Select>
          </MappableField>
        )}
      </div>

      {currentProvider === "kling" && (
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="gv-klingSound"
            checked={(data as Record<string, unknown>).kling3Sound !== false}
            onChange={(e) => onUpdate({ kling3Sound: e.target.checked })}
            className="rounded border-muted-foreground/40"
          />
          <label htmlFor="gv-klingSound" className="text-xs">Enable Sound</label>
        </div>
      )}

      {(currentProvider === "kling-turbo" || currentProvider === "kling-master") && (
        <div>
          <Label className="text-xs">CFG Scale ({String((data as Record<string, unknown>).cfgScale ?? 0.5)})</Label>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={((data as Record<string, unknown>).cfgScale as number) ?? ""}
            onChange={(e) => onUpdate({ cfgScale: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">0 = creative, 1 = strict prompt adherence</p>
        </div>
      )}

      {currentProvider === "kling-3-omni" && (
        <>
          <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <AspectRatioSelector
              options={VIDEO_RATIOS}
              value={data.aspectRatio || "16:9"}
              onValueChange={(v) => onUpdate({ aspectRatio: v as ImageToVideoData["aspectRatio"] })}
            />
          </MappableField>
          <div>
            <Label className="text-xs">Quality</Label>
            <Select
              value={data.resolution || "720p"}
              onValueChange={(v) => onUpdate({ resolution: v })}
            >
              <SelectTrigger aria-label="Quality"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="720p">Standard (720p)</SelectItem>
                <SelectItem value="1080p">Pro (1080p)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="gv-kling3OmniAudio"
              checked={data.generateAudio !== false}
              onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="gv-kling3OmniAudio" className="text-xs">Generate Audio</label>
          </div>
        </>
      )}

      {currentProvider === "grok-i2v" && (
        <>
          <div>
            <Label className="text-xs">Resolution</Label>
            <Select
              value={data.resolution || "480p"}
              onValueChange={(v) => onUpdate({ resolution: v })}
            >
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="480p">480p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Mode</Label>
            <Select
              value={data.grokMode || "normal"}
              onValueChange={(v) => onUpdate({ grokMode: v as "fun" | "normal" | "spicy" })}
            >
              <SelectTrigger aria-label="Mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="fun">Fun</SelectItem>
                <SelectItem value="spicy">Spicy</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {currentProvider === "seedance" && (
        <>
          <div>
            <Label className="text-xs">Resolution</Label>
            <Select
              value={data.resolution || "480p"}
              onValueChange={(v) => onUpdate({ resolution: v })}
            >
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="480p">480p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <AspectRatioSelector
              options={[
                { value: "16:9", label: "16:9 (Landscape)" },
                { value: "9:16", label: "9:16 (Portrait)" },
                { value: "1:1", label: "1:1 (Square)" },
                { value: "21:9", label: "21:9 (Ultra-wide)" },
              ]}
              value={data.aspectRatio || "16:9"}
              onValueChange={(v) => onUpdate({ aspectRatio: v as ImageToVideoData["aspectRatio"] })}
            />
          </MappableField>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="gv-seedanceFixedLens"
              checked={data.cameraFixed || false}
              onChange={(e) => onUpdate({ cameraFixed: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="gv-seedanceFixedLens" className="text-xs">Fixed Lens (no camera movement)</label>
          </div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="gv-seedanceAudio"
              checked={data.generateAudio || false}
              onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="gv-seedanceAudio" className="text-xs">Generate Audio</label>
          </div>
        </>
      )}

      {isSeedance2 && (
        <>
          <div>
            <Label className="text-xs">Resolution</Label>
            <Select
              value={data.resolution || "480p"}
              onValueChange={(v) => onUpdate({ resolution: v })}
            >
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                {/* Catalog-driven: seedance-2/-fast expose 480p/720p/1080p; seedance-2-mini 480p/720p */}
                {(getVideoResolutionOptions(currentProvider) ?? []).map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <AspectRatioSelector
              options={SEEDANCE_2_VIDEO_RATIOS}
              value={data.aspectRatio || defaultVideoAspectRatio(currentProvider)}
              onValueChange={(v) => onUpdate({ aspectRatio: v as ImageToVideoData["aspectRatio"] })}
            />
          </MappableField>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="gv-seedance2Audio"
              checked={data.generateAudio ?? true}
              onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="gv-seedance2Audio" className="text-xs">Generate Audio (default on)</label>
          </div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="gv-seedance2WebSearch"
              checked={data.webSearch || false}
              onChange={(e) => onUpdate({ webSearch: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="gv-seedance2WebSearch" className="text-xs">Enable Web Search</label>
          </div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="gv-seedance2Nsfw"
              checked={data.nsfwChecker || false}
              onChange={(e) => onUpdate({ nsfwChecker: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="gv-seedance2Nsfw" className="text-xs">NSFW Content Filter</label>
          </div>
        </>
      )}

      {(currentProvider === "wan-i2v" || currentProvider === "wan-turbo") && (
        <div>
          <Label className="text-xs">Resolution</Label>
          <Select
            value={data.resolution || (currentProvider === "wan-turbo" ? "480p" : "720p")}
            onValueChange={(v) => onUpdate({ resolution: v })}
          >
            <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
            <SelectContent>
              {currentProvider === "wan-turbo" ? (
                <>
                  <SelectItem value="480p">480p</SelectItem>
                  <SelectItem value="720p">720p</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="720p">720p</SelectItem>
                  <SelectItem value="1080p">1080p</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {(currentProvider === "hailuo-2.3-pro" || currentProvider === "hailuo-2.3" || currentProvider === "hailuo-standard") && (
        <div>
          <Label className="text-xs">Resolution</Label>
          <Select
            value={data.resolution || (currentProvider === "hailuo-standard" ? "512P" : "768P")}
            onValueChange={(v) => {
              const updates: Record<string, unknown> = { resolution: v }
              // 1080P only supports 6s — snap duration if needed
              if (v === "1080P" && data.duration && data.duration > 6) {
                updates.duration = 6
              }
              onUpdate(updates)
            }}
          >
            <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
            <SelectContent>
              {currentProvider === "hailuo-standard" ? (
                <>
                  <SelectItem value="512P">512P</SelectItem>
                  <SelectItem value="768P">768P</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="768P">768P</SelectItem>
                  <SelectItem value="1080P">1080P (6s max)</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {(currentProvider === "bytedance-lite" || currentProvider === "bytedance-pro") && (
        <>
          <div>
            <Label className="text-xs">Resolution</Label>
            <Select
              value={data.resolution || "480p"}
              onValueChange={(v) => onUpdate({ resolution: v })}
            >
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="480p">480p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="gv-bytedanceCameraFixed"
              checked={data.cameraFixed || false}
              onChange={(e) => onUpdate({ cameraFixed: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="gv-bytedanceCameraFixed" className="text-xs">Camera Fixed</label>
          </div>
          <div>
            <Label className="text-xs">Seed (-1 for random)</Label>
            <Input
              type="number"
              min={-1}
              max={2147483647}
              value={data.seed ?? -1}
              onChange={(e) => onUpdate({ seed: parseInt(e.target.value, 10) })}
            />
          </div>
        </>
      )}

      {currentProvider === "bytedance-pro-fast" && (
        <div>
          <Label className="text-xs">Resolution</Label>
          <Select
            value={data.resolution || "720p"}
            onValueChange={(v) => onUpdate({ resolution: v })}
          >
            <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="720p">720p</SelectItem>
              <SelectItem value="1080p">1080p</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {currentProvider === "gemini-omni-video" && (
        <>
          {geminiQuotaExceeded && (
            <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] leading-snug text-red-300">
              Too many inputs for Gemini Omni: images + 2×videos must be ≤ 7 (currently {geminiQuotaUsed}). The start frame and each reference image count as 1; each source video counts as 2. Remove some inputs before generating.
            </div>
          )}
          <MappableField field="resolution" label="Resolution" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Select value={(data.resolution as string) || "720p"} onValueChange={(v) => onUpdate({ resolution: v })}>
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(getVideoResolutionOptions("gemini-omni-video") ?? []).map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </MappableField>
          <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <AspectRatioSelector
              options={getAspectRatiosForVideoModel("gemini-omni-video")}
              value={(data.aspectRatio as string) || "16:9"}
              onValueChange={(v) => onUpdate({ aspectRatio: v as ImageToVideoData["aspectRatio"] })}
            />
          </MappableField>
          {connectedRefVideos.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Source clip trim (seconds, ≤10s window)</label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  value={(data.videoTrimStart as number) ?? 0}
                  onChange={(e) => {
                    const start = Math.max(0, Math.floor(Number(e.target.value) || 0))
                    // Re-clamp end so raising start past it can't create an inverted /
                    // >10s window that the backend would reject only at submit.
                    const end = (data.videoTrimEnd as number) ?? start + 10
                    onUpdate({ videoTrimStart: start, videoTrimEnd: Math.min(Math.max(end, start + 1), start + 10) })
                  }}
                  placeholder="start"
                />
                <Input
                  type="number"
                  min={0}
                  value={(data.videoTrimEnd as number) ?? 10}
                  onChange={(e) => {
                    const start = (data.videoTrimStart as number) ?? 0
                    const end = Math.floor(Number(e.target.value) || 0)
                    onUpdate({ videoTrimEnd: Math.min(Math.max(end, start + 1), start + 10) })
                  }}
                  placeholder="end"
                />
              </div>
            </div>
          )}
        </>
      )}

      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage}
          alt="Connected image"
          onClose={() => setLightboxImage(null)}
        />
      )}

      {connectedCharacter && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border p-2.5">
          <div className="flex items-center gap-2">
            <Checkbox
              id="gv-save-to-character"
              checked={data.attachReferenceVideoVariant !== undefined}
              onCheckedChange={(v) =>
                onUpdate({
                  attachReferenceVideoVariant: v
                    ? (data.attachReferenceVideoVariant && data.attachReferenceVideoVariant.length > 0
                        ? data.attachReferenceVideoVariant
                        : "generated")
                    : undefined,
                })
              }
            />
            <Label htmlFor="gv-save-to-character" className="text-xs cursor-pointer">
              Save clip to “{connectedCharacter.label}” as reference video
            </Label>
          </div>
          {data.attachReferenceVideoVariant !== undefined && (
            <div className="flex flex-col gap-1 pl-6">
              <Label htmlFor="gv-save-variant" className="text-[11px] text-muted-foreground">
                Variant label
              </Label>
              <Input
                id="gv-save-variant"
                value={data.attachReferenceVideoVariant ?? ""}
                onChange={(e) => onUpdate({ attachReferenceVideoVariant: e.target.value })}
                placeholder="e.g. happy, take-2"
                className="h-7 text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Saved to {connectedCharacter.label}’s reference videos on completion — reusable as a video reference.
              </p>
            </div>
          )}
        </div>
      )}

      <ConnectedCinematographySources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
    </div>
  )
}

export const GenerateVideoConfig = memo(GenerateVideoConfigImpl)

/**
 * Duration cap fallback — now DECLARED in model-options.ts (so the node quick
 * strip's custom-duration control shares it without importing this module);
 * re-exported here for existing consumers (config-field-renderer.tsx).
 */
export { GENERATE_VIDEO_PRO_MAX_DURATION_FALLBACK } from "./model-options"

/**
 * Generate Video Pro — trimmed, Seedance-2-family-only config panel for the
 * multi-segment stitch node (see GenerateVideoProNodeData). Deliberately a
 * simplified subset of GenerateVideoConfig above: one prompt field (no
 * negative), a 3-provider Select (no search), a continuous duration range
 * (4s..cap, NOT the single-segment catalog list — durations above 15s span
 * multiple stitched segments server-side), the shared AspectRatioSelector,
 * a provider-aware resolution Select, and the audio toggle.
 */
function GenerateVideoProConfigImpl({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap }: ConfigProps<GenerateVideoProNodeData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("video", "prompt")
  const currentProvider = data.provider || "seedance-2"
  const maxDuration = GENERATE_VIDEO_PRO_MAX_DURATION_FALLBACK
  const duration = data.duration ?? 8

  // Fail-safe (Provider Enum Sync step 12b / CLAUDE.md pitfall 5): mini/fast
  // have no 1080p/4k — snap a stale resolution to the new provider's first
  // valid option, mirroring GenerateVideoConfig's / ImageToVideoConfig's snap
  // effect above (same VIDEO_RESOLUTION_OPTIONS source, so it can't drift).
  useEffect(() => {
    const opts = getVideoResolutionOptions(currentProvider)
    if (opts && data.resolution && !opts.some((o) => o.value === data.resolution)) {
      onUpdate({ resolution: opts[0]?.value })
    }
  }, [currentProvider]) // eslint-disable-line react-hooks/exhaustive-deps

  const resolutionOptions = getVideoResolutionOptions(currentProvider)

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <Select
          value={currentProvider}
          onValueChange={(v) => onUpdate({ provider: v as GenerateVideoProNodeData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {GVP_PROVIDERS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={currentProvider} />

      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => onUpdate({ prompt: v })} target="prompt" media="video" />
        <PromptHelperButton nodeType="generate-video-pro" currentPrompt={data.prompt || ""} provider={currentProvider} duration={duration} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />
      </span>}>
        <PromptEditor
          rows={3}
          value={data.prompt || ""}
          onChange={(v) => onUpdate({ prompt: v })}
          placeholder="Describe the video you want to generate..."
          nodeRefs={nodeRefs}
          refMap={refMap}
          snippets={promptSnippets}
        />
        <PromptLengthCounter value={data.prompt || ""} max={getMaxVideoPromptChars(currentProvider)} modelLabel={currentProvider} />
      </MappableField>

      <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={2}
          value={data.negativePrompt || ""}
          onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
          placeholder="What to avoid (appended to every segment as an Avoid: suffix)..."
        />
      </MappableField>

      <MappableField field="duration" label="Duration (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={4}
            max={maxDuration}
            step={1}
            value={duration}
            onChange={(e) => onUpdate({ duration: parseInt(e.target.value, 10) })}
            className="flex-1 h-1.5 rounded-lg cursor-pointer accent-[#ff0073]"
            aria-label="Duration (seconds)"
          />
          <Input
            type="number"
            min={4}
            max={maxDuration}
            value={duration}
            onChange={(e) => {
              if (e.target.value === "") return
              const parsed = parseInt(e.target.value, 10)
              if (Number.isNaN(parsed)) return
              onUpdate({ duration: Math.min(maxDuration, Math.max(4, parsed)) })
            }}
            className="w-16 h-7 text-xs shrink-0"
          />
        </div>
        <p className="text-[10px] text-muted-foreground px-1">
          Above 15s the request is automatically split into multiple stitched Seedance 2 segments.
        </p>
      </MappableField>

      <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <AspectRatioSelector
          options={getAspectRatiosForVideoModel("seedance-2")}
          value={data.aspectRatio || defaultVideoAspectRatio(currentProvider)}
          onValueChange={(v) => onUpdate({ aspectRatio: v })}
        />
      </MappableField>

      {resolutionOptions && resolutionOptions.length > 0 && (
        <div>
          <Label className="text-xs">Resolution</Label>
          <Select
            value={data.resolution || resolutionOptions[0].value}
            onValueChange={(v) => onUpdate({ resolution: v })}
          >
            <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
            <SelectContent>
              {resolutionOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex items-center gap-2 px-1">
        <input
          type="checkbox"
          id="gvp-generateAudio"
          checked={data.generateAudio ?? true}
          onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
          className="rounded border-muted-foreground/40"
        />
        <label htmlFor="gvp-generateAudio" className="text-xs">Generate Audio (default on)</label>
      </div>

      {/* Planner model — the LLM that splits the script into segment prompts. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gvp-planner-model">Planner model</Label>
        <Select value={data.plannerModel ?? "claude-opus-4.7"} onValueChange={(v) => onUpdate({ plannerModel: v })}>
          <SelectTrigger id="gvp-planner-model" className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LLM_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Splits your script into per-segment prompts. Default: Claude Opus 4.7.
        </p>
      </div>

      {/* Context tail — continuation-reference length per join (A/B lever:
          longer = more boundary-motion context for slow moves/tempo, small
          per-join surcharge at the ref rate). */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gvp-context-tail">Continuation context (seconds)</Label>
        <Select value={String(data.contextTailSec ?? 2)} onValueChange={(v) => onUpdate({ contextTailSec: Number(v) })}>
          <SelectTrigger id="gvp-context-tail" className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[2, 3, 4, 5].map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s}s{s === 2 ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          How much of the previous segment each continuation sees. Raise for slow camera moves or music-timed motion; adds a small per-join cost.
        </p>
      </div>

      {/* PLAN ONLY — cheap plan iteration without video generation. */}
      <div className="flex items-center gap-2 px-1">
        <input
          type="checkbox"
          id="gvp-planOnly"
          checked={data.planOnly ?? false}
          onChange={(e) => onUpdate({ planOnly: e.target.checked })}
          className="rounded border-muted-foreground/40"
        />
        <label htmlFor="gvp-planOnly" className="text-xs">
          Plan only — return the full segment plan without generating video (charged the plan fee only)
        </label>
      </div>
    </div>
  )
}

export const GenerateVideoProConfig = memo(GenerateVideoProConfigImpl)

/**
 * Span-length cap fallback (seconds) when no node-registry descriptor is
 * available to read the real cap from. Mirrors the backend default
 * (`EDIT_VIDEO_PRO_MAX_SPAN` env var, `ee/billing/edit-video-pro-credits.ts`)
 * — same pattern as GENERATE_VIDEO_PRO_MAX_DURATION_FALLBACK above. This is
 * the SPAN LENGTH cap (spanEnd - spanStart), not an absolute bound on
 * spanEnd's value, so it is surfaced as validation-hint text only — never a
 * hard HTML `max` on the spanEnd field (spanStart can itself be large for a
 * long source video, which would make a flat max on spanEnd's absolute value
 * incorrectly reject valid spans).
 */
export const EDIT_VIDEO_PRO_MAX_SPAN_FALLBACK = 120

/**
 * Edit Video Pro — span-replace sibling of Generate Video Pro (see
 * EditVideoProNodeData). Deliberately has NO resolution/aspect controls —
 * both are source-derived by design (the replaced span inherits the source
 * clip's own dimensions). Provider select (3 Seedance-2 SKUs), one prompt
 * field (no negative), the SpanRangeSlider synced with two numeric From/To
 * fields (the slider itself only renders once sourceDurationSec has been
 * probed — see edit-video-pro-node.tsx's onLoadedMetadata stamping), and the
 * audio toggle.
 */
function EditVideoProConfigImpl({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap }: ConfigProps<EditVideoProNodeData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("video", "prompt")
  const currentProvider = data.provider || "seedance-2"
  const spanStart = Math.max(0, data.spanStart ?? 0)
  const spanEnd = data.spanEnd ?? spanStart + 8
  const sourceDuration = data.sourceDurationSec

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <Select
          value={currentProvider}
          onValueChange={(v) => onUpdate({ provider: v as EditVideoProNodeData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {GVP_PROVIDERS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={currentProvider} />

      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => onUpdate({ prompt: v })} target="prompt" media="video" />
        <PromptHelperButton nodeType="edit-video-pro" currentPrompt={data.prompt || ""} provider={currentProvider} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />
      </span>}>
        <PromptEditor
          rows={3}
          value={data.prompt || ""}
          onChange={(v) => onUpdate({ prompt: v })}
          placeholder="Describe what should replace the selected span..."
          nodeRefs={nodeRefs}
          refMap={refMap}
          snippets={promptSnippets}
        />
        <PromptLengthCounter value={data.prompt || ""} max={getMaxVideoPromptChars(currentProvider)} modelLabel={currentProvider} />
      </MappableField>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Replace Span</Label>
        {sourceDuration === undefined ? (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Connect a video and open its preview to enable the slider
          </p>
        ) : (
          <SpanRangeSlider
            videoDuration={sourceDuration}
            spanStart={spanStart}
            spanEnd={spanEnd}
            onChange={({ spanStart: s, spanEnd: e }) => onUpdate({ spanStart: s, spanEnd: e })}
          />
        )}
        <div className="grid grid-cols-2 gap-2">
          <MappableField field="spanStart" label="From (s)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Input
              type="number"
              step={0.1}
              min={0}
              value={spanStart}
              onChange={(e) => {
                if (e.target.value === "") return
                const parsed = parseFloat(e.target.value)
                if (Number.isNaN(parsed)) return
                onUpdate({ spanStart: Math.max(0, parsed) })
              }}
            />
          </MappableField>
          <MappableField field="spanEnd" label="To (s)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Input
              type="number"
              step={0.1}
              min={0}
              value={spanEnd}
              onChange={(e) => {
                if (e.target.value === "") return
                const parsed = parseFloat(e.target.value)
                if (Number.isNaN(parsed)) return
                onUpdate({ spanEnd: Math.max(0, parsed) })
              }}
            />
          </MappableField>
        </div>
        <p className="text-[10px] text-muted-foreground px-1">
          Replace span must be at least 4 seconds. Spans longer than ~15s are automatically split into multiple stitched Seedance 2 segments. Maximum span: {EDIT_VIDEO_PRO_MAX_SPAN_FALLBACK}s.
        </p>
      </div>

      <div className="flex items-center gap-2 px-1">
        <input
          type="checkbox"
          id="evp-generateAudio"
          checked={data.generateAudio ?? true}
          onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
          className="rounded border-muted-foreground/40"
        />
        <label htmlFor="evp-generateAudio" className="text-xs">Generate Audio (default on)</label>
      </div>
    </div>
  )
}

export const EditVideoProConfig = memo(EditVideoProConfigImpl)

export function ExtendVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<ExtendVideoData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("video", "prompt")
  // Prompt-only toggle: this panel renders no negative editor (the old preview
  // surfaced the negative for reference only). Provider-less path.
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    negativePrompt: data.negativePrompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
    // No extend provider takes a native negative → the helper folds it into the
    // prompt as `Avoid: …` (matches the /v1/extend-video route + payload-builder).
    videoProvider: data.provider || "veo-extend",
  })
  const isSeedanceExtend = data.provider === "seedance-2-extend"
  // Levers are catalog-driven (single source of truth shared with the
  // backend route/worker) — durations 4-15, resolutions 480p/720p/1080p.
  const seedanceCatalog = MODEL_CATALOG["seedance-2-extend"]
  const seedanceDurations = seedanceCatalog?.durations ?? [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
  const seedanceResolutions = seedanceCatalog?.resolutions ?? ["480p", "720p", "1080p"]
  const seedanceDuration = data.duration ?? 8

  // Credit labels track the duration tier — re-prefetch when it changes.
  useEffect(() => {
    if (!isSeedanceExtend) return
    prefetchModelCredits(seedanceResolutions.map((r) =>
      buildVideoCreditModelIdentifier("seedance-2-extend", seedanceDuration, undefined, undefined, undefined, r),
    ))
  }, [isSeedanceExtend, seedanceDuration]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fail-safe (Provider Enum Sync step 12b): when the provider changes, snap
  // a stale duration into seedance's 4–15s window (LTX allows 1–20) and clear
  // the seedance-only levers when switching away — the dropdowns hide but the
  // stale values would still be forwarded.
  useEffect(() => {
    if (isSeedanceExtend) {
      if (data.duration !== undefined && (data.duration < 4 || data.duration > 15)) {
        onUpdate({ duration: Math.min(15, Math.max(4, Math.round(data.duration))) })
      }
    } else if (data.resolution !== undefined || data.generateAudio !== undefined) {
      onUpdate({ resolution: undefined, generateAudio: undefined })
    }
  }, [data.provider]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <Select
          value={data.provider || "veo-extend"}
          onValueChange={(v) => onUpdate({ provider: v as ExtendVideoData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {EXTEND_VIDEO_MODELS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </MappableField>

      <MappableField field="prompt" label={isSeedanceExtend ? "What happens next" : "Prompt"} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
        <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => onUpdate({ prompt: v })} target="prompt" media="video" />
        <PromptHelperButton nodeType="extend-video" currentPrompt={data.prompt || ""} provider={data.provider} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — node has no prompt yet"
            minHeightRem={3 * 1.5}
          />
        ) : (
          <>
            <TagTextarea
              value={data.prompt || ""}
              onChange={(v) => onUpdate({ prompt: v })}
              placeholder={isSeedanceExtend ? "What happens next? e.g. the ball keeps rolling until it hits a cup" : "Describe how the video should continue..."}
              rows={3}
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
              snippets={promptSnippets}
            />
            <PromptLengthCounter value={data.prompt || ""} max={getMaxVideoPromptChars(data.provider || "veo-extend")} modelLabel={data.provider || "veo-extend"} />
          </>
        )}
      </MappableField>


      {data.provider === "veo-extend" && (
        <div>
          <Label className="text-xs">Model</Label>
          <Select
            value={data.model || "fast"}
            onValueChange={(v) => onUpdate({ model: v as "fast" | "quality" })}
          >
            <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fast">Fast</SelectItem>
              <SelectItem value="quality">Quality</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {data.provider === "veo-extend" && (
        <div>
          <Label className="text-xs">Seed (optional)</Label>
          <Input
            type="number"
            min={10000}
            max={99999}
            placeholder="10000–99999"
            value={(data.seeds as number | undefined) ?? ""}
            onChange={(e) => onUpdate({ seeds: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">Same seed produces similar results. Leave empty for random.</p>
        </div>
      )}

      {data.provider === "runway-extend" && (
        <div>
          <Label className="text-xs">Quality</Label>
          <Select
            value={data.quality || "720p"}
            onValueChange={(v) => onUpdate({ quality: v as "720p" | "1080p" })}
          >
            <SelectTrigger aria-label="Quality"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="720p">720p</SelectItem>
              <SelectItem value="1080p">1080p</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {data.provider === "ltx-2.3-pro" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Extend Mode</Label>
            <RadioGroup
              value={data.extendMode || "end"}
              onValueChange={(v) => onUpdate({ extendMode: v as "start" | "end" })}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="end" id="extend-mode-end" />
                <Label htmlFor="extend-mode-end" className="text-xs cursor-pointer">
                  End (continue forward)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="start" id="extend-mode-start" />
                <Label htmlFor="extend-mode-start" className="text-xs cursor-pointer">
                  Start (prepend backwards)
                </Label>
              </div>
            </RadioGroup>
          </div>

          <MappableField field="duration" label="Duration (seconds to add)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Input
              type="number"
              min={1}
              max={20}
              placeholder="1–20"
              value={data.duration ?? ""}
              onChange={(e) => onUpdate({ duration: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
            />
          </MappableField>
        </>
      )}

      {isSeedanceExtend && (
        <>
          <MappableField field="duration" label="Seconds to add" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Select
              value={String(seedanceDuration)}
              onValueChange={(v) => onUpdate({ duration: parseInt(v, 10) })}
            >
              <SelectTrigger aria-label="Seconds to add"><SelectValue /></SelectTrigger>
              <SelectContent>
                {seedanceDurations.map((s) => (
                  <SelectItem key={s} value={String(s)}>{s} seconds</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </MappableField>

          <div>
            <Label className="text-xs">Resolution</Label>
            <Select
              value={data.resolution || "720p"}
              onValueChange={(v) => onUpdate({ resolution: v as ExtendVideoData["resolution"] })}
            >
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                {seedanceResolutions.map((r) => {
                  const credits = getCachedCredits(buildVideoCreditModelIdentifier("seedance-2-extend", seedanceDuration, undefined, undefined, undefined, r))
                  return (
                    <SelectItem key={r} value={r}>{credits != null ? `${r} (${credits} credits)` : r}</SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">Matching the source video's resolution gives the cleanest seam.</p>
          </div>

          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="extendGenerateAudio"
              checked={data.generateAudio !== false}
              onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="extendGenerateAudio" className="text-xs">Generate Audio</label>
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground px-1">
        {isSeedanceExtend
          ? "Extends ANY connected video: Seedance 2 generates what happens next (sound included) and the result is stitched into one seamless clip."
          : "Extends a VEO, Runway, or LTX video with a new prompt. Connect an upstream Image to Video or Text to Video node that produces a kieTaskId."}
      </p>

      <ConnectedCinematographySources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
    </div>
  )
}


export function SpeechToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, nodeId }: ConfigProps<SpeechToVideoData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("video", "prompt")
  const negativeSnippets = useSnippetPool("video", "negative")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const negativeFieldMode = usePromptFieldMode(nodeId ?? "", "negativePrompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    negativePrompt: data.negativePrompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
    negativeSnippets,
    // Speech-to-video always runs on `wan-s2v`, which takes negative_prompt
    // natively (backend kie/video.ts::speechToVideo sends it as a native param;
    // wan-s2v ∈ NATIVE_NEGATIVE_VIDEO_PROVIDERS) → routing is "native", no Avoid.
    videoProvider: "wan-s2v",
  })
  useEffect(() => { prefetchModelCredits(["speech-to-video", "speech-to-video:580p", "speech-to-video:720p"]) }, [])
  const [showAdvanced, setShowAdvanced] = useState(false)
  // Reference images for the PromptEditor `@`-autocomplete (wired character /
  // image producers), matching the i2v / t2v sibling panels.
  const refImagesForAutocomplete = useMemo<RefImageItem[]>(
    () => [
      // Image refs (frame-excluded) first, then the independently-numbered
      // reference-VIDEO + reference-AUDIO items — full {image:N}/{video:N}/
      // {audio:N} parity with the inline/modal surface (usePromptEditorRefs).
      // The video/audio builders self-gate on referenceModalityForHandle, so
      // they yield [] for panels with no such handle wired (no-op there).
      ...toRefImageItems(buildVideoRefAutocomplete(sources)),
      ...buildVideoRefVideoAutocomplete(sources),
      ...buildVideoRefAudioAutocomplete(sources),
    ],
    [sources],
  )

  return (
    <div className="flex flex-col gap-3">
      {/* Resolution */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Resolution</Label>
        <Select
          value={data.resolution || "480p"}
          onValueChange={(v) => onUpdate({ resolution: v as "480p" | "580p" | "720p" })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="480p">{`480p (${getCachedCredits("speech-to-video") ?? 4} credits)`}</SelectItem>
            <SelectItem value="580p">{`580p (${getCachedCredits("speech-to-video:580p") ?? 6} credits)`}</SelectItem>
            <SelectItem value="720p">{`720p (${getCachedCredits("speech-to-video:720p") ?? 8} credits)`}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Prompt */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-1.5">
          <Label className="text-xs text-muted-foreground">Prompt</Label>
          <span className="inline-flex items-center gap-0.5">
            <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
            <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => onUpdate({ prompt: v })} target="prompt" media="video" />
            <PromptHelperButton
              nodeType="speech-to-video"
              currentPrompt={data.prompt || ""}
              onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })}
            />
          </span>
        </div>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — node has no prompt yet"
            minHeightRem={80 / 16}
          />
        ) : (
          <>
            <PromptEditor
              rows={3}
              value={data.prompt || ""}
              onChange={(v) => onUpdate({ prompt: v })}
              placeholder="Describe the speaking scene..."
              referenceImages={refImagesForAutocomplete}
              nodeRefs={nodeRefs}
              refMap={refMap}
              snippets={promptSnippets}
            />
            <PromptLengthCounter value={data.prompt || ""} max={getMaxVideoPromptChars(data.provider as string | undefined)} modelLabel={(data.provider as string | undefined) || "wan-s2v"} />
          </>
        )}
      </div>

      {/* Unified injected-references list — surfaces wired character canonicals
          + @-mention variants. Hidden when nothing is wired. */}
      <InjectedReferenceList
        connectedReferences={toConnectedReferences(buildVideoRefAutocomplete(sources))}
        prompt={data.prompt || ""}
        referenceOrder={data.referenceOrder}
        suppressedCanonicalCharacterIds={data.suppressedCanonicalCharacterIds}
        onUpdateReferenceOrder={(order) => onUpdate({ referenceOrder: order })}
        onRemoveWiredSource={
          nodeId
            ? makeRemoveWiredSource(
                nodeId,
                edges ?? [],
                useWorkflowStore.getState().deleteEdge,
              )
            : undefined
        }
        onRemoveMention={(token) => onUpdate({ prompt: removeMentionToken(data.prompt || "", token) })}
        onSuppressCanonical={(slug) =>
          onUpdate({ suppressedCanonicalCharacterIds: appendSuppressedSlug(data.suppressedCanonicalCharacterIds, slug) })
        }
        label="Injected references"
      />
      <SeedanceReferenceTip provider={data.provider} />

      {/* Negative Prompt */}
      <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={negativeFieldMode.mode} onToggle={negativeFieldMode.toggle} />
        <SnippetMenuButton pool={negativeSnippets} value={data.negativePrompt || ""} onInsert={(v) => onUpdate({ negativePrompt: v || undefined })} target="negative" media="video" />
      </span>}>
        {negativeFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.negativeSegments}
            plainText={finalPrompt.negativeText}
            placeholder="Final negative prompt preview — nothing to avoid yet"
            routingCaption={negativeRoutingCaption(finalPrompt.negativeRouting)}
            minHeightRem={60 / 16}
          />
        ) : (
          <>
            <Textarea
              value={data.negativePrompt || ""}
              onChange={(e) => onUpdate({ negativePrompt: e.target.value || undefined })}
              placeholder="What to avoid..."
              className="min-h-[60px] text-sm"
            />
            <PromptLengthCounter value={data.negativePrompt || ""} max={getMaxNegativePromptChars(data.provider as string | undefined)} modelLabel={(data.provider as string | undefined) || "wan-s2v"} noun="negative prompt" />
          </>
        )}
      </MappableField>

      {/* Advanced Settings */}
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        {showAdvanced ? "Hide" : "Show"} Advanced Settings
      </button>

      {showAdvanced && (
        <div className="flex flex-col gap-3 border-t pt-3 border-muted-foreground/10">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Seed (optional)</Label>
            <Input
              type="number"
              value={data.seed ?? ""}
              onChange={(e) => onUpdate({ seed: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Random"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Num Frames (16-81)</Label>
            <Input
              type="number"
              value={data.numFrames ?? ""}
              onChange={(e) => onUpdate({ numFrames: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Default"
              min={16}
              max={81}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">FPS (8-24)</Label>
            <Input
              type="number"
              value={data.fps ?? ""}
              onChange={(e) => onUpdate({ fps: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Default"
              min={8}
              max={24}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Inference Steps (1-50)</Label>
            <Input
              type="number"
              value={data.inferenceSteps ?? ""}
              onChange={(e) => onUpdate({ inferenceSteps: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Default"
              min={1}
              max={50}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Guidance Scale (0-20)</Label>
            <Input
              type="number"
              step="0.1"
              value={data.guidanceScale ?? ""}
              onChange={(e) => onUpdate({ guidanceScale: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Default"
              min={0}
              max={20}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Shift (0-20)</Label>
            <Input
              type="number"
              step="0.1"
              value={data.shift ?? ""}
              onChange={(e) => onUpdate({ shift: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Default"
              min={0}
              max={20}
            />
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground px-1">
        Generates a talking video from an image and audio using Wan 2.2 Speech-to-Video. Connect a portrait image, speech audio, and prompt.
      </p>

      <ConnectedCinematographySources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
    </div>
  )
}

export function FaceSwapConfig({ data, onUpdate, sources, edges, nodeId }: ConfigProps<FaceSwapData> & { nodeId?: string }) {
  useEffect(() => { prefetchModelCredits(["roop-face-swap"]) }, [])
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground px-1">
        Replaces the face in a video with the face from a reference image.
        Connect a face image to the orange handle and a video to the pink handle.
        Powered by Roop (Replicate) — {getCachedCredits("roop-face-swap") ?? 16} CR per run.
      </p>

      {/* Unified injected-references list — face-swap doesn't have a prompt to
          @-mention against, so this list only shows wired upstreams + character
          canonicals. Drag-reorder still useful when multiple face refs are wired. */}
      <InjectedReferenceList
        connectedReferences={toConnectedReferences(buildVideoRefAutocomplete(sources))}
        prompt=""
        referenceOrder={data.referenceOrder}
        suppressedCanonicalCharacterIds={data.suppressedCanonicalCharacterIds}
        onUpdateReferenceOrder={(order) => onUpdate({ referenceOrder: order })}
        onRemoveWiredSource={
          nodeId
            ? makeRemoveWiredSource(
                nodeId,
                edges ?? [],
                useWorkflowStore.getState().deleteEdge,
              )
            : undefined
        }
        onSuppressCanonical={(slug) =>
          onUpdate({ suppressedCanonicalCharacterIds: appendSuppressedSlug(data.suppressedCanonicalCharacterIds, slug) })
        }
        label="Injected references"
      />
      <SeedanceReferenceTip provider={data.provider} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// VideoRetakeConfig — "full settings" surface for the video-retake node.
// The canvas toolbar exposes the common levers (aspect / mode / versions);
// this panel surfaces the complete set: prompt, retake mode, start time +
// duration, aspect ratio, fps, and generate-audio toggle. Resolution is
// locked at 1080p for retake (LTX 2.3 Pro contract).
// ---------------------------------------------------------------------------
function VideoRetakeConfigImpl({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<VideoRetakeData> & { nodeId?: string }) {
  useEffect(() => { prefetchModelCredits(["ltx-2.3-pro"]) }, [])
  const promptSnippets = useSnippetPool("video", "prompt")
  // Prompt-only toggle (video-retake has no negative field). Provider-less.
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
    // Video negative-routing prediction. video-retake exposes no negative field,
    // so this is a no-op today (routing stays null) — wired for consistency so a
    // future negative field gets truthful routing for free. ltx-2.3-pro has no
    // native negative → would fold into the prompt as `Avoid: …`.
    videoProvider: data.provider || "ltx-2.3-pro",
  })
  return (
    <div className="flex flex-col gap-3">
      <MappableField
        field="prompt"
        label="Prompt"
        sources={sources}
        fieldMappings={fieldMappings}
        onMapField={onMapField}
        labelAction={
          <span className="inline-flex items-center gap-0.5">
            <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
            <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => onUpdate({ prompt: v })} target="prompt" media="video" />
            <PromptHelperButton
              nodeType="video-retake"
              currentPrompt={data.prompt || ""}
              provider={data.provider}
              aspectRatio={data.aspectRatio}
              onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })}
            />
          </span>
        }
      >
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — node has no prompt yet"
            minHeightRem={3 * 1.5}
          />
        ) : (
          <>
            <TagTextarea
              value={data.prompt || ""}
              onChange={(v) => onUpdate({ prompt: v })}
              placeholder="Describe what should change in the selected range..."
              rows={3}
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
              snippets={promptSnippets}
            />
            <PromptLengthCounter value={data.prompt || ""} max={getMaxVideoPromptChars(data.provider || "ltx-2.3-pro")} modelLabel={data.provider || "ltx-2.3-pro"} />
          </>
        )}
      </MappableField>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Retake Mode</Label>
        <RadioGroup
          value={data.retakeMode || "replace_audio_and_video"}
          onValueChange={(v) => onUpdate({ retakeMode: v as VideoRetakeData["retakeMode"] })}
          className="flex flex-col gap-1"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="replace_audio_and_video" id="retake-mode-both" />
            <Label htmlFor="retake-mode-both" className="text-xs cursor-pointer">Replace both (audio + video)</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="replace_audio" id="retake-mode-audio" />
            <Label htmlFor="retake-mode-audio" className="text-xs cursor-pointer">Replace audio only</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="replace_video" id="retake-mode-video" />
            <Label htmlFor="retake-mode-video" className="text-xs cursor-pointer">Replace video only</Label>
          </div>
        </RadioGroup>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MappableField field="retakeStartTime" label="Start time (s)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Input
            type="number"
            step={0.1}
            min={0}
            value={data.retakeStartTime ?? 0}
            onChange={(e) => onUpdate({ retakeStartTime: parseFloat(e.target.value) || 0 })}
          />
        </MappableField>
        <MappableField field="retakeDuration" label="Duration (s, min 2)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Input
            type="number"
            step={0.1}
            min={2}
            value={data.retakeDuration ?? 2}
            onChange={(e) => onUpdate({ retakeDuration: Math.max(2, parseFloat(e.target.value) || 2) })}
          />
        </MappableField>
      </div>

      <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <AspectRatioSelector
          value={data.aspectRatio || "16:9"}
          onValueChange={(v) => onUpdate({ aspectRatio: v as VideoRetakeData["aspectRatio"] })}
          options={[
            { value: "16:9", label: "16:9" },
            { value: "9:16", label: "9:16" },
          ]}
        />
      </MappableField>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Resolution</Label>
        <Select value="1080p" disabled>
          <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1080p">1080p (locked for retake)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <MappableField field="fps" label="FPS" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={String(data.fps ?? 25)}
          onValueChange={(v) => onUpdate({ fps: parseInt(v, 10) as VideoRetakeData["fps"] })}
        >
          <SelectTrigger aria-label="FPS"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="24">24</SelectItem>
            <SelectItem value="25">25</SelectItem>
            <SelectItem value="48">48</SelectItem>
            <SelectItem value="50">50</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>

      <div className="flex items-center gap-2">
        <Checkbox
          id="retake-gen-audio"
          checked={data.generateAudio ?? true}
          onCheckedChange={(v) => onUpdate({ generateAudio: !!v })}
        />
        <Label htmlFor="retake-gen-audio" className="text-xs cursor-pointer">Generate audio</Label>
      </div>

      <p className="text-xs text-muted-foreground px-1">
        Re-renders a segment of an upstream video using LTX 2.3 Pro. Connect a video source to the pink handle, then choose the segment to replace. Minimum duration is 2 seconds.
      </p>

      <ConnectedCinematographySources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
    </div>
  )
}

export const VideoRetakeConfig = memo(VideoRetakeConfigImpl)

// --- Video Analysis -------------------------------------------------------

/** Client-side YouTube-shape check (hostname suffix) — gates the probe so we
 *  never hit the endpoint for a non-YouTube URL (or mid-type garbage). Mirrors
 *  the backend's YOUTUBE_HOSTS allowlist intent; the backend re-validates. */
function isYoutubeShapedUrl(url: string): boolean {
  try {
    return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(new URL(url).hostname)
  } catch {
    return false
  }
}

function formatProbedDuration(sec: number): string {
  const s = Math.round(sec)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, "0")}`
}

export function VideoAnalysisConfig({ data, onUpdate }: ConfigProps<VideoAnalysisNodeData>) {
  // Show the quality tier; a legacy raw model id falls back to the default tier.
  const tier = isVideoAnalysisTier(data.llmModel ?? "") ? (data.llmModel as string) : DEFAULT_VIDEO_ANALYSIS_TIER
  // FAIL-SAFE write-back (Provider Enum Sync pitfall 12b): a pre-tier node
  // stores a RAW model id ("gemini-3-flash"). Without this, the dropdown
  // DISPLAYS the default tier ("Pro") while the run path honors the stored raw
  // value — display lies, data wins (observed: user saw Pro, flash executed).
  // Reverse-map the raw id to its true tier — derived from VIDEO_ANALYSIS_TIERS,
  // never a hardcoded list — so the UI tells the truth; unknown ids snap to the
  // default tier.
  useEffect(() => {
    const v = data.llmModel
    if (!v || isVideoAnalysisTier(v)) return
    // Reverse-map over the MODEL-BACKED tier map only — mixed tiers are
    // roll-plan sentinels with no model to reverse-map (and isVideoAnalysisTier
    // already returned above for them).
    const trueTier =
      (Object.entries(VIDEO_ANALYSIS_TIERS).find(([, model]) => model === v)?.[0] as string | undefined) ??
      DEFAULT_VIDEO_ANALYSIS_TIER
    onUpdate({ llmModel: trueTier })
  }, [data.llmModel, onUpdate])
  const url = data.youtubeUrl ?? ""
  const [probeError, setProbeError] = useState<string | undefined>(undefined)
  const [probing, setProbing] = useState(false)

  // A stored probe is trusted only while it still matches the current URL — a
  // URL edit invalidates it (cleared synchronously in onChange below).
  const probed = data.probedYoutube && data.probedYoutube.url === url ? data.probedYoutube : undefined

  // INTEGRITY CONTRACT: on URL change the field is written synchronously with
  // probedYoutube cleared (below). Here we debounce ~600ms, YouTube-shape-gate,
  // then probe — guarding the async result with a `cancelled` closure flag so an
  // out-of-order response (stale URL) can never write a mismatched duration.
  useEffect(() => {
    setProbeError(undefined)
    const v = url
    if (!v || !isYoutubeShapedUrl(v)) {
      setProbing(false)
      return
    }
    // Already have a fresh probe for this exact URL — don't re-hit the endpoint
    // (avoids a redundant rate-limited probe every time the panel re-opens).
    if (data.probedYoutube?.url === v) {
      setProbing(false)
      return
    }
    let cancelled = false
    setProbing(true)
    const timer = setTimeout(async () => {
      try {
        const { durationSec } = await probeVideoAnalysis({ youtubeUrl: v })
        if (cancelled) return
        onUpdate({ probedYoutube: { url: v, durationSec } })
        setProbeError(undefined)
      } catch (err) {
        if (cancelled) return
        setProbeError(err instanceof Error ? err.message : "Could not read this video")
      } finally {
        if (!cancelled) setProbing(false)
      }
    }, 600)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // data.probedYoutube is read (not depended-on) so a successful probe writing
    // it back doesn't retrigger; the URL is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, onUpdate])

  return (
    <div className="flex flex-col gap-3">
      {/* Model */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="video-analysis-model">Analysis quality</Label>
        <Select value={tier} onValueChange={(v) => onUpdate({ llmModel: v })}>
          <SelectTrigger id="video-analysis-model" className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIDEO_ANALYSIS_TIER_ORDER.map((t) => (
              <SelectItem key={t} value={t}>
                {VIDEO_ANALYSIS_TIER_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* reasoning-effort selector deliberately absent: video-analysis models expose no effort levels (v1) */}

      {/* Best-of-N result strategy */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="video-analysis-selection">Result selection</Label>
        <Select
          value={data.selectionMode === "combine" ? "combine" : "choose"}
          onValueChange={(v) => onUpdate({ selectionMode: v as "choose" | "combine" })}
        >
          <SelectTrigger id="video-analysis-selection" className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="choose">Choose</SelectItem>
            <SelectItem value="combine">Combine</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          The video is analyzed several times. "Choose" keeps the strongest pass as-is; "Combine" also folds in
          details from the other passes after verifying them against the footage (slightly slower, most complete).
        </p>
      </div>

      {/* YouTube URL (alternative to a wired video source) */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="video-analysis-url">YouTube URL</Label>
        <Input
          id="video-analysis-url"
          value={url}
          onChange={(e) => onUpdate({ youtubeUrl: e.target.value, probedYoutube: undefined })}
          placeholder="https://youtube.com/watch?v=… (or wire a video)"
          className="text-sm"
        />
        {probed ? (
          <p className="text-[11px] text-muted-foreground">
            Duration {formatProbedDuration(probed.durationSec)} — pricing bucket set from this length.
          </p>
        ) : probing ? (
          <p className="text-[11px] text-muted-foreground">Checking video…</p>
        ) : probeError ? (
          <p className="text-[11px] text-red-500">{probeError}</p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Leave blank and wire a video to the input handle to analyze an uploaded/generated clip instead.
          </p>
        )}
      </div>

      {/* Analysis focus */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="video-analysis-focus">Analysis focus (optional)</Label>
        <Textarea
          id="video-analysis-focus"
          value={data.analysisFocus ?? ""}
          onChange={(e) => onUpdate({ analysisFocus: e.target.value })}
          placeholder="What should the analysis prioritize? e.g. identify product shots, on-screen text, and scene transitions."
          maxLength={2000}
          rows={4}
          className="text-sm"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Breaks a video (max 10 min) into a timestamped scene list. Cost scales with the video&apos;s duration and the chosen model.
      </p>
    </div>
  )
}
