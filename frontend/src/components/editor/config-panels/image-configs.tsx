"use client"

import { useState, useRef, useEffect, lazy, Suspense, useMemo } from "react"
import { X, FileText, Plus, UserPlus, Loader2, Upload, UserCircle, Package, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { Separator } from "@/components/ui/separator"
import { CachedImage } from "@/components/ui/cached-image"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { prefetchModelCredits } from "@/hooks/use-model-credits"
import { uploadImage } from "@/lib/api"
import type {
  GenerateImageData,
  EditImageData,
  ImageToImageData,
  CharacterDefinition,
} from "@/types/nodes"
import { IMAGE_GEN_MODELS, IMAGE_I2I_MODELS, getAspectRatiosForModel, IMAGE_RESOLUTION_OPTIONS, IMAGE_QUALITY_OPTIONS, MODELS_WITH_REFERENCE_IMAGE_SUPPORT } from "./model-options"
import { ModelSelectOption } from "./model-select-option"
import { MappableField } from "./mappable-field"
import type { ConfigProps } from "./types"
import type { SelectedAsset } from "../asset-selection-modal"

const AssetSelectionModal = lazy(() => import("../asset-selection-modal").then(m => ({ default: m.AssetSelectionModal })))

export function GenerateImageConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<GenerateImageData>) {
  useEffect(() => { prefetchModelCredits(IMAGE_GEN_MODELS.map((m) => m.value)) }, [])
  const currentProvider = data.provider || "nano-banana-pro"
  const supportsRefImage = MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(currentProvider)
  const aspectRatioOptions = useMemo(() => getAspectRatiosForModel(currentProvider), [currentProvider])
  const resolutionOptions = useMemo(() => IMAGE_RESOLUTION_OPTIONS[currentProvider], [currentProvider])
  const qualityOptions = useMemo(() => IMAGE_QUALITY_OPTIONS[currentProvider], [currentProvider])

  // When provider changes, reset aspect ratio if current value isn't valid for new provider,
  // and clear reference image if new provider doesn't support it
  useEffect(() => {
    const validValues = aspectRatioOptions.map((o) => o.value)
    const updates: Partial<GenerateImageData> = {}
    if (data.aspectRatio && !validValues.includes(data.aspectRatio)) {
      updates.aspectRatio = validValues[0] || "1:1"
    }
    if (!supportsRefImage && data.referenceImageUrl) {
      updates.referenceImageUrl = undefined
    }
    if (Object.keys(updates).length > 0) {
      onUpdate(updates)
    }
  }, [currentProvider]) // eslint-disable-line react-hooks/exhaustive-deps

  const [showAssetLibrary, setShowAssetLibrary] = useState(false)
  const [showDefineNewMenu, setShowDefineNewMenu] = useState(false)
  const refImageInputRef = useRef<HTMLInputElement>(null)
  const [uploadingRefImage, setUploadingRefImage] = useState(false)
  const allCharDefs = useWorkflowStore((s) => s.characterDefinitions)
  const addCharacterDefinition = useWorkflowStore((s) => s.addCharacterDefinition)
  const addNode = useWorkflowStore((s) => s.addNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const nodes = useWorkflowStore((s) => s.nodes)
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

  async function handleRefImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingRefImage(true)
    try {
      const { url } = await uploadImage(file)
      onUpdate({ referenceImageUrl: url })
    } catch {
      // error already thrown by uploadImage
    } finally {
      setUploadingRefImage(false)
      if (refImageInputRef.current) refImageInputRef.current.value = ""
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={3}
          value={data.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder="Describe the image to generate..."
        />
      </MappableField>

      {/* Reference Image — only shown for models that support it */}
      {supportsRefImage && (
        <div>
          <Label className="text-xs">Reference Image</Label>
          <p className="text-[10px] text-muted-foreground mb-1">
            Upload an image to use as visual reference for generation.
          </p>
          {data.referenceImageUrl ? (
            <div className="flex items-center gap-2 p-2 rounded-md border bg-muted/30">
              <CachedImage
                src={data.referenceImageUrl}
                alt="Reference"
                className="w-10 h-10 rounded object-cover flex-shrink-0"
                thumbnail
                thumbnailWidth={80}
              />
              <span className="text-xs text-muted-foreground truncate flex-1">Reference image</span>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 h-6 w-6"
                onClick={() => onUpdate({ referenceImageUrl: undefined })}
                title="Remove reference image"
                aria-label="Remove reference image"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <Input
                value=""
                onChange={(e) => {
                  if (e.target.value.trim()) onUpdate({ referenceImageUrl: e.target.value.trim() })
                }}
                placeholder="https://... or upload"
                className="flex-1"
              />
              <input
                ref={refImageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleRefImageUpload}
              />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 h-9 w-9"
                disabled={uploadingRefImage}
                onClick={() => refImageInputRef.current?.click()}
                title="Upload reference image"
                aria-label="Upload reference image"
              >
                {uploadingRefImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              </Button>
            </div>
          )}
        </div>
      )}

      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="image">
        <Select
          value={data.provider || "nano-banana"}
          onValueChange={(v) => onUpdate({ provider: v as GenerateImageData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {IMAGE_GEN_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.aspectRatio}
          onValueChange={(v) => onUpdate({ aspectRatio: v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {aspectRatioOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      {resolutionOptions && (
        <div>
          <Label className="text-xs">Resolution</Label>
          <Select
            value={data.resolution || "1K"}
            onValueChange={(v) => onUpdate({ resolution: v })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {resolutionOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {qualityOptions && (
        <div>
          <Label className="text-xs">Quality</Label>
          <Select
            value={data.quality || "medium"}
            onValueChange={(v) => onUpdate({ quality: v })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {qualityOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <MappableField field="style" label="Style" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          value={data.style}
          onChange={(e) => onUpdate({ style: e.target.value })}
          placeholder="e.g. children-book, photorealistic"
        />
        <p className="text-[10px] text-muted-foreground mt-0.5">Appended to prompt as style guidance</p>
      </MappableField>
      <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={2}
          value={data.negativePrompt}
          onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
          placeholder="Things to avoid..."
        />
        <p className="text-[10px] text-muted-foreground mt-0.5">Appended to prompt as exclusion guidance</p>
      </MappableField>

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
    </div>
  )
}

export function EditImageConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<EditImageData>) {
  const showPrompt = data.provider === "nano-banana-edit"

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Operation" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.provider || "recraft-upscale"}
          onValueChange={(v) => onUpdate({ provider: v as EditImageData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="recraft-upscale">Upscale / Enhance</SelectItem>
            <SelectItem value="recraft-remove-bg">Remove Background</SelectItem>
            <SelectItem value="nano-banana-edit">Edit with Prompt</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      {showPrompt && (
        <MappableField field="prompt" label="Edit Instructions" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Textarea
            rows={3}
            value={data.prompt}
            onChange={(e) => onUpdate({ prompt: e.target.value })}
            placeholder="Describe how to edit the image..."
          />
        </MappableField>
      )}
      {!showPrompt && (
        <p className="text-xs text-muted-foreground px-1">
          {data.provider === "recraft-upscale"
            ? "Upscale and enhance the input image to higher resolution."
            : "Remove the background from the input image, leaving a transparent PNG."}
        </p>
      )}
    </div>
  )
}

export function ImageToImageConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<ImageToImageData>) {
  useEffect(() => { prefetchModelCredits(IMAGE_I2I_MODELS.map((m) => m.value)) }, [])
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.provider || "nano-banana"}
          onValueChange={(v) => onUpdate({ provider: v as ImageToImageData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {IMAGE_I2I_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="prompt" label="Transformation Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={3}
          value={data.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder="Describe how to transform the input image..."
        />
      </MappableField>
      <p className="text-xs text-muted-foreground px-1">
        Transform the input image based on your prompt while maintaining the core composition.
      </p>
    </div>
  )
}
