"use client"

import { useMemo, useState, useCallback, useEffect, lazy, Suspense } from "react"
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
  MotionTransferData,
  VideoUpscaleData,
  ExtendVideoData,
  SpeechToVideoData,
  FaceSwapData,
  GeneratedScript,
  GeneratedScriptResult,
  CharacterNodeData,
} from "@/types/nodes"
import { VIDEO_I2V_MODELS, VIDEO_T2V_MODELS, VIDEO_V2V_MODELS, KIE_VIDEO_DURATIONS, KIE_T2V_DURATIONS, PROVIDERS_WITH_END_FRAME, KLING3_DURATIONS, VIDEO_RATIOS, SEEDANCE_2_VIDEO_RATIOS, PROVIDERS_WITH_REFERENCES, V2V_DURATION_OPTIONS, V2V_RESOLUTION_OPTIONS, V2V_ALEPH_ASPECT_RATIOS, getVideoResolutionOptions } from "./model-options"
import { isSeedance2Provider, SEEDANCE_2_REF_LIMITS, characterMentionSlug, DEFAULT_LABEL_BY_SOURCE, locationMentionSlug } from "@nodaro/shared"
import type { ReferenceSource } from "@nodaro/shared"
import { ModelSelectOption } from "./model-select-option"
import { ModelDescriptionHint } from "./model-description-hint"
import { MappableField } from "./mappable-field"
import { TagTextarea } from "./tag-textarea"
import type { RefImageItem } from "./tag-textarea"
import { PromptEditor } from "./prompt-editor"
import { Kling3StudioConfig } from "./kling3-studio-config"
import { AspectRatioSelector } from "./aspect-ratio-selector"
import { CameraMotionPicker } from "./camera-motion-picker"
import { ConnectedMediaList, getSourceThumbnail } from "./connected-media-list"
import { InjectedReferenceList } from "./injected-reference-list"
import { removeMentionToken, makeRemoveWiredSource, appendSuppressedSlug } from "./injected-reference-helpers"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { FinalPromptPreview } from "./final-prompt-preview"
import { ConnectedCinematographySources } from "./connected-cinematography-sources"
import { ExtraRefsSection } from "./extra-refs-section"
import type { ConfigProps, SourceNodeInfo } from "./types"
import { PromptHelperButton } from "./prompt-helper-button"
import type { ConnectedReference } from "@nodaro/shared"

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
  readonly characterSlug?: string
  readonly variantSlug?: string
  readonly variantDisplayName?: string
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

function buildVideoRefAutocomplete(
  sources: ReadonlyArray<SourceNodeInfo>,
): VideoRefAutocompleteEntry[] {
  const out: VideoRefAutocompleteEntry[] = []
  for (const s of sources) {
    const refSource = VIDEO_REF_SOURCE_BY_TYPE[s.type]
    if (!refSource) continue
    const nd = s.nodeData ?? {}

    // Character upstream: expand into canonical + one entry per asset variant
    // so the `@kira` / `@kira-smile` typeahead in the prompt editor sees them.
    if (s.type === "character") {
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
            characterSlug: slug,
            variantSlug: undefined,
            variantDisplayName: "canonical",
            defaultUsageMode,
            loraTrainingStatus,
          })
        }
        const assetArrays: Record<string, ReadonlyArray<{ readonly name: string; readonly url: string }>> = {
          expressions: charData.expressions ?? [],
          poses: charData.poses ?? [],
          motions: charData.motions ?? [],
          angles: charData.angles ?? [],
          bodyAngles: charData.bodyAngles ?? [],
          lightingVariations: charData.lightingVariations ?? [],
        }
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
              characterSlug: slug,
              variantSlug,
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
    if (s.type === "location") {
      const locName = (nd.locationName as string) || s.label || "Location"
      const locSlug = locationMentionSlug(locName) || undefined
      const sourceUrl = nd.sourceImageUrl as string | undefined
      if (sourceUrl && locSlug) {
        out.push({
          id: s.id,
          url: sourceUrl,
          defaultName: locName,
          source: "wired-location",
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

function toRefImageItems(entries: ReadonlyArray<VideoRefAutocompleteEntry>): RefImageItem[] {
  return entries.map((ref, i) => ({
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
    locationSlug: ref.locationSlug,
    locationVariantBucket: ref.locationVariantBucket,
    locationVariantSlug: ref.locationVariantSlug,
    locationVariantDisplayName: ref.locationVariantDisplayName,
    defaultUsageMode: ref.defaultUsageMode,
    loraTrainingStatus: ref.loraTrainingStatus,
  }))
}

export function ImageToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, onUpdateNode, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<ImageToVideoData> & { nodeId?: string }) {
  useEffect(() => { prefetchModelCredits(VIDEO_I2V_MODELS.map((m) => m.value)) }, [])
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  const currentI2VProvider = data.provider || "seedance-2-fast"

  // Fail-safe: when the current provider doesn't expose a resolution lever
  // (or the cached value isn't in its valid set), clear/snap so admin
  // defaults and stale state can't poison the request payload. Same for
  // duration — the rendered Select defaults to allowedDurations[0] when
  // data.duration is invalid, but without a snap data.duration carries the
  // stale value into the request and into credit pricing.
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
    const baseDurations = KIE_VIDEO_DURATIONS[currentI2VProvider] || null
    if (baseDurations && data.duration && !baseDurations.includes(data.duration)) {
      updates.duration = baseDurations[0]
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
    () => toRefImageItems(buildVideoRefAutocomplete(sources)),
    [sources],
  )


  const maxRefImages = data.provider === "grok-i2v" ? 6 : data.provider === "kling-3-omni" ? 7 : 3

  const hasEndFrame = connectedImages.some((img) => img.targetHandle === "endFrame")
  const seedance2Conflict = isSeedance2Provider(data.provider || "seedance-2-fast") && hasEndFrame && connectedRefImages.length > 0

  if (data.provider === "kling-3.0") {
    return <Kling3StudioConfig data={data} onUpdate={onUpdate} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} nodes={nodes} edges={edges} onUpdateNode={onUpdateNode} nodeId={nodeId} />
  }

  return (
    <div className="flex flex-col gap-3">
      <FinalPromptPreview userPrompt={data.prompt} negativePrompt={data.negativePrompt} consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
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
        <Select
          value={data.provider || "seedance-2-fast"}
          onValueChange={(v) => onUpdate({ provider: v as ImageToVideoData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {VIDEO_I2V_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.provider} />

      {isSeedance2Provider(currentI2VProvider) && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Input Mode</Label>
          <div className="flex rounded-md border border-border overflow-hidden">
            {(["frames", "references"] as const).map((mode) => {
              const active = (data.seedance2InputMode ?? "frames") === mode
              return (
                <button
                  key={mode}
                  type="button"
                  className={`flex-1 py-1 text-xs font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
                  onClick={() => { if (!active) onUpdate({ seedance2InputMode: mode }) }}
                >
                  {mode === "frames" ? "Frames" : "References"}
                </button>
              )
            })}
          </div>
        </div>
      )}

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
          {seedance2Conflict && (
            <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] leading-snug text-red-300">
              Reference images and end frame are mutually exclusive on Seedance 2. Disconnect the end frame <em>or</em> reference images before generating.
            </div>
          )}
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

      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="image-to-video" currentPrompt={data.prompt || ""} provider={data.provider} duration={data.duration} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />}>
        <PromptEditor
          rows={3}
          value={data.prompt || ""}
          onChange={(v) => onUpdate({ prompt: v })}
          placeholder="Describe the motion or animation you want..."
          referenceImages={refImagesForAutocomplete}
          nodeRefs={nodeRefs}
        />
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
                  4K is available via the dedicated VEO upgrade node — it runs after the base 720p/1080p generation completes.
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

      {data.provider === "kling-turbo" && (
        <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Textarea
            rows={2}
            value={(data as Record<string, unknown>).negativePrompt as string || ""}
            onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
            placeholder="Things to avoid..."
          />
        </MappableField>
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

      {data.provider === "kling-master" && (
        <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Textarea
            rows={2}
            value={(data as Record<string, unknown>).negativePrompt as string || ""}
            onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
            placeholder="Things to avoid..."
          />
        </MappableField>
      )}

      {data.provider === "kling-3-omni" && (
        <>
          <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <AspectRatioSelector
              options={[
                { value: "16:9", label: "16:9 (Landscape)" },
                { value: "9:16", label: "9:16 (Portrait)" },
                { value: "1:1", label: "1:1 (Square)" },
              ]}
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
          <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Textarea
              rows={2}
              value={(data as Record<string, unknown>).negativePrompt as string || ""}
              onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
              placeholder="Things to avoid..."
            />
          </MappableField>
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
                <SelectItem value="480p">480p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <AspectRatioSelector
              options={SEEDANCE_2_VIDEO_RATIOS}
              value={data.aspectRatio || "16:9"}
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

const V2V_IMAGE_TYPES = ["generate-image", "upload-image", "character", "object", "location", "edit-image", "image-to-image", "scene"]

export function VideoToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<VideoToVideoData> & { nodeId?: string }) {
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
    () => toRefImageItems(buildVideoRefAutocomplete(sources)),
    [sources],
  )

  return (
    <div className="flex flex-col gap-3">
      <FinalPromptPreview userPrompt={data.prompt} negativePrompt={data.negativePrompt} consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
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
        <Select
          value={provider}
          onValueChange={(v) => onUpdate({ provider: v as VideoToVideoData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {VIDEO_V2V_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.provider} />

      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="video-to-video" currentPrompt={data.prompt || ""} provider={data.provider} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />}>
        <PromptEditor
          rows={3}
          value={data.prompt}
          onChange={(v) => onUpdate({ prompt: v })}
          placeholder="Describe what to change or continue..."
          referenceImages={refImagesForAutocomplete}
          nodeRefs={nodeRefs}
        />
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
          <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <TagTextarea
              value={data.negativePrompt || ""}
              onChange={(v) => onUpdate({ negativePrompt: v || undefined })}
              placeholder="What to avoid..."
              rows={2}
              nodeRefs={nodeRefs}
              referenceImages={refImagesForAutocomplete}
              displayMode={variableDisplayMode}
              refMap={refMap}
            />
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

      <ConnectedCinematographySources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
    </div>
  )
}

const MOTION_VIDEO_NODE_TYPES = new Set(["image-to-video", "text-to-video", "video-to-video", "upload-video", "motion-transfer", "extend-video", "speech-to-video"])

export function MotionTransferConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<MotionTransferData> & { nodeId?: string }) {
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

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={provider}
          onValueChange={(v) => onUpdate({ provider: v as MotionTransferData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="kling">Kling 2.6</SelectItem>
            <SelectItem value="kling-3.0">Kling 3.0</SelectItem>
            <SelectItem value="wan-animate-move">Wan Animate Move</SelectItem>
            <SelectItem value="wan-animate-replace">Wan Animate Replace</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="prompt" label="Prompt (Optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="motion-transfer" currentPrompt={data.prompt || ""} provider={data.provider} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />}>
        <TagTextarea
          value={data.prompt}
          onChange={(v) => onUpdate({ prompt: v.slice(0, 2500) })}
          placeholder="Optional: Describe the motion transfer..."
          rows={2}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
        <span className="text-xs text-muted-foreground">{data.prompt?.length || 0}/2500</span>
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
    </div>
  )
}

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

export function TextToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<TextToVideoData> & { nodeId?: string }) {
  useEffect(() => { prefetchModelCredits(VIDEO_T2V_MODELS.map((m) => m.value)) }, [])
  const currentProvider = data.provider || "seedance-2-fast"
  const allowedDurations = KIE_T2V_DURATIONS[currentProvider] || null
  const isSeedance2 = isSeedance2Provider(currentProvider)

  // Fail-safe: keep `data.resolution` and `data.duration` consistent with
  // the current provider's valid sets, or clear/snap when invalid.
  // See ImageToVideoConfig for the rationale.
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
    const baseDurations = KIE_T2V_DURATIONS[currentProvider] || null
    if (baseDurations && data.duration && !baseDurations.includes(data.duration)) {
      updates.duration = baseDurations[0]
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
    () => toRefImageItems(buildVideoRefAutocomplete(sources)),
    [sources],
  )

  if (data.provider === "kling-3.0") {
    return <Kling3StudioConfig data={data as unknown as ImageToVideoData} onUpdate={onUpdate} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} nodes={nodes} />
  }

  return (
    <div className="flex flex-col gap-3">
      <FinalPromptPreview userPrompt={data.prompt} negativePrompt={data.negativePrompt} consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <Select
          value={currentProvider}
          onValueChange={(v) => onUpdate({ provider: v })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {VIDEO_T2V_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={currentProvider} />
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="text-to-video" currentPrompt={data.prompt || ""} provider={currentProvider} duration={data.duration} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />}>
        <PromptEditor
          rows={3}
          value={data.prompt}
          onChange={(v) => onUpdate({ prompt: v })}
          placeholder="Describe the video to generate..."
          referenceImages={refImagesForAutocomplete}
          nodeRefs={nodeRefs}
        />
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
                  4K is available via the dedicated VEO upgrade node — it runs after the base 720p/1080p generation completes.
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
                <SelectItem value="480p">480p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
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

      <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <AspectRatioSelector
          options={isSeedance2 ? SEEDANCE_2_VIDEO_RATIOS : VIDEO_RATIOS}
          value={data.aspectRatio}
          onValueChange={(v) => onUpdate({ aspectRatio: v as TextToVideoData["aspectRatio"] })}
        />
      </MappableField>
      <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={2}
          value={data.negativePrompt}
          onChange={(v) => onUpdate({ negativePrompt: v })}
          placeholder="Things to avoid..."
          nodeRefs={nodeRefs}
          referenceImages={refImagesForAutocomplete}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>

      <ConnectedCinematographySources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
    </div>
  )
}

export function ExtendVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<ExtendVideoData> & { nodeId?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <FinalPromptPreview userPrompt={data.prompt} negativePrompt={data.negativePrompt} consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <Select
          value={data.provider || "veo-extend"}
          onValueChange={(v) => onUpdate({ provider: v as ExtendVideoData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="runway-extend">Runway Extend</SelectItem>
            <SelectItem value="veo-extend">VEO Extend</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>

      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="extend-video" currentPrompt={data.prompt || ""} provider={data.provider} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />}>
        <TagTextarea
          value={data.prompt || ""}
          onChange={(v) => onUpdate({ prompt: v })}
          placeholder="Describe how the video should continue..."
          rows={3}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
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

      <p className="text-xs text-muted-foreground px-1">
        Extends a VEO or Runway video with a new prompt. Connect an upstream Image to Video or Text to Video node that produces a kieTaskId.
      </p>

      <ConnectedCinematographySources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
    </div>
  )
}


export function SpeechToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeId }: ConfigProps<SpeechToVideoData> & { nodeId?: string }) {
  useEffect(() => { prefetchModelCredits(["speech-to-video", "speech-to-video:580p", "speech-to-video:720p"]) }, [])
  const [showAdvanced, setShowAdvanced] = useState(false)

  return (
    <div className="flex flex-col gap-3">
      <FinalPromptPreview userPrompt={data.prompt} negativePrompt={data.negativePrompt} consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
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
          <PromptHelperButton
            nodeType="speech-to-video"
            currentPrompt={data.prompt || ""}
            onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })}
          />
        </div>
        <Textarea
          value={data.prompt || ""}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder="Describe the speaking scene..."
          className="min-h-[80px] text-sm"
        />
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

      {/* Negative Prompt */}
      <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          value={data.negativePrompt || ""}
          onChange={(e) => onUpdate({ negativePrompt: e.target.value || undefined })}
          placeholder="What to avoid..."
          className="min-h-[60px] text-sm"
        />
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
    </div>
  )
}
