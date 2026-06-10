"use client"

import { useState, useRef, useEffect, Suspense, useMemo, memo } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { optimizedImageUrl } from "@/lib/image"
import { X, FileText, Plus, UserPlus, Loader2, Upload, UserCircle, Package, MapPin, Paintbrush } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { TagTextarea } from "./tag-textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { CachedImage } from "@/components/ui/cached-image"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { prefetchModelCredits } from "@/ee/hooks/use-model-credits"
import { useMediaEditor, MediaEditorModal } from "@/components/editor/media-editor"
import { PromptHelperButton } from "./prompt-helper-button"
import type {
  GenerateImageData,
  ModifyImageData,
  UpscaleImageData,
  RemoveBackgroundData,
  GenerateMaskData,
  CharacterDefinition,
  CharacterNodeData,
  ManualReferenceImage,
  ImageProvider,
} from "@/types/nodes"
import { IMAGE_GEN_MODELS, MODIFY_IMAGE_MODELS, UPSCALE_IMAGE_MODELS, IMAGE_STYLE_PRESETS, getAspectRatiosForModel, IMAGE_RESOLUTION_OPTIONS, IMAGE_QUALITY_OPTIONS, TOPAZ_IMAGE_RESOLUTIONS, MODELS_WITH_REFERENCE_IMAGE_SUPPORT, REF_IMAGE_MAX_LIMITS, DEFAULT_REF_IMAGE_MAX, I2I_STRENGTH_SUPPORT, I2I_MASK_SUPPORT, SEED_SUPPORT, RENDERING_SPEED_SUPPORT, GUIDANCE_SCALE_SUPPORT, defaultResolutionFor } from "./model-options"
import { ModelSelectOption } from "./model-select-option"
import { ModelSearchSelect } from "./model-search-select"
import { ModelDescriptionHint } from "./model-description-hint"
import { MultiProviderPicker } from "./multi-provider-picker"
import { intersectModelOptions } from "@/lib/multi-provider/intersect-model-options"
import { MappableField } from "./mappable-field"
import { AspectRatioSelector } from "./aspect-ratio-selector"
import { ReferenceImageList } from "./reference-image-list"
import { InjectedReferenceList } from "./injected-reference-list"
import { removeMentionToken, makeRemoveWiredSource, appendSuppressedSlug } from "./injected-reference-helpers"
import { ExtraRefsSection } from "./extra-refs-section"
import type { RefImageItem } from "./tag-textarea"
import { PromptEditor } from "./prompt-editor"
import { ReferenceSupportWarning } from "./reference-support-warning"
import type { ConnectedReference, ReferenceSource } from "@nodaro/shared"
import { DEFAULT_LABEL_BY_SOURCE, characterMentionSlug, locationMentionSlug, expandExtraRefsToConnectedReferences } from "@nodaro/shared"
import { buildImageConnectedReferences, connectedReferencesToRefImages } from "./connected-references"
import { ConnectedMediaList } from "./connected-media-list"
import { FinalPromptPreview } from "./final-prompt-preview"
import { ConnectedCinematographySources } from "./connected-cinematography-sources"
import { hasConnectedStyleNode } from "@/lib/cinematography-hints"
import type { ConfigProps } from "./types"
import type { SelectedAsset } from "../asset-selection-modal"

const AssetSelectionModal = lazy(() => import("../asset-selection-modal").then(m => ({ default: m.AssetSelectionModal })))
const MaskPainterModal = lazy(() => import("../mask-painter-modal").then(m => ({ default: m.MaskPainterModal })))

const IMAGE_SOURCE_TYPES = new Set(["upload-image", "generate-image", "edit-image", "image-to-image", "modify-image", "upscale-image", "remove-background"])

/** Location variant buckets — kept in lockstep with backend
 *  `LOCATION_VARIANT_BUCKETS` in payload-builder.ts and the runtime path in
 *  `execute-node.ts`. Used here to expand a wired Location upstream into one
 *  `ConnectedReference` entry per (bucket, variant) pair so the
 *  `@`-autocomplete surfaces every variant for selection. */
const IMAGE_LOCATION_VARIANT_BUCKETS = [
  "timeOfDay",
  "weather",
  "seasons",
  "angles",
  "lighting",
  "atmosphereMotions",
] as const

/**
 * Expand a wired Location upstream into canonical + per-variant
 * `ConnectedReference` entries. The canonical entry holds the location's
 * main image; each variant entry holds one (bucket, name, url) triple from
 * the location node's per-bucket asset arrays. Mirrors
 * `expandLocationNodeIntoRefs` in execute-node.ts (runtime path) for
 * slice 3 of Location Studio Phase 2 #2.
 *
 * Returns null when the location has no source image (caller falls back to
 * the generic single-entry handling).
 */
function expandLocationSourceForAutocomplete(
  sourceId: string,
  nd: Record<string, unknown>,
  fallbackLabel: string,
): Array<ConnectedReference> | null {
  const locName = (nd.locationName as string) || fallbackLabel || "Location"
  const locSlug = locationMentionSlug(locName)
  const sourceUrl = nd.sourceImageUrl as string | undefined
  if (!sourceUrl || !locSlug) return null
  const description = (nd.description as string | undefined) ?? undefined
  const canonicalDescription = (nd.canonicalDescription as string | null | undefined) ?? null
  const entries: ConnectedReference[] = []
  entries.push({
    id: sourceId,
    defaultName: locName,
    source: "wired-location",
    description,
    url: sourceUrl,
    locationSlug: locSlug,
    locationCanonicalDescription: canonicalDescription,
    locationVariantDisplayName: "canonical",
  })
  for (const bucket of IMAGE_LOCATION_VARIANT_BUCKETS) {
    const items = nd[bucket]
    if (!Array.isArray(items)) continue
    for (const item of items) {
      const variantName = (item as { name?: string }).name
      const variantUrl = (item as { url?: string }).url
      if (!variantName || !variantUrl) continue
      const variantSlug = locationMentionSlug(variantName)
      if (!variantSlug) continue
      entries.push({
        id: `${sourceId}_${bucket}_${variantSlug}`,
        defaultName: `${locName} / ${variantName}`,
        source: "wired-location",
        description,
        url: variantUrl,
        locationSlug: locSlug,
        locationCanonicalDescription: canonicalDescription,
        locationVariantBucket: bucket,
        locationVariantSlug: variantSlug,
        locationVariantDisplayName: variantName,
      })
    }
  }
  return entries
}

// REF_IMAGE_MAX_LIMITS / DEFAULT_REF_IMAGE_MAX live in @nodaro/shared (model-constants).

function GenerateImageConfigImpl({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<GenerateImageData> & { nodeId?: string }) {
  useEffect(() => { prefetchModelCredits(IMAGE_GEN_MODELS.map((m) => m.value)) }, [])

  // The selected providers list is the source of truth. Legacy data with only
  // `data.provider` set falls back to `[data.provider]` so existing workflows work.
  const providersList = useMemo<readonly ImageProvider[]>(
    () => (data.providers && data.providers.length > 0
      ? data.providers
      : [data.provider || "nano-banana-pro"]),
    [data.providers, data.provider],
  )
  const currentProvider = providersList[0] || "nano-banana-pro"
  const isMulti = providersList.length > 1

  // Narrow option sets to what ALL selected providers support (intersection).
  // Single-provider mode falls back to that provider's full set.
  const intersected = useMemo(() => intersectModelOptions(providersList), [providersList])
  const aspectRatioOptions = isMulti
    ? intersected.aspectRatios
    : getAspectRatiosForModel(currentProvider)
  const resolutionOptions = isMulti
    ? (intersected.resolutions.length > 0 ? intersected.resolutions : undefined)
    : IMAGE_RESOLUTION_OPTIONS[currentProvider]
  const qualityOptions = isMulti
    ? (intersected.qualities.length > 0 ? intersected.qualities : undefined)
    : IMAGE_QUALITY_OPTIONS[currentProvider]
  const supportsRefImage = isMulti
    ? intersected.supportsReferenceImage
    : MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(currentProvider)

  const supportsSeed = SEED_SUPPORT.has(currentProvider)
  const supportsRenderingSpeed = RENDERING_SPEED_SUPPORT.has(currentProvider)
  const maxRefImages = REF_IMAGE_MAX_LIMITS[currentProvider] ?? DEFAULT_REF_IMAGE_MAX
  // i2i levers — only shown for providers that accept them (single-provider
  // mode; in multi mode the i2i inpaint loop is not offered).
  const strengthConfig = isMulti ? undefined : I2I_STRENGTH_SUPPORT[currentProvider]
  const guidanceScaleConfig = isMulti ? undefined : GUIDANCE_SCALE_SUPPORT[currentProvider]

  // When the cohort changes (provider added/removed/swapped), reset narrowed
  // fields whose current value isn't supported by all providers, and drop ref
  // images if the cohort no longer supports them.
  useEffect(() => {
    const updates: Partial<GenerateImageData> = {}
    const aspectValues = aspectRatioOptions.map((o) => o.value)
    if (data.aspectRatio && !aspectValues.includes(data.aspectRatio)) {
      updates.aspectRatio = aspectValues[0] || "1:1"
    }
    // Resolution: if provider exposes this lever, snap to a valid option;
    // if it does NOT, clear the stale value so the backend Zod enum
    // (1K|2K|4K) doesn't reject what the provider doesn't even use.
    // Flux 2 uses ascending MP options ("0.5 MP"…"4 MP"), so we snap to
    // the provider default (2 MP Pro/Max, 1 MP Klein) instead of options[0]
    // (0.5 MP) when the current value is absent or invalid.
    const flux2Default = defaultResolutionFor(currentProvider)
    if (resolutionOptions) {
      if (flux2Default) {
        const valid = resolutionOptions.some((o) => o.value === data.resolution)
        if (!valid && data.resolution !== flux2Default) updates.resolution = flux2Default
      } else if (data.resolution && !resolutionOptions.some((o) => o.value === data.resolution)) {
        updates.resolution = resolutionOptions[0]?.value
      }
    } else if (data.resolution !== undefined) {
      updates.resolution = undefined
    }
    if (qualityOptions) {
      if (data.quality && !qualityOptions.some((o) => o.value === data.quality)) {
        updates.quality = qualityOptions[0]?.value
      }
    } else if (data.quality !== undefined) {
      updates.quality = undefined
    }
    // KIE constraints for gpt-image-2 (per docs.kie.ai gpt-image-2 spec):
    //   • aspect_ratio = auto → resolution must be 1K
    //   • aspect_ratio = 1:1 → resolution cannot be 4K
    // Apply silently here so the user can't get a 400 at generate-time.
    const isGptImage2 = currentProvider === "gpt-image-2" || currentProvider === "gpt-image-2-i2i"
    if (isGptImage2) {
      const ar = updates.aspectRatio ?? data.aspectRatio
      const res = updates.resolution ?? data.resolution
      if (ar === "auto" && res !== "1K") {
        updates.resolution = "1K"
      } else if (ar === "1:1" && res === "4K") {
        updates.resolution = "2K"
      }
    }
    if (!supportsRefImage && data.referenceImageUrl) {
      updates.referenceImageUrl = undefined
    }
    if (!supportsRefImage && data.referenceImageUrls?.length) {
      updates.referenceImageUrls = undefined
      updates.referenceImageOrder = undefined
    }
    // i2i levers: clear stale values when the new provider doesn't expose them
    // so the backend route's Zod schema doesn't reject params the provider can't
    // accept. maskUrl is NOT provider-gated in Phase 1 (the composite inpaint
    // floor works on all providers), so it is intentionally left untouched.
    if (data.strength != null && !I2I_STRENGTH_SUPPORT[currentProvider]) updates.strength = undefined
    if (data.guidanceScale != null && !GUIDANCE_SCALE_SUPPORT[currentProvider]) updates.guidanceScale = undefined
    if (Object.keys(updates).length > 0) {
      onUpdate(updates)
    }
  }, [providersList, currentProvider, data.aspectRatio]) // eslint-disable-line react-hooks/exhaustive-deps

  // Migrate legacy single referenceImageUrl to new multi-image format
  useEffect(() => {
    if (data.referenceImageUrl && !data.referenceImageUrls?.length) {
      const migrated: ManualReferenceImage = { id: crypto.randomUUID(), url: data.referenceImageUrl }
      onUpdate({ referenceImageUrls: [migrated], referenceImageUrl: undefined })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [isCustomStyle, setIsCustomStyle] = useState(
    () => !!data.style && !IMAGE_STYLE_PRESETS.some((p) => p.value === data.style)
  )
  const styleNodeConnected = hasConnectedStyleNode(nodeId, nodes, edges ?? [])
  const [showAssetLibrary, setShowAssetLibrary] = useState(false)
  const [showDefineNewMenu, setShowDefineNewMenu] = useState(false)
  const refImageInputRef = useRef<HTMLInputElement>(null)
  const [uploadingRefImage, setUploadingRefImage] = useState(false)
  const [showMaskPainter, setShowMaskPainter] = useState(false)
  const genImgMediaEditor = useMediaEditor({
    onComplete: async (results) => {
      const currentManual = [...(data.referenceImageUrls ?? [])]
      for (const result of results) {
        const url = result.processedUrl ?? result.uploadResult.url
        const newImg: ManualReferenceImage = { id: crypto.randomUUID(), url }
        currentManual.push(newImg)
      }
      onUpdate({ referenceImageUrls: currentManual })
      setUploadingRefImage(false)
    },
    onCancel: () => setUploadingRefImage(false),
  })
  const allCharDefs = useWorkflowStore((s) => s.characterDefinitions)
  const addCharacterDefinition = useWorkflowStore((s) => s.addCharacterDefinition)
  const addNode = useWorkflowStore((s) => s.addNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const attachedIds = data.characterDefinitionIds ?? []
  const attachedChars = allCharDefs.filter((c) => attachedIds.includes(c.id))

  function detachCharacter(id: string) {
    onUpdate({ characterDefinitionIds: attachedIds.filter((cid) => cid !== id) })
  }

  function handleDefineNewAsset(assetType: "character" | "object" | "location") {
    const maxX = nodes.length > 0 ? Math.max(...nodes.map((n) => n.position.x)) + 300 : 200
    const avgY = nodes.length > 0 ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length : 200
    const newNodeId = addNode(assetType, { x: maxX, y: avgY })
    if (newNodeId) {
      selectNode(newNodeId)
    }
    setShowDefineNewMenu(false)
  }

  function handleAssetSelected(asset: SelectedAsset) {
    const charDef: CharacterDefinition = {
      id: asset.id,
      name: asset.name,
      type: asset.thumbnailUrl ? "reference" : "description",
      category: asset.type,
      referenceImageUrl: asset.thumbnailUrl,
      description: asset.description,
    }
    const exists = allCharDefs.some((c) => c.id === asset.id)
    if (!exists) {
      addCharacterDefinition(charDef)
    }
    if (!attachedIds.includes(asset.id)) {
      onUpdate({ characterDefinitionIds: [...attachedIds, asset.id] })
    }
  }

  // Resolve wired images from upstream image-producing nodes
  const wiredImages = useMemo(() => {
    return sources
      .filter((s) => IMAGE_SOURCE_TYPES.has(s.type))
      .map((s) => {
        const nd = s.nodeData ?? {}
        const url = (nd.generatedImageUrl as string) || (nd.url as string) || ""
        return { id: s.id, url, label: s.label || s.type }
      })
      .filter((w) => w.url)
  }, [sources])

  // Resolve character reference images
  const charRefImages = useMemo(() => {
    return attachedChars
      .filter((c) => c.referenceImageUrl)
      .map((c) => ({ id: `char_${c.id}`, url: c.referenceImageUrl!, label: c.name }))
  }, [attachedChars])

  // (refImagesForAutocomplete is derived below, after connectedReferences is built.)

  // Rich connectedReferences for the FinalPromptPreview — mirrors the runtime
  // path through buildImagePrompt so the preview shows the same fidelity
  // blocks the model will actually receive.
  const connectedReferences = useMemo<ConnectedReference[]>(
    () => buildImageConnectedReferences({ data, sources, nodes, attachedChars }),
    [data.referenceImageUrls, data.referenceImageOrder, data.extraRefs, sources, attachedChars, nodes],
  )

  // Ordered reference-image list for the "@" autocomplete trigger. Derived from
  // connectedReferences so the default label per source is preserved.
  const refImagesForAutocomplete = useMemo<RefImageItem[]>(
    () => connectedReferencesToRefImages(connectedReferences),
    [connectedReferences],
  )

  // Inpaint base image. The node's own current result drives the in-place
  // inpaint loop (paint a mask on the last render, regenerate). If there's no
  // result yet, fall back to a connected upstream image (excluding the mask
  // input). An explicit `data.baseImageUrl` (persisted on a prior paint) wins.
  const currentResultUrl = data.generatedResults?.[data.activeResultIndex ?? 0]?.url ?? data.generatedImageUrl
  const upstreamImageUrl = useMemo(() => {
    const imgSource = sources.find((s) => IMAGE_SOURCE_TYPES.has(s.type) && s.targetHandle !== "mask")
    if (imgSource?.nodeData) {
      return (imgSource.nodeData.generatedImageUrl as string) || (imgSource.nodeData.url as string)
    }
    return undefined
  }, [sources])
  const sourceImageUrl = data.baseImageUrl ?? currentResultUrl ?? upstreamImageUrl

  function handleRefImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploadingRefImage(true)
    genImgMediaEditor.openEditor(Array.from(files))
    if (refImageInputRef.current) refImageInputRef.current.value = ""
  }

  return (
    <div className="flex flex-col gap-3">
      <FinalPromptPreview
        userPrompt={data.prompt}
        style={data.style}
        negativePrompt={data.negativePrompt}
        consumerNodeId={nodeId}
        nodes={nodes}
        edges={edges ?? []}
        provider={currentProvider}
        connectedReferences={connectedReferences}
        identityMeta={data.identityMeta}
      />
      {/* Provider — primary decision, determines which model-specific fields appear below */}
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="image">
        <MultiProviderPicker
          providers={providersList}
          options={IMAGE_GEN_MODELS}
          onChange={(next) => onUpdate({ providers: next, provider: next[0] })}
          renderHint={(p) => <ModelDescriptionHint modelId={p} />}
        />
        <ReferenceSupportWarning
          provider={currentProvider}
          prompt={data.prompt}
          attachedRefCount={connectedReferences.length}
        />
      </MappableField>

      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="generate-image" currentPrompt={data.prompt || ""} provider={currentProvider} aspectRatio={data.aspectRatio} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />}>
        <PromptEditor
          rows={3}
          value={data.prompt}
          onChange={(v) => onUpdate({ prompt: v })}
          placeholder="Describe the image to generate..."
          referenceImages={refImagesForAutocomplete}
          nodeRefs={nodeRefs}
          refMap={refMap}
        />
      </MappableField>
      <MappableField field="style" label="Style" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={isCustomStyle ? "__custom__" : (data.style || "__none__")}
          onValueChange={(v) => {
            if (v === "__custom__") {
              setIsCustomStyle(true)
              onUpdate({ style: "" })
            } else if (v === "__none__") {
              setIsCustomStyle(false)
              onUpdate({ style: "" })
            } else {
              setIsCustomStyle(false)
              onUpdate({ style: v })
            }
          }}
          disabled={styleNodeConnected}
        >
          <SelectTrigger aria-label="Style"><SelectValue placeholder="No style" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No style</SelectItem>
            {IMAGE_STYLE_PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
            <SelectItem value="__custom__">Custom...</SelectItem>
          </SelectContent>
        </Select>
        {isCustomStyle && !styleNodeConnected && (
          <Input
            className="mt-1.5"
            value={data.style}
            onChange={(e) => onUpdate({ style: e.target.value })}
            placeholder="Describe your style..."
            autoFocus
          />
        )}
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {styleNodeConnected
            ? "Bypassed — using connected Style node"
            : "Appended to prompt as style guidance"}
        </p>
      </MappableField>
      <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={2}
          value={data.negativePrompt}
          onChange={(v) => onUpdate({ negativePrompt: v })}
          placeholder="Things to avoid..."
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
        <p className="text-[10px] text-muted-foreground mt-0.5">Appended to prompt as exclusion guidance</p>
      </MappableField>

      <ExtraRefsSection
        extraRefs={data.extraRefs}
        onChange={(next) => onUpdate({ extraRefs: next })}
        consumerNodeId={nodeId}
        nodes={nodes}
        edges={edges ?? []}
      />

      {/* Assets section (characters, locations, objects) — descriptions work for all models */}
      <div className="pt-1">
        <Separator className="mb-3" />
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Assets</label>
        <div className="flex flex-col gap-1.5 mt-2">
          {attachedChars.map((char) => (
            <div key={char.id} className="flex items-start gap-2 p-2 rounded-md border bg-muted/30">
              {char.referenceImageUrl ? (
                <CachedImage src={char.referenceImageUrl} alt={char.name} className="w-8 h-8 rounded object-cover flex-shrink-0" thumbnail thumbnailWidth={80} />
              ) : (
                <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
                  <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-medium truncate">{char.name}</span>
                  <span className={`text-[9px] px-1 py-0.5 rounded ${
                    char.category === "location" ? "bg-cyan-500/10 text-cyan-500"
                    : char.category === "object" ? "bg-emerald-500/10 text-emerald-500"
                    : char.referenceImageUrl ? "bg-blue-500/10 text-blue-500"
                    : "bg-orange-500/10 text-orange-500"
                  }`}>
                    {char.category === "location" ? "location" : char.category === "object" ? "object" : char.referenceImageUrl ? "ref" : "desc"}
                  </span>
                  {char.type === "description" && !char.referenceImageUrl && (
                    <span className="text-[8px] text-orange-500" title="Needs reference image for reuse">needs ref</span>
                  )}
                </div>
                {char.type === "description" && char.description && (
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">{char.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => detachCharacter(char.id)}
                className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {attachedChars.length === 0 && (
            <p className="text-[10px] text-muted-foreground/60">No assets attached. Add characters, locations, or objects for visual consistency.</p>
          )}
        </div>

        {/* Add buttons */}
        <div className="flex gap-1.5 mt-2">
          <button
            type="button"
            onClick={() => setShowAssetLibrary(true)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border hover:bg-muted transition-colors"
          >
            <Plus className="w-3 h-3" /> Add from Library
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowDefineNewMenu(!showDefineNewMenu)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border hover:bg-muted transition-colors"
            >
              <UserPlus className="w-3 h-3" /> Create new
            </button>
            {showDefineNewMenu && (
              <div className="absolute top-full left-0 mt-1 w-36 rounded-md border bg-popover shadow-md z-30">
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs hover:bg-pink-500/10 transition-colors flex items-center gap-2"
                  onClick={() => handleDefineNewAsset("character")}
                >
                  <UserCircle className="w-4 h-4 text-pink-500" />
                  <span>Character</span>
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs hover:bg-emerald-500/10 transition-colors flex items-center gap-2"
                  onClick={() => handleDefineNewAsset("object")}
                >
                  <Package className="w-4 h-4 text-emerald-500" />
                  <span>Object</span>
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs hover:bg-cyan-500/10 transition-colors flex items-center gap-2"
                  onClick={() => handleDefineNewAsset("location")}
                >
                  <MapPin className="w-4 h-4 text-cyan-500" />
                  <span>Location</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Model-specific settings — these change based on selected provider */}
      <div className="pt-1">
        <Separator className="mb-3" />
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Model Settings</label>
        <div className="flex flex-col gap-3 mt-2">
          <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <AspectRatioSelector
              options={aspectRatioOptions}
              value={data.aspectRatio || aspectRatioOptions[0]?.value || "1:1"}
              onValueChange={(v) => onUpdate({ aspectRatio: v })}
            />
          </MappableField>
          {resolutionOptions && (
            <MappableField field="resolution" label="Resolution" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
              <Select
                value={data.resolution || resolutionOptions[0]?.value || "1K"}
                onValueChange={(v) => onUpdate({ resolution: v })}
              >
                <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {resolutionOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MappableField>
          )}
          {qualityOptions && (
            <MappableField field="quality" label="Quality" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
              <Select
                value={data.quality || qualityOptions[0]?.value}
                onValueChange={(v) => onUpdate({ quality: v })}
              >
                <SelectTrigger aria-label="Quality"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {qualityOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MappableField>
          )}
          {supportsRefImage && (
            <>
              <input ref={refImageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleRefImageUpload} />
              {/* Unified injected-references list — shows wired upstreams,
                  character canonicals, @-mention variants AND canonical
                  fallbacks in the EXACT API order. Drag to reorder. × removes:
                  edges (wired), mention tokens (@-mention), or adds to the
                  suppression list (canonical fallback). */}
              <InjectedReferenceList
                connectedReferences={connectedReferences}
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
              {/* Legacy ReferenceImageList kept for the upload UI + per-row
                  manual ref removal. The InjectedReferenceList above shows
                  the SAME entries plus mention variants + canonical fallbacks
                  that the old list never surfaced. */}
              <ReferenceImageList
                manualImages={data.referenceImageUrls ?? []}
                imageOrder={data.referenceImageOrder ?? []}
                wiredImages={wiredImages}
                charRefImages={charRefImages}
                maxImages={maxRefImages}
                onUpdateManualImages={(imgs) => onUpdate({ referenceImageUrls: imgs })}
                onUpdateOrder={(order) => onUpdate({ referenceImageOrder: order })}
                onUpload={() => refImageInputRef.current?.click()}
                uploadingRef={uploadingRefImage}
              />
            </>
          )}
          {supportsRenderingSpeed && (
            <div>
              <Label className="text-xs">Rendering Speed</Label>
              <Select
                value={data.renderingSpeed || "BALANCED"}
                onValueChange={(v) => onUpdate({ renderingSpeed: v })}
              >
                <SelectTrigger aria-label="Rendering Speed" className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TURBO">Turbo (Faster, lower cost)</SelectItem>
                  <SelectItem value="BALANCED">Balanced (Default)</SelectItem>
                  <SelectItem value="QUALITY">Quality (Best, higher cost)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-0.5">Affects generation speed and credit cost</p>
            </div>
          )}
          {currentProvider === "ideogram-v3" && (
            <>
              <div>
                <Label className="text-xs">Style Type</Label>
                <Select
                  value={data.styleType || "AUTO"}
                  onValueChange={(v) => onUpdate({ styleType: v })}
                >
                  <SelectTrigger aria-label="Style Type" className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUTO">Auto</SelectItem>
                    <SelectItem value="GENERAL">General</SelectItem>
                    <SelectItem value="REALISTIC">Realistic</SelectItem>
                    <SelectItem value="DESIGN">Design</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="expandPrompt"
                  checked={data.expandPrompt ?? false}
                  onChange={(e) => onUpdate({ expandPrompt: e.target.checked })}
                  className="rounded border-border"
                />
                <Label htmlFor="expandPrompt" className="text-xs cursor-pointer">Expand Prompt</Label>
                <p className="text-[10px] text-muted-foreground">Auto-enhance prompt for better results</p>
              </div>
            </>
          )}
          {strengthConfig && (
            <div>
              <Label className="text-xs">Strength</Label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="range"
                  min={strengthConfig.min}
                  max={strengthConfig.max}
                  step={strengthConfig.step}
                  value={data.strength ?? strengthConfig.default}
                  onChange={(e) => onUpdate({ strength: parseFloat(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground w-8 text-right">
                  {(data.strength ?? strengthConfig.default).toFixed(2)}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">Lower = closer to original, higher = more creative</p>
            </div>
          )}
          {guidanceScaleConfig && (
            <div>
              <Label className="text-xs">Guidance Scale</Label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="range"
                  min={guidanceScaleConfig.min}
                  max={guidanceScaleConfig.max}
                  step={guidanceScaleConfig.step}
                  value={data.guidanceScale ?? guidanceScaleConfig.default}
                  onChange={(e) => onUpdate({ guidanceScale: parseFloat(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground w-8 text-right">
                  {(data.guidanceScale ?? guidanceScaleConfig.default).toFixed(1)}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">Higher = stricter prompt adherence</p>
            </div>
          )}
          {supportsSeed && (
            <div>
              <Label className="text-xs">Seed</Label>
              <Input
                type="number"
                min={0}
                className="mt-1"
                value={data.seed ?? ""}
                onChange={(e) => {
                  const val = e.target.value
                  onUpdate({ seed: val === "" ? undefined : parseInt(val, 10) })
                }}
                placeholder="Random (leave empty)"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">Fixed seed for reproducible results</p>
            </div>
          )}
        </div>
      </div>

      {/* Inpainting Mask — paint over the node's current result (or a connected
          upstream image) to drive the worker's inpaint composite. Persists
          baseImageUrl alongside the mask so the worker knows which image the
          mask applies to. Not provider-gated: the composite floor works on all
          providers (Phase 1). */}
      {sourceImageUrl && (
        <div className="pt-1">
          <Separator className="mb-3" />
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Inpainting Mask</label>
          <div className="flex flex-col gap-2 mt-2">
            {data.maskUrl ? (
              <div className="flex items-center gap-2">
                <img src={optimizedImageUrl(data.maskUrl)} alt="Mask" className="w-16 h-16 object-cover rounded border border-[#2D2D2D]" />
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => setShowMaskPainter(true)}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border hover:bg-muted transition-colors"
                  >
                    <Paintbrush className="w-3 h-3" /> Edit Mask
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdate({ maskUrl: undefined })}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border hover:bg-destructive/10 hover:text-destructive transition-colors"
                  >
                    <X className="w-3 h-3" /> Clear Mask
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowMaskPainter(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-md border border-dashed hover:bg-muted transition-colors"
              >
                <Paintbrush className="w-3.5 h-3.5" />
                Paint Mask
              </button>
            )}
            <p className="text-[10px] text-muted-foreground">White areas in the mask will be edited, black areas preserved</p>
          </div>
          <Suspense fallback={null}>
            <MaskPainterModal
              isOpen={showMaskPainter}
              onClose={() => setShowMaskPainter(false)}
              imageUrl={sourceImageUrl}
              initialMaskUrl={data.maskUrl}
              onSave={(maskUrl) => onUpdate({ maskUrl, baseImageUrl: sourceImageUrl })}
            />
          </Suspense>
        </div>
      )}

      {showAssetLibrary && (
        <Suspense fallback={null}>
          <AssetSelectionModal
            isOpen={showAssetLibrary}
            onClose={() => setShowAssetLibrary(false)}
            onSelect={handleAssetSelected}
            title="Select Asset from Library"
            excludeIds={attachedIds}
          />
        </Suspense>
      )}

      <MediaEditorModal editor={genImgMediaEditor} />

      <ConnectedCinematographySources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
    </div>
  )
}

// Memoized so a ConfigPanel re-render whose props (configProps) are unchanged —
// e.g. an unrelated async load (userId), fullscreen toggle, or mobile-sheet
// drag — skips reconciling this ~840-line subtree.
export const GenerateImageConfig = memo(GenerateImageConfigImpl)

function ModifyImageConfigImpl({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<ModifyImageData> & { nodeId?: string }) {
  useEffect(() => { prefetchModelCredits(MODIFY_IMAGE_MODELS.map((m) => m.value)) }, [])
  const currentProvider = data.provider || "nano-banana"
  const isNanoBananaEdit = currentProvider === "nano-banana-edit"
  const supportsRefImage = !isNanoBananaEdit && MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(currentProvider)
  const aspectRatioOptions = useMemo(() => getAspectRatiosForModel(currentProvider), [currentProvider])
  const resolutionOptions = useMemo(() => !isNanoBananaEdit ? IMAGE_RESOLUTION_OPTIONS[currentProvider] : undefined, [currentProvider, isNanoBananaEdit])
  const qualityOptions = useMemo(() => !isNanoBananaEdit ? IMAGE_QUALITY_OPTIONS[currentProvider] : undefined, [currentProvider, isNanoBananaEdit])
  const strengthConfig = useMemo(() => !isNanoBananaEdit ? I2I_STRENGTH_SUPPORT[currentProvider] : undefined, [currentProvider, isNanoBananaEdit])
  const supportsSeed = SEED_SUPPORT.has(currentProvider)
  const supportsRenderingSpeed = !isNanoBananaEdit && RENDERING_SPEED_SUPPORT.has(currentProvider)
  const guidanceScaleConfig = useMemo(() => !isNanoBananaEdit ? GUIDANCE_SCALE_SUPPORT[currentProvider] : undefined, [currentProvider, isNanoBananaEdit])
  const supportsMask = !isNanoBananaEdit && I2I_MASK_SUPPORT.has(currentProvider)

  useEffect(() => {
    const validValues = aspectRatioOptions.map((o) => o.value)
    const updates: Partial<ModifyImageData> = {}
    if (data.aspectRatio && !validValues.includes(data.aspectRatio)) {
      updates.aspectRatio = validValues[0] || "1:1"
    }
    // Resolution / quality fail-safe: snap invalid values to a valid option
    // when the provider exposes the lever, otherwise clear the stale value
    // so the backend route's Zod enum doesn't reject it.
    // Flux 2 uses ascending MP options ("0.5 MP"…"4 MP"), so we snap to
    // the provider default (2 MP Pro/Max, 1 MP Klein) instead of options[0]
    // (0.5 MP) when the current value is absent or invalid.
    const flux2Default = defaultResolutionFor(currentProvider)
    if (resolutionOptions) {
      if (flux2Default) {
        const valid = resolutionOptions.some((o) => o.value === data.resolution)
        if (!valid && data.resolution !== flux2Default) updates.resolution = flux2Default
      } else if (data.resolution && !resolutionOptions.some((o) => o.value === data.resolution)) {
        updates.resolution = resolutionOptions[0]?.value
      }
    } else if (data.resolution !== undefined) {
      updates.resolution = undefined
    }
    if (qualityOptions) {
      if (data.quality && !qualityOptions.some((o) => o.value === data.quality)) {
        updates.quality = qualityOptions[0]?.value
      }
    } else if (data.quality !== undefined) {
      updates.quality = undefined
    }
    // KIE constraints for gpt-image-2-i2i (per docs):
    //   • aspect_ratio = auto → resolution must be 1K
    //   • aspect_ratio = 1:1 → resolution cannot be 4K
    if (currentProvider === "gpt-image-2-i2i") {
      const ar = updates.aspectRatio ?? data.aspectRatio
      const res = updates.resolution ?? data.resolution
      if (ar === "auto" && res !== "1K") {
        updates.resolution = "1K"
      } else if (ar === "1:1" && res === "4K") {
        updates.resolution = "2K"
      }
    }
    if (!supportsRefImage && data.referenceImageUrl) {
      updates.referenceImageUrl = undefined
    }
    if (!supportsMask && data.maskUrl) {
      updates.maskUrl = undefined
    }
    if (Object.keys(updates).length > 0) {
      onUpdate(updates)
    }
  }, [currentProvider, data.aspectRatio]) // eslint-disable-line react-hooks/exhaustive-deps

  const [isCustomStyle, setIsCustomStyle] = useState(
    () => !!data.style && !IMAGE_STYLE_PRESETS.some((p) => p.value === data.style)
  )
  const styleNodeConnected = hasConnectedStyleNode(nodeId, nodes, edges ?? [])
  const [showAssetLibrary, setShowAssetLibrary] = useState(false)
  const [showDefineNewMenu, setShowDefineNewMenu] = useState(false)
  const refImageInputRef = useRef<HTMLInputElement>(null)
  const [uploadingRefImage, setUploadingRefImage] = useState(false)
  const modifyMediaEditor = useMediaEditor({
    onComplete: async (results) => {
      const result = results[0]
      if (!result) return
      const url = result.processedUrl ?? result.uploadResult.url
      onUpdate({ referenceImageUrl: url })
      setUploadingRefImage(false)
    },
    onCancel: () => setUploadingRefImage(false),
  })
  const [showMaskPainter, setShowMaskPainter] = useState(false)
  const allCharDefs = useWorkflowStore((s) => s.characterDefinitions)
  const addCharacterDefinition = useWorkflowStore((s) => s.addCharacterDefinition)
  const addNode = useWorkflowStore((s) => s.addNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const attachedIds = data.characterDefinitionIds ?? []
  const attachedChars = allCharDefs.filter((c) => attachedIds.includes(c.id))

  const sourceImageUrl = useMemo(() => {
    const imgSource = sources.find((s) => IMAGE_SOURCE_TYPES.has(s.type) && s.targetHandle !== "mask")
    if (imgSource?.nodeData) {
      return (imgSource.nodeData.generatedImageUrl as string) || (imgSource.nodeData.url as string)
    }
    return undefined
  }, [sources])

  // Connected reference list for FinalPromptPreview + the `@` typeahead in
  // PromptEditor. Mirrors the runtime path through buildImagePrompt so the
  // preview shows the same fidelity blocks the model will receive.
  const connectedReferences = useMemo<ConnectedReference[]>(() => {
    const wiredSourceTypeMap: Record<string, ReferenceSource> = {
      "upload-image": "wired-image",
      "generate-image": "wired-image",
      "edit-image": "wired-image",
      "image-to-image": "wired-image",
      "modify-image": "wired-image",
      "upscale-image": "wired-image",
      "remove-background": "wired-image",
      "extract-frame": "wired-image",
      "character": "wired-character",
      "face": "wired-face",
      "object": "wired-object",
      "location": "wired-location",
      "scene": "wired-image",
    }
    const charCategorySource: Record<string, ReferenceSource> = {
      face: "wired-face",
      object: "wired-object",
      location: "wired-location",
    }

    const map = new Map<string, ConnectedReference>()

    // Manual ref image (single-slot in modify-image, unlike generate-image's array)
    if (data.referenceImageUrl) {
      const id = "manual-ref"
      map.set(id, {
        id,
        defaultName: "Reference Image",
        source: "manual",
        url: data.referenceImageUrl,
      })
    }

    // Wired upstream nodes. For `character` upstreams, expand into canonical +
    // per-variant entries (expressions / poses / motions / angles / etc.) so the
    // `@kira` / `@kira-smile` typeahead in the prompt editor sees them. Mirrors
    // `execute-node.ts` (runtime path).
    for (const s of sources) {
      if (!(s.type in wiredSourceTypeMap)) continue
      const nd = s.nodeData ?? {}
      if (s.type === "character") {
        const charData = nd as unknown as CharacterNodeData
        const charName = charData.characterName || s.label || "Character"
        const slug = characterMentionSlug(charName)
        if (slug) {
          // Propagate the character node's default usage mode into every
          // derived entry — keeps the modify-image FinalPromptPreview in sync
          // with the runtime path through `buildImagePrompt`.
          const defaultUsageMode = charData.defaultUsageMode
          const canonicalUrl =
            charData.defaultAssetUrl ||
            charData.sourceImageUrl ||
            (nd.generatedImageUrl as string) ||
            (nd.url as string) ||
            ""
          if (canonicalUrl) {
            map.set(s.id, {
              id: s.id,
              defaultName: charName,
              source: "wired-character",
              description: charData.description,
              url: canonicalUrl,
              characterSlug: slug,
              variantSlug: undefined,
              characterCanonicalDescription: charData.canonicalDescription ?? null,
              variantDescription: null,
              variantDisplayName: "canonical",
              defaultUsageMode,
            })
          }
          const assetArrays: Record<string, ReadonlyArray<{ readonly name: string; readonly url: string; readonly description?: string }>> = {
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
              const variantId = `${s.id}_${arrayName}_${variantSlug}`
              map.set(variantId, {
                id: variantId,
                defaultName: `${charName} / ${item.name}`,
                source: "wired-character",
                description: item.description ?? charData.description,
                url: item.url,
                characterSlug: slug,
                variantSlug,
                characterCanonicalDescription: charData.canonicalDescription ?? null,
                variantDescription: item.description ?? null,
                variantDisplayName: item.name,
                defaultUsageMode,
              })
            }
          }
          continue
        }
        // Unnamed character — fall through to generic upstream handling.
      }
      // Location upstream — same expansion as in GenerateImageConfig.
      if (s.type === "location") {
        const expanded = expandLocationSourceForAutocomplete(s.id, nd as Record<string, unknown>, s.label)
        if (expanded) {
          for (const e of expanded) map.set(e.id, e)
          continue
        }
      }
      const url = (nd.generatedImageUrl as string) || (nd.url as string) || (nd.referenceImageUrl as string) || ""
      if (!url) continue
      map.set(s.id, {
        id: s.id,
        defaultName: s.label || s.type,
        source: wiredSourceTypeMap[s.type],
        description: nd.description as string | undefined,
        url,
      })
    }

    // Attached character definitions. When the definition backs a canvas
    // Character node (matched by characterDbId), expand into canonical +
    // per-variant entries.
    for (const c of attachedChars) {
      if (c.type !== "reference" || !c.referenceImageUrl) continue
      const source = charCategorySource[c.category ?? ""] ?? "wired-character"
      const slug = source === "wired-character" ? characterMentionSlug(c.name) : ""
      const matchingCharNode = source === "wired-character" && slug
        ? nodes.find((n) => {
            if (n.type !== "character") return false
            const nd = n.data as CharacterNodeData
            return nd.characterDbId === c.id
          })
        : undefined
      if (matchingCharNode && slug) {
        const charData = matchingCharNode.data as CharacterNodeData
        const defaultUsageMode = charData.defaultUsageMode
        const canonicalUrl = charData.defaultAssetUrl || c.referenceImageUrl || charData.sourceImageUrl
        if (canonicalUrl) {
          map.set(`char_${c.id}`, {
            id: `char_${c.id}`,
            defaultName: c.name,
            source,
            description: c.description ?? charData.description,
            url: canonicalUrl,
            characterSlug: slug,
            variantSlug: undefined,
            characterCanonicalDescription: charData.canonicalDescription ?? null,
            variantDescription: null,
            variantDisplayName: "canonical",
            defaultUsageMode,
          })
        }
        const assetArrays: Record<string, ReadonlyArray<{ readonly name: string; readonly url: string; readonly description?: string }>> = {
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
            const variantId = `char_${c.id}_${arrayName}_${variantSlug}`
            map.set(variantId, {
              id: variantId,
              defaultName: `${c.name} / ${item.name}`,
              source,
              description: item.description ?? c.description ?? charData.description,
              url: item.url,
              characterSlug: slug,
              variantSlug,
              characterCanonicalDescription: charData.canonicalDescription ?? null,
              variantDescription: item.description ?? null,
              variantDisplayName: item.name,
              defaultUsageMode,
            })
          }
        }
        continue
      }
      // No matching canvas node — emit single canonical entry. For character
      // sources, still populate characterSlug so `@<name>` resolves.
      map.set(`char_${c.id}`, {
        id: `char_${c.id}`,
        defaultName: c.name,
        source,
        description: c.description,
        url: c.referenceImageUrl,
        ...(slug
          ? { characterSlug: slug, variantSlug: undefined, variantDisplayName: "canonical" }
          : {}),
      })
    }

    const base = Array.from(map.values())
    // User-attached extras — appended after regular refs so they get the
    // last positional slots, matching the runtime `execute-node.ts` order.
    const ctxLookup = (slug: string) => {
      for (const n of nodes) {
        if (n.type !== "character") continue
        const cd = n.data as CharacterNodeData
        const name = cd.characterName || (cd.label as string) || ""
        if (characterMentionSlug(name) === slug) {
          return {
            defaultUsageMode: cd.defaultUsageMode,
            canonicalDescription: cd.canonicalDescription ?? null,
            displayName: name,
          }
        }
      }
      return undefined
    }
    const extras = expandExtraRefsToConnectedReferences(data.extraRefs, ctxLookup)
    return [...base, ...extras]
  }, [data.referenceImageUrl, data.extraRefs, sources, attachedChars, nodes])

  // Ordered ref-image list for the `@` autocomplete in PromptEditor.
  const refImagesForAutocomplete = useMemo<RefImageItem[]>(() => {
    return connectedReferences.map((ref, i) => ({
      url: ref.url,
      label: ref.defaultName,
      // Map `wired-location` → "location" so the autocomplete renders cyan
      // location pills (slice 3 of Location Studio Phase 2 #2).
      source:
        ref.source === "manual" ? "uploaded"
        : ref.source === "wired-image" ? "wired"
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
  }, [connectedReferences])

  function detachCharacter(id: string) {
    onUpdate({ characterDefinitionIds: attachedIds.filter((cid) => cid !== id) })
  }

  function handleDefineNewAsset(assetType: "character" | "object" | "location") {
    const maxX = nodes.length > 0 ? Math.max(...nodes.map((n) => n.position.x)) + 300 : 200
    const avgY = nodes.length > 0 ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length : 200
    const newNodeId = addNode(assetType, { x: maxX, y: avgY })
    if (newNodeId) {
      selectNode(newNodeId)
    }
    setShowDefineNewMenu(false)
  }

  function handleAssetSelected(asset: SelectedAsset) {
    const charDef: CharacterDefinition = {
      id: asset.id,
      name: asset.name,
      type: asset.thumbnailUrl ? "reference" : "description",
      category: asset.type,
      referenceImageUrl: asset.thumbnailUrl,
      description: asset.description,
    }
    const exists = allCharDefs.some((c) => c.id === asset.id)
    if (!exists) {
      addCharacterDefinition(charDef)
    }
    if (!attachedIds.includes(asset.id)) {
      onUpdate({ characterDefinitionIds: [...attachedIds, asset.id] })
    }
  }

  function handleRefImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingRefImage(true)
    modifyMediaEditor.openEditor([file])
    if (refImageInputRef.current) refImageInputRef.current.value = ""
  }

  return (
    <div className="flex flex-col gap-3">
      <FinalPromptPreview
        userPrompt={data.prompt}
        style={data.style}
        negativePrompt={data.negativePrompt}
        consumerNodeId={nodeId}
        nodes={nodes}
        edges={edges ?? []}
        provider={data.provider}
        connectedReferences={connectedReferences}
        characterDefs={attachedChars}
      />
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="image">
        <ModelSearchSelect
          value={data.provider || "nano-banana"}
          onChange={(v) => onUpdate({ provider: v as ModifyImageData["provider"] })}
          options={MODIFY_IMAGE_MODELS.map((m) => ({
            value: m.value,
            label: m.label,
            desc: "desc" in m ? (m as { desc?: string }).desc : (m as { description?: string }).description ?? "",
          }))}
          ariaLabel="Provider"
        />
      </MappableField>
      <MappableField field="prompt" label={isNanoBananaEdit ? "Edit Instructions" : "Transformation Prompt"} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="image-to-image" currentPrompt={data.prompt || ""} provider={data.provider} aspectRatio={data.aspectRatio} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />}>
        <PromptEditor
          rows={3}
          value={data.prompt}
          onChange={(v) => onUpdate({ prompt: v })}
          placeholder={isNanoBananaEdit ? "Describe how to edit the image..." : "Describe how to transform the input image..."}
          referenceImages={refImagesForAutocomplete}
          nodeRefs={nodeRefs}
          refMap={refMap}
        />
      </MappableField>
      <MappableField field="style" label="Style" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={isCustomStyle ? "__custom__" : (data.style || "__none__")}
          onValueChange={(v) => {
            if (v === "__custom__") {
              setIsCustomStyle(true)
              onUpdate({ style: "" })
            } else if (v === "__none__") {
              setIsCustomStyle(false)
              onUpdate({ style: "" })
            } else {
              setIsCustomStyle(false)
              onUpdate({ style: v })
            }
          }}
          disabled={styleNodeConnected}
        >
          <SelectTrigger aria-label="Style"><SelectValue placeholder="No style" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No style</SelectItem>
            {IMAGE_STYLE_PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
            <SelectItem value="__custom__">Custom...</SelectItem>
          </SelectContent>
        </Select>
        {isCustomStyle && !styleNodeConnected && (
          <Input
            className="mt-1.5"
            value={data.style ?? ""}
            onChange={(e) => onUpdate({ style: e.target.value })}
            placeholder="Describe your style..."
            autoFocus
          />
        )}
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {styleNodeConnected
            ? "Bypassed — using connected Style node"
            : "Appended to prompt as style guidance"}
        </p>
      </MappableField>
      <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <PromptEditor
          rows={2}
          value={data.negativePrompt ?? ""}
          onChange={(v) => onUpdate({ negativePrompt: v })}
          placeholder="Things to avoid..."
          referenceImages={refImagesForAutocomplete}
          nodeRefs={nodeRefs}
          refMap={refMap}
        />
        <p className="text-[10px] text-muted-foreground mt-0.5">Appended to prompt as exclusion guidance</p>
      </MappableField>

      <ExtraRefsSection
        extraRefs={data.extraRefs}
        onChange={(next) => onUpdate({ extraRefs: next })}
        consumerNodeId={nodeId}
        nodes={nodes}
        edges={edges ?? []}
      />

      {/* Unified injected-references list — includes wired upstreams, character
          canonicals, @-mention variants AND canonical fallbacks. Drag-reorder
          writes to data.referenceOrder which the orchestrator + execute-node
          honor via the shared buildImagePrompt parameter. */}
      <InjectedReferenceList
        connectedReferences={connectedReferences}
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
        primaryLabel={isNanoBananaEdit ? "Image to Edit" : "Main Image"}
      />

      {/* Connected upstream images with ordering — kept alongside the unified
          injected list because `connectedMediaOrder` is what the modify-image
          route uses today to assign the "main image" slot. Both can be reordered
          independently; the InjectedReferenceList above shows the unified API
          order including @-mention variants the ConnectedMediaList never saw. */}
      {sources.filter((s) => IMAGE_SOURCE_TYPES.has(s.type)).length > 0 && (
        <ConnectedMediaList
          sources={sources}
          mediaOrder={data.connectedMediaOrder ?? []}
          onUpdateOrder={(order) => onUpdate({ connectedMediaOrder: order })}
          acceptedTypes={IMAGE_SOURCE_TYPES}
          mediaType="image"
          primaryLabel={isNanoBananaEdit ? "Image to Edit" : "Main Image"}
        />
      )}

      {/* Assets section (characters, locations, objects) */}
      <div className="pt-1">
        <Separator className="mb-3" />
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Assets</label>
        <div className="flex flex-col gap-1.5 mt-2">
          {attachedChars.map((char) => (
            <div key={char.id} className="flex items-start gap-2 p-2 rounded-md border bg-muted/30">
              {char.referenceImageUrl ? (
                <CachedImage src={char.referenceImageUrl} alt={char.name} className="w-8 h-8 rounded object-cover flex-shrink-0" thumbnail thumbnailWidth={80} />
              ) : (
                <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
                  <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-medium truncate">{char.name}</span>
                  <span className={`text-[9px] px-1 py-0.5 rounded ${
                    char.category === "location" ? "bg-cyan-500/10 text-cyan-500"
                    : char.category === "object" ? "bg-emerald-500/10 text-emerald-500"
                    : char.referenceImageUrl ? "bg-blue-500/10 text-blue-500"
                    : "bg-orange-500/10 text-orange-500"
                  }`}>
                    {char.category === "location" ? "location" : char.category === "object" ? "object" : char.referenceImageUrl ? "ref" : "desc"}
                  </span>
                </div>
                {char.type === "description" && char.description && (
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">{char.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => detachCharacter(char.id)}
                className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {attachedChars.length === 0 && (
            <p className="text-[10px] text-muted-foreground/60">No assets attached. Add characters, locations, or objects for visual consistency.</p>
          )}
        </div>
        <div className="flex gap-1.5 mt-2">
          <button
            type="button"
            onClick={() => setShowAssetLibrary(true)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border hover:bg-muted transition-colors"
          >
            <Plus className="w-3 h-3" /> Add from Library
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowDefineNewMenu(!showDefineNewMenu)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border hover:bg-muted transition-colors"
            >
              <UserPlus className="w-3 h-3" /> Create new
            </button>
            {showDefineNewMenu && (
              <div className="absolute top-full left-0 mt-1 w-36 rounded-md border bg-popover shadow-md z-30">
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs hover:bg-pink-500/10 transition-colors flex items-center gap-2"
                  onClick={() => handleDefineNewAsset("character")}
                >
                  <UserCircle className="w-4 h-4 text-pink-500" />
                  <span>Character</span>
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs hover:bg-emerald-500/10 transition-colors flex items-center gap-2"
                  onClick={() => handleDefineNewAsset("object")}
                >
                  <Package className="w-4 h-4 text-emerald-500" />
                  <span>Object</span>
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs hover:bg-cyan-500/10 transition-colors flex items-center gap-2"
                  onClick={() => handleDefineNewAsset("location")}
                >
                  <MapPin className="w-4 h-4 text-cyan-500" />
                  <span>Location</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mask Painter (ideogram-edit etc.) */}
      {supportsMask && (
        <div className="pt-1">
          <Separator className="mb-3" />
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Inpainting Mask</label>
          <div className="flex flex-col gap-2 mt-2">
            {data.maskUrl ? (
              <div className="flex items-center gap-2">
                <img src={optimizedImageUrl(data.maskUrl)} alt="Mask" className="w-16 h-16 object-cover rounded border border-[#2D2D2D]" />
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => sourceImageUrl && setShowMaskPainter(true)}
                    disabled={!sourceImageUrl}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <Paintbrush className="w-3 h-3" /> Edit Mask
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdate({ maskUrl: undefined })}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border hover:bg-destructive/10 hover:text-destructive transition-colors"
                  >
                    <X className="w-3 h-3" /> Clear Mask
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => sourceImageUrl && setShowMaskPainter(true)}
                disabled={!sourceImageUrl}
                className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-md border border-dashed hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Paintbrush className="w-3.5 h-3.5" />
                {sourceImageUrl ? "Paint Mask" : "Connect an image first"}
              </button>
            )}
            <p className="text-[10px] text-muted-foreground">White areas in the mask will be edited, black areas preserved</p>
          </div>
          {sourceImageUrl && (
            <Suspense fallback={null}>
              <MaskPainterModal
                isOpen={showMaskPainter}
                onClose={() => setShowMaskPainter(false)}
                imageUrl={sourceImageUrl}
                initialMaskUrl={data.maskUrl}
                onSave={(maskUrl) => onUpdate({ maskUrl })}
              />
            </Suspense>
          )}
        </div>
      )}

      {/* Model-specific settings — hidden for nano-banana-edit except aspect ratio and seed */}
      <div className="pt-1">
        <Separator className="mb-3" />
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Model Settings</label>
        <div className="flex flex-col gap-3 mt-2">
          <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <AspectRatioSelector
              options={aspectRatioOptions}
              value={data.aspectRatio || aspectRatioOptions[0]?.value || "1:1"}
              onValueChange={(v) => onUpdate({ aspectRatio: v })}
            />
          </MappableField>
          {resolutionOptions && (
            <MappableField field="resolution" label="Resolution" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
              <Select
                value={data.resolution || resolutionOptions[0]?.value || "1K"}
                onValueChange={(v) => onUpdate({ resolution: v })}
              >
                <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {resolutionOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MappableField>
          )}
          {qualityOptions && (
            <MappableField field="quality" label="Quality" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
              <Select
                value={data.quality || qualityOptions[0]?.value}
                onValueChange={(v) => onUpdate({ quality: v })}
              >
                <SelectTrigger aria-label="Quality"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {qualityOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MappableField>
          )}
          {strengthConfig && (
            <div>
              <Label className="text-xs">Strength</Label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="range"
                  min={strengthConfig.min}
                  max={strengthConfig.max}
                  step={strengthConfig.step}
                  value={data.strength ?? strengthConfig.default}
                  onChange={(e) => onUpdate({ strength: parseFloat(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground w-8 text-right">
                  {(data.strength ?? strengthConfig.default).toFixed(2)}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">Lower = closer to original, higher = more creative</p>
            </div>
          )}
          {guidanceScaleConfig && (
            <div>
              <Label className="text-xs">Guidance Scale</Label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="range"
                  min={guidanceScaleConfig.min}
                  max={guidanceScaleConfig.max}
                  step={guidanceScaleConfig.step}
                  value={data.guidanceScale ?? guidanceScaleConfig.default}
                  onChange={(e) => onUpdate({ guidanceScale: parseFloat(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground w-8 text-right">
                  {(data.guidanceScale ?? guidanceScaleConfig.default).toFixed(1)}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">Higher = stricter prompt adherence</p>
            </div>
          )}
          {supportsRenderingSpeed && (
            <div>
              <Label className="text-xs">Rendering Speed</Label>
              <Select
                value={data.renderingSpeed || "BALANCED"}
                onValueChange={(v) => onUpdate({ renderingSpeed: v })}
              >
                <SelectTrigger aria-label="Rendering Speed" className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TURBO">Turbo (Faster, lower cost)</SelectItem>
                  <SelectItem value="BALANCED">Balanced (Default)</SelectItem>
                  <SelectItem value="QUALITY">Quality (Best, higher cost)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-0.5">Affects generation speed and credit cost</p>
            </div>
          )}
          {supportsSeed && (
            <div>
              <Label className="text-xs">Seed</Label>
              <Input
                type="number"
                min={0}
                className="mt-1"
                value={data.seed ?? ""}
                onChange={(e) => {
                  const val = e.target.value
                  onUpdate({ seed: val === "" ? undefined : parseInt(val, 10) })
                }}
                placeholder="Random (leave empty)"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">Fixed seed for reproducible results</p>
            </div>
          )}
          {!isNanoBananaEdit && supportsRefImage && (
            <div>
              <Label className="text-xs">Reference Image</Label>
              {data.referenceImageUrl ? (
                <div className="flex items-center gap-2 mt-1">
                  <CachedImage src={data.referenceImageUrl} alt="Reference" className="w-16 h-16 rounded object-cover" thumbnail thumbnailWidth={128} />
                  <Button variant="ghost" size="sm" onClick={() => onUpdate({ referenceImageUrl: undefined })}>
                    <X className="w-3 h-3 mr-1" /> Remove
                  </Button>
                </div>
              ) : (
                <div className="mt-1">
                  <input ref={refImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleRefImageUpload} />
                  <Button variant="outline" size="sm" onClick={() => refImageInputRef.current?.click()} disabled={uploadingRefImage}>
                    {uploadingRefImage ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
                    Upload Reference
                  </Button>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Optional image to guide generation style</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showAssetLibrary && (
        <Suspense fallback={null}>
          <AssetSelectionModal
            isOpen={showAssetLibrary}
            onClose={() => setShowAssetLibrary(false)}
            onSelect={handleAssetSelected}
            title="Select Asset from Library"
            excludeIds={attachedIds}
          />
        </Suspense>
      )}

      <MediaEditorModal editor={modifyMediaEditor} />

      <ConnectedCinematographySources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
    </div>
  )
}

export const ModifyImageConfig = memo(ModifyImageConfigImpl)

export function UpscaleImageConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<UpscaleImageData>) {
  useEffect(() => { prefetchModelCredits(UPSCALE_IMAGE_MODELS.map((m) => m.value)) }, [])
  const isTopaz = data.provider === "topaz-image-upscale"

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="image">
        <Select
          value={data.provider || "recraft-upscale"}
          onValueChange={(v) => onUpdate({ provider: v as UpscaleImageData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {UPSCALE_IMAGE_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.description} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>

      {isTopaz && (
        <>
          <MappableField field="upscaleFactor" label="Upscale Factor" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Select
              value={data.upscaleFactor || "2"}
              onValueChange={(v) => onUpdate({ upscaleFactor: v })}
            >
              <SelectTrigger aria-label="Upscale Factor"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1x (Enhance only)</SelectItem>
                <SelectItem value="2">2x</SelectItem>
                <SelectItem value="4">4x</SelectItem>
              </SelectContent>
            </Select>
          </MappableField>
          <MappableField field="targetResolution" label="Target Resolution" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Select
              value={data.targetResolution || "2K"}
              onValueChange={(v) => onUpdate({ targetResolution: v as "2K" | "4K" | "8K" })}
            >
              <SelectTrigger aria-label="Target Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TOPAZ_IMAGE_RESOLUTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-0.5">Higher resolution costs more credits</p>
          </MappableField>
        </>
      )}

      {!isTopaz && (
        <p className="text-xs text-muted-foreground px-1">
          Upscale and enhance the input image to higher resolution.
        </p>
      )}
      {isTopaz && (
        <p className="text-xs text-muted-foreground px-1">
          AI-powered upscaling via Topaz. Higher factors produce larger images.
        </p>
      )}
    </div>
  )
}

export function RemoveBackgroundConfig({ data }: ConfigProps<RemoveBackgroundData>) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground px-1">
        Automatically removes the background from the input image, leaving a transparent PNG.
      </p>
    </div>
  )
}

export function GenerateMaskConfig({ data, onUpdate }: ConfigProps<GenerateMaskData>) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground px-1">
        Generates a binary segmentation mask from a text prompt (Grounded SAM). Connect an input image and describe the subject to mask.
      </p>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Describe what to mask</label>
        <Textarea
          rows={2}
          placeholder={`e.g. "the blonde woman", "the red car", "the background"`}
          value={data.prompt ?? ""}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Detection threshold</label>
          <span className="text-xs text-muted-foreground">{(data.threshold ?? 0.3).toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0.05}
          max={0.95}
          step={0.05}
          value={data.threshold ?? 0.3}
          onChange={(e) => onUpdate({ threshold: parseFloat(e.target.value) })}
          className="w-full accent-[#ff0073]"
        />
        <p className="text-[10px] text-muted-foreground">Lower = more permissive, higher = stricter matching</p>
      </div>
    </div>
  )
}
