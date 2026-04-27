"use client"

import { useState, useRef, useEffect, Suspense, useMemo } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
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
import { prefetchModelCredits } from "@/hooks/use-model-credits"
import { useMediaEditor, MediaEditorModal } from "@/components/editor/media-editor"
import { PromptHelperButton } from "./prompt-helper-button"
import type {
  GenerateImageData,
  EditImageData,
  ImageToImageData,
  ModifyImageData,
  UpscaleImageData,
  RemoveBackgroundData,
  CharacterDefinition,
  ManualReferenceImage,
  ImageProvider,
} from "@/types/nodes"
import { IMAGE_GEN_MODELS, IMAGE_GEN_MODEL_IDS, IMAGE_I2I_MODELS, IMAGE_EDIT_MODELS, MODIFY_IMAGE_MODELS, UPSCALE_IMAGE_MODELS, IMAGE_STYLE_PRESETS, getAspectRatiosForModel, IMAGE_RESOLUTION_OPTIONS, IMAGE_QUALITY_OPTIONS, TOPAZ_IMAGE_RESOLUTIONS, MODELS_WITH_REFERENCE_IMAGE_SUPPORT, REF_IMAGE_MAX_LIMITS, DEFAULT_REF_IMAGE_MAX, I2I_STRENGTH_SUPPORT, I2I_MASK_SUPPORT, SEED_SUPPORT, RENDERING_SPEED_SUPPORT, GUIDANCE_SCALE_SUPPORT } from "./model-options"
import { ModelSelectOption } from "./model-select-option"
import { ModelDescriptionHint } from "./model-description-hint"
import { MultiProviderPicker } from "./multi-provider-picker"
import { intersectModelOptions } from "@/lib/multi-provider/intersect-model-options"
import { MappableField } from "./mappable-field"
import { AspectRatioSelector } from "./aspect-ratio-selector"
import { ReferenceImageList } from "./reference-image-list"
import type { RefImageItem } from "./tag-textarea"
import { PromptEditor } from "./prompt-editor"
import { ReferenceSupportWarning } from "./reference-support-warning"
import type { ConnectedReference, ReferenceSource } from "@nodaro-shared/types"
import { DEFAULT_LABEL_BY_SOURCE } from "@nodaro-shared/types"
import { ConnectedMediaList } from "./connected-media-list"
import { FinalPromptPreview } from "./final-prompt-preview"
import { ConnectedCinematographySources } from "./connected-cinematography-sources"
import { hasConnectedStyleNode } from "@/lib/cinematography-hints"
import type { ConfigProps } from "./types"
import type { SelectedAsset } from "../asset-selection-modal"

const AssetSelectionModal = lazy(() => import("../asset-selection-modal").then(m => ({ default: m.AssetSelectionModal })))
const MaskPainterModal = lazy(() => import("../mask-painter-modal").then(m => ({ default: m.MaskPainterModal })))

const IMAGE_SOURCE_TYPES = new Set(["upload-image", "generate-image", "edit-image", "image-to-image", "modify-image", "upscale-image", "remove-background"])

// REF_IMAGE_MAX_LIMITS / DEFAULT_REF_IMAGE_MAX live in @nodaro-shared/model-constants.

export function GenerateImageConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<GenerateImageData> & { nodeId?: string }) {
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

  // When the cohort changes (provider added/removed/swapped), reset narrowed
  // fields whose current value isn't supported by all providers, and drop ref
  // images if the cohort no longer supports them.
  useEffect(() => {
    const updates: Partial<GenerateImageData> = {}
    const aspectValues = aspectRatioOptions.map((o) => o.value)
    if (data.aspectRatio && !aspectValues.includes(data.aspectRatio)) {
      updates.aspectRatio = aspectValues[0] || "1:1"
    }
    if (data.resolution && resolutionOptions && !resolutionOptions.some((o) => o.value === data.resolution)) {
      updates.resolution = resolutionOptions[0]?.value
    }
    if (data.quality && qualityOptions && !qualityOptions.some((o) => o.value === data.quality)) {
      updates.quality = qualityOptions[0]?.value
    }
    if (!supportsRefImage && data.referenceImageUrl) {
      updates.referenceImageUrl = undefined
    }
    if (!supportsRefImage && data.referenceImageUrls?.length) {
      updates.referenceImageUrls = undefined
      updates.referenceImageOrder = undefined
    }
    if (Object.keys(updates).length > 0) {
      onUpdate(updates)
    }
  }, [providersList]) // eslint-disable-line react-hooks/exhaustive-deps

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

    // Manual uploads
    const manualImgs = data.referenceImageUrls ?? []
    for (let i = 0; i < manualImgs.length; i++) {
      const img = manualImgs[i]
      map.set(img.id, {
        id: img.id,
        defaultName: `Image ${i + 1}`,
        source: "manual",
        url: img.url,
      })
    }

    // Wired upstream nodes (sources from @xyflow incoming edges)
    for (const s of sources) {
      if (!(s.type in wiredSourceTypeMap)) continue
      const nd = s.nodeData ?? {}
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

    // Attached character definitions (from character-definitions store)
    for (const c of attachedChars) {
      if (c.type !== "reference" || !c.referenceImageUrl) continue
      map.set(`char_${c.id}`, {
        id: `char_${c.id}`,
        defaultName: c.name,
        source: charCategorySource[c.category ?? ""] ?? "wired-character",
        description: c.description,
        url: c.referenceImageUrl,
      })
    }

    // Apply ordering
    const orderIds = data.referenceImageOrder ?? []
    const ordered: ConnectedReference[] = []
    const seen = new Set<string>()
    for (const id of orderIds) {
      const entry = map.get(id)
      if (entry) {
        ordered.push(entry)
        seen.add(id)
      }
    }
    for (const [id, entry] of map) {
      if (!seen.has(id)) ordered.push(entry)
    }
    return ordered
  }, [data.referenceImageUrls, data.referenceImageOrder, sources, attachedChars])

  // Ordered reference-image list for the "@" autocomplete trigger. Derived from
  // connectedReferences so the default label per source is preserved.
  const refImagesForAutocomplete = useMemo<RefImageItem[]>(() => {
    return connectedReferences.map((ref, i) => ({
      url: ref.url,
      label: ref.defaultName,
      source:
        ref.source === "manual" ? "uploaded"
        : ref.source === "wired-image" ? "wired"
        : "character",
      index: i + 1,
      defaultLabel: DEFAULT_LABEL_BY_SOURCE[ref.source],
    }))
  }, [connectedReferences])

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
          options={IMAGE_GEN_MODEL_IDS}
          labelOf={(p) => IMAGE_GEN_MODELS.find((m) => m.value === p)?.label ?? p}
          onChange={(next) => onUpdate({ providers: next, provider: next[0] })}
          renderItems={(current) =>
            IMAGE_GEN_MODELS
              .filter((m) => m.value === current || !providersList.includes(m.value))
              .map((m) => (
                <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
              ))
          }
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

export function EditImageConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<EditImageData> & { nodeId?: string }) {
  useEffect(() => { prefetchModelCredits(IMAGE_EDIT_MODELS.map((m) => m.value)) }, [])
  const isNanoBananaEdit = data.provider === "nano-banana-edit"
  const showUpscaleFactor = data.provider === "topaz-image-upscale"
  const aspectRatioOptions = useMemo(() => getAspectRatiosForModel(data.provider || "recraft-upscale"), [data.provider])

  const [isCustomStyle, setIsCustomStyle] = useState(
    () => !!data.style && !IMAGE_STYLE_PRESETS.some((p) => p.value === data.style)
  )
  const styleNodeConnected = hasConnectedStyleNode(nodeId, nodes, edges ?? [])
  const [showAssetLibrary, setShowAssetLibrary] = useState(false)
  const [showDefineNewMenu, setShowDefineNewMenu] = useState(false)
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
        characterDefs={attachedChars}
      />
      <MappableField field="provider" label="Operation" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="image">
        <Select
          value={data.provider || "recraft-upscale"}
          onValueChange={(v) => onUpdate({ provider: v as EditImageData["provider"] })}
        >
          <SelectTrigger aria-label="Operation"><SelectValue /></SelectTrigger>
          <SelectContent>
            {IMAGE_EDIT_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.provider} />
      {isNanoBananaEdit && (
        <>
          <MappableField field="prompt" label="Edit Instructions" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="edit-image" currentPrompt={data.prompt || ""} provider={data.provider} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />}>
            <TagTextarea
              rows={3}
              value={data.prompt}
              onChange={(v) => onUpdate({ prompt: v })}
              placeholder="Describe how to edit the image..."
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
            />
          </MappableField>


          {/* Connected upstream images with ordering */}
          {sources.filter((s) => IMAGE_SOURCE_TYPES.has(s.type)).length > 0 && (
            <ConnectedMediaList
              sources={sources}
              mediaOrder={data.connectedMediaOrder ?? []}
              onUpdateOrder={(order) => onUpdate({ connectedMediaOrder: order })}
              acceptedTypes={IMAGE_SOURCE_TYPES}
              mediaType="image"
              primaryLabel="Image to Edit"
            />
          )}

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
            <TagTextarea
              rows={2}
              value={data.negativePrompt ?? ""}
              onChange={(v) => onUpdate({ negativePrompt: v })}
              placeholder="Things to avoid..."
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">Appended to prompt as exclusion guidance</p>
          </MappableField>

          {/* Assets section (characters, locations, objects) — descriptions enrich the edit prompt */}
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
                <p className="text-[10px] text-muted-foreground/60">No assets attached. Add characters, locations, or objects for context in edit instructions.</p>
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

          {/* Model Settings */}
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
            </div>
          </div>
        </>
      )}
      {showUpscaleFactor && (
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
      {!isNanoBananaEdit && !showUpscaleFactor && (
        <p className="text-xs text-muted-foreground px-1">
          {data.provider === "recraft-upscale" && "Upscale and enhance the input image to higher resolution."}
          {data.provider === "recraft-remove-bg" && "Remove the background from the input image, leaving a transparent PNG."}
          {data.provider === "topaz-image-upscale" && "Topaz AI upscale for maximum detail and sharpness."}
        </p>
      )}
      {showUpscaleFactor && (
        <p className="text-xs text-muted-foreground px-1">
          AI-powered upscaling via Topaz. Higher factors produce larger images.
        </p>
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

      <ConnectedCinematographySources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
    </div>
  )
}

export function ImageToImageConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<ImageToImageData> & { nodeId?: string }) {
  useEffect(() => { prefetchModelCredits(IMAGE_I2I_MODELS.map((m) => m.value)) }, [])
  const currentProvider = data.provider || "nano-banana"
  const supportsRefImage = MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(currentProvider)
  const aspectRatioOptions = useMemo(() => getAspectRatiosForModel(currentProvider), [currentProvider])
  const resolutionOptions = useMemo(() => IMAGE_RESOLUTION_OPTIONS[currentProvider], [currentProvider])
  const qualityOptions = useMemo(() => IMAGE_QUALITY_OPTIONS[currentProvider], [currentProvider])
  const strengthConfig = useMemo(() => I2I_STRENGTH_SUPPORT[currentProvider], [currentProvider])
  const supportsSeed = SEED_SUPPORT.has(currentProvider)
  const supportsRenderingSpeed = RENDERING_SPEED_SUPPORT.has(currentProvider)
  const guidanceScaleConfig = useMemo(() => GUIDANCE_SCALE_SUPPORT[currentProvider], [currentProvider])
  const supportsMask = I2I_MASK_SUPPORT.has(currentProvider)

  // When provider changes, reset aspect ratio if current value isn't valid for new provider,
  // and clear reference image if new provider doesn't support it, and clear mask if unsupported
  useEffect(() => {
    const validValues = aspectRatioOptions.map((o) => o.value)
    const updates: Partial<ImageToImageData> = {}
    if (data.aspectRatio && !validValues.includes(data.aspectRatio)) {
      updates.aspectRatio = validValues[0] || "1:1"
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
  }, [currentProvider]) // eslint-disable-line react-hooks/exhaustive-deps

  const [isCustomStyle, setIsCustomStyle] = useState(
    () => !!data.style && !IMAGE_STYLE_PRESETS.some((p) => p.value === data.style)
  )
  const styleNodeConnected = hasConnectedStyleNode(nodeId, nodes, edges ?? [])
  const [showAssetLibrary, setShowAssetLibrary] = useState(false)
  const [showDefineNewMenu, setShowDefineNewMenu] = useState(false)
  const refImageInputRef = useRef<HTMLInputElement>(null)
  const [uploadingRefImage, setUploadingRefImage] = useState(false)
  const i2iMediaEditor = useMediaEditor({
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

  // Find upstream source image for mask painter
  const sourceImageUrl = useMemo(() => {
    const imgSource = sources.find((s) => IMAGE_SOURCE_TYPES.has(s.type) && s.targetHandle !== "mask")
    if (imgSource?.nodeData) {
      return (imgSource.nodeData.generatedImageUrl as string) || (imgSource.nodeData.url as string)
    }
    return undefined
  }, [sources])

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
    i2iMediaEditor.openEditor([file])
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
        characterDefs={attachedChars}
      />
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="image">
        <Select
          value={data.provider || "nano-banana"}
          onValueChange={(v) => onUpdate({ provider: v as ImageToImageData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {IMAGE_I2I_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.provider} />
      <MappableField field="prompt" label="Transformation Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="image-to-image" currentPrompt={data.prompt || ""} provider={data.provider} aspectRatio={data.aspectRatio} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />}>
        <TagTextarea
          rows={3}
          value={data.prompt}
          onChange={(v) => onUpdate({ prompt: v })}
          placeholder="Describe how to transform the input image..."
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
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
        <TagTextarea
          rows={2}
          value={data.negativePrompt ?? ""}
          onChange={(v) => onUpdate({ negativePrompt: v })}
          placeholder="Things to avoid..."
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
        <p className="text-[10px] text-muted-foreground mt-0.5">Appended to prompt as exclusion guidance</p>
      </MappableField>

      {/* Connected upstream images with ordering */}
      {sources.filter((s) => IMAGE_SOURCE_TYPES.has(s.type)).length > 0 && (
        <ConnectedMediaList
          sources={sources}
          mediaOrder={data.connectedMediaOrder ?? []}
          onUpdateOrder={(order) => onUpdate({ connectedMediaOrder: order })}
          acceptedTypes={IMAGE_SOURCE_TYPES}
          mediaType="image"
          primaryLabel="Main Image"
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

      {/* Mask Painter (ideogram-edit only) */}
      {supportsMask && (
        <div className="pt-1">
          <Separator className="mb-3" />
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Inpainting Mask</label>
          <div className="flex flex-col gap-2 mt-2">
            {data.maskUrl ? (
              <div className="flex items-center gap-2">
                <img src={data.maskUrl} alt="Mask" className="w-16 h-16 object-cover rounded border border-[#2D2D2D]" />
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
                onSave={(maskUrl) => onUpdate({ maskUrl })}
              />
            </Suspense>
          )}
        </div>
      )}

      {/* Model-specific settings */}
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
          {supportsRefImage && (
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

      <MediaEditorModal editor={i2iMediaEditor} />

      <ConnectedCinematographySources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? []} />
    </div>
  )
}

export function ModifyImageConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<ModifyImageData> & { nodeId?: string }) {
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
    if (!supportsRefImage && data.referenceImageUrl) {
      updates.referenceImageUrl = undefined
    }
    if (!supportsMask && data.maskUrl) {
      updates.maskUrl = undefined
    }
    if (Object.keys(updates).length > 0) {
      onUpdate(updates)
    }
  }, [currentProvider]) // eslint-disable-line react-hooks/exhaustive-deps

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
        characterDefs={attachedChars}
      />
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="image">
        <Select
          value={data.provider || "nano-banana"}
          onValueChange={(v) => onUpdate({ provider: v as ModifyImageData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MODIFY_IMAGE_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={"desc" in m ? (m as any).desc : (m as any).description ?? ""} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="prompt" label={isNanoBananaEdit ? "Edit Instructions" : "Transformation Prompt"} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="image-to-image" currentPrompt={data.prompt || ""} provider={data.provider} aspectRatio={data.aspectRatio} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />}>
        <TagTextarea
          rows={3}
          value={data.prompt}
          onChange={(v) => onUpdate({ prompt: v })}
          placeholder={isNanoBananaEdit ? "Describe how to edit the image..." : "Describe how to transform the input image..."}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
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
        <TagTextarea
          rows={2}
          value={data.negativePrompt ?? ""}
          onChange={(v) => onUpdate({ negativePrompt: v })}
          placeholder="Things to avoid..."
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
        <p className="text-[10px] text-muted-foreground mt-0.5">Appended to prompt as exclusion guidance</p>
      </MappableField>

      {/* Connected upstream images with ordering */}
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
                <img src={data.maskUrl} alt="Mask" className="w-16 h-16 object-cover rounded border border-[#2D2D2D]" />
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
