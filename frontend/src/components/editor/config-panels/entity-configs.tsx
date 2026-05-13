"use client"

import { useState, useRef, useMemo, useEffect } from "react"
import { Play, Loader2, Sparkles, Upload } from "lucide-react"
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useMediaEditor, MediaEditorModal } from "@/components/editor/media-editor"
import type {
  CharacterNodeData,
  FaceNodeData,
  ObjectNodeData,
  LocationNodeData,
  GeneratedScript,
  GeneratedScriptResult,
} from "@/types/nodes"
import {
  ObjectAssetButton,
  ObjectAssetGrid,
  LocationAssetButton,
  LocationAssetGrid,
} from "./entity-shared"
import { IMAGE_GEN_MODELS, IMAGE_GEN_MODEL_IDS } from "./model-options"
import { ModelSelectOption } from "./model-select-option"
import { ModelDescriptionHint } from "./model-description-hint"
import { MappableField } from "./mappable-field"
import { prefetchModelCredits, useModelCredits } from "@/ee/hooks/use-model-credits"
import { AnimalPicker } from "./animal-picker"
import { getAnimal } from "@nodaro/shared"
import { VehiclePicker } from "./vehicle-picker"
import { getVehicle } from "@nodaro/shared"
import { FurniturePicker } from "./furniture-picker"
import { getFurniture } from "@nodaro/shared"
import { WeaponPicker } from "./weapon-picker"
import { getWeapon } from "@nodaro/shared"
import type { ConfigProps } from "./types"

type CharacterConfigProps = ConfigProps<CharacterNodeData> & { nodeId?: string }

export function CharacterConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeId }: CharacterConfigProps) {
  const setCharacterStudioNodeId = useWorkflowStore((s) => s.setCharacterStudioNodeId)

  const exprCount = (data.expressions ?? []).length
  const poseCount = (data.poses ?? []).length
  const motionCount = (data.motions ?? []).length

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">Character</div>
        <div className="text-[13px] font-semibold text-foreground">{data.characterName || "Unnamed"}</div>
        <div className="text-[10px] text-muted-foreground">
          {data.style} · {data.gender} · {exprCount} expr · {poseCount} poses · {motionCount} motions
        </div>
      </div>

      <button
        type="button"
        onClick={() => nodeId && setCharacterStudioNodeId(nodeId)}
        className="w-full text-left bg-[#1e3a5f] border border-[#3b82f644] rounded-md px-3.5 py-2.5 flex items-center gap-2 hover:bg-[#234670] transition-colors disabled:opacity-50"
        disabled={!nodeId}
        aria-label="Open Character Studio"
      >
        <span className="text-base leading-none">⬡</span>
        <span>
          <span className="block text-[11px] font-semibold text-[#93c5fd]">Open Character Studio</span>
          <span className="block text-[9px] text-muted-foreground">Edit appearance, assets, voice &amp; personality</span>
        </span>
        <span className="ml-auto text-[#3b82f6]">→</span>
      </button>

      <div className="border-t border-border pt-3 flex flex-col gap-3">
        {/* Identity Lock — kept verbatim from the pre-studio CharacterConfig */}
        <div>
          <Label htmlFor="char-identity-lock">Identity Lock</Label>
          <Select
            value={data.identityLock ?? "soft"}
            onValueChange={(v) => onUpdate({ identityLock: v as NonNullable<CharacterNodeData["identityLock"]> })}
          >
            <SelectTrigger id="char-identity-lock"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off — model may reinterpret the face</SelectItem>
              <SelectItem value="soft">Soft — preserve overall likeness (default)</SelectItem>
              <SelectItem value="strict">Strict — clamp facial identity to the reference</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Applied when this Character feeds downstream image / video generation.
          </p>
        </div>

        {/* Field Mappings — keep the {} input-injection mapping for the Character Name,
            the one referenceable field that survives the move to the studio. */}
        <MappableField field="characterName" label="Character Name" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Input
            id="char-name"
            value={data.characterName}
            onChange={(e) => onUpdate({ characterName: e.target.value })}
            placeholder="e.g. Sir Aldric (use {} to inject input)"
          />
        </MappableField>
      </div>
    </div>
  )
}

export function FaceConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<FaceNodeData>) {
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const faceMediaEditor = useMediaEditor({
    onComplete: async (results) => {
      const result = results[0]
      if (!result) return
      const url = result.processedUrl ?? result.uploadResult.url
      onUpdate({ sourceImageUrl: url })
      setUploading(false)
    },
    onCancel: () => setUploading(false),
  })

  useEffect(() => {
    prefetchModelCredits(IMAGE_GEN_MODEL_IDS)
  }, [])
  const creditCost = useModelCredits(data.provider || "nano-banana")

  const isRunning = data.executionStatus === "running"

  const hasConnectedImage = useMemo(() => {
    if (!selectedNodeId) return false
    const IMAGE_TYPES = new Set(["upload-image", "generate-image", "edit-image", "image-to-image"])
    return edges
      .filter((e) => e.target === selectedNodeId)
      .some((e) => {
        const src = nodes.find((n) => n.id === e.source)
        return src && IMAGE_TYPES.has(src.type ?? "")
      })
  }, [selectedNodeId, edges, nodes])

  const existingNames = useMemo(() => {
    const names: string[] = []
    for (const n of nodes) {
      if (n.type === "face" && n.id !== selectedNodeId) {
        const nd = n.data as FaceNodeData
        if (nd.faceName) names.push(nd.faceName)
      }
    }
    return names
  }, [nodes, selectedNodeId])

  function handleNameChange(newName: string) {
    if (!newName) {
      onUpdate({ faceName: newName })
      return
    }
    let finalName = newName
    let version = 2
    const wasVersioned = existingNames.includes(newName)
    while (existingNames.includes(finalName)) {
      finalName = `${newName} (${version})`
      version++
    }
    if (wasVersioned) {
      onUpdate({ faceName: finalName, generatedResults: [], activeResultIndex: 0, executionStatus: "idle" })
    } else {
      onUpdate({ faceName: finalName })
    }
  }

  const duplicateWarning = useMemo(() => {
    if (!data.faceName) return null
    if (data.faceDbId) return null
    const exactMatch = existingNames.includes(data.faceName)
    if (exactMatch) return `A face named "${data.faceName}" already exists. It will be auto-versioned on blur.`
    return null
  }, [data.faceName, data.faceDbId, existingNames])

  function handleUploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    faceMediaEditor.openEditor([file])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="faceName" label="Face Name" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input id="face-name" value={data.faceName} onChange={(e) => onUpdate({ faceName: e.target.value })} onBlur={(e) => handleNameChange(e.target.value)} placeholder="e.g. John Smith (use {} to inject input)" />
        {duplicateWarning && (<p className="text-[10px] text-amber-500 mt-0.5">{duplicateWarning}</p>)}
      </MappableField>
      <MappableField field="description" label="Description" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea id="face-desc" value={data.description} onChange={(e) => onUpdate({ description: e.target.value })} placeholder="A person in their 30s with brown eyes... (use {} to inject input)" rows={3} />
      </MappableField>
      <div>
        <Label htmlFor="face-style">Style</Label>
        <Select value={data.style} onValueChange={(v) => onUpdate({ style: v as FaceNodeData["style"] })}>
          <SelectTrigger id="face-style"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="realistic">Realistic</SelectItem>
            <SelectItem value="anime">Anime</SelectItem>
            <SelectItem value="3d-pixar">3D Pixar</SelectItem>
            <SelectItem value="illustration">Illustration</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="face-image">Reference Photo</Label>
        <p className="text-[10px] text-muted-foreground mb-1">Upload a clear face photo. This will be used to maintain facial identity in generated images.</p>
        <div className="flex gap-1.5">
          <Input id="face-image" value={data.sourceImageUrl} onChange={(e) => onUpdate({ sourceImageUrl: e.target.value })} placeholder="https://... or upload" className="flex-1" />
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif" className="hidden" onChange={handleUploadImage} />
          <Button variant="outline" size="icon" className="shrink-0 h-9 w-9" disabled={uploading} onClick={() => fileInputRef.current?.click()} title="Upload image from computer" aria-label="Upload image from computer">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      <div>
        <Label className="text-xs">Image Model</Label>
        <Select value={data.provider || "nano-banana"} onValueChange={(v) => onUpdate({ provider: v })}>
          <SelectTrigger className="h-8 text-xs mt-1" aria-label="Image model"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" className="z-[9999] max-h-72">
            {IMAGE_GEN_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </div>
      <ModelDescriptionHint modelId={data.provider} />

      <Separator />

      <Button
        size="sm"
        className="w-full text-xs h-8 text-white hover:opacity-90"
        style={{ backgroundColor: '#ff0073' }}
        disabled={isRunning || !data.faceName || (!data.sourceImageUrl && !hasConnectedImage)}
        onClick={() => { if (selectedNodeId && runSingleNode) runSingleNode(selectedNodeId) }}
      >
        {isRunning ? (<><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Generating...</>) : (<><Play className="w-3 h-3 mr-1.5" />Generate Headshot{creditCost > 0 ? ` (${creditCost} CR)` : ""}</>)}
      </Button>
      {!data.sourceImageUrl && !hasConnectedImage && data.faceName && (
        <p className="text-[10px] text-muted-foreground">Upload a reference photo or connect an Upload Image node to enable headshot generation.</p>
      )}

      <MediaEditorModal editor={faceMediaEditor} />
    </div>
  )
}

export function ObjectConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<ObjectNodeData>) {
  const generateAsset = useWorkflowStore((s) => s.generateObjectAssetFn)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const nodes = useWorkflowStore((s) => s.nodes)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const objMediaEditor = useMediaEditor({
    onComplete: async (results) => {
      const result = results[0]
      if (!result) return
      const url = result.processedUrl ?? result.uploadResult.url
      onUpdate({ sourceImageUrl: url })
      setUploading(false)
    },
    onCancel: () => setUploading(false),
  })

  useEffect(() => {
    prefetchModelCredits(IMAGE_GEN_MODEL_IDS)
  }, [])
  const creditCost = useModelCredits(data.provider || "nano-banana")

  const hasImage = Boolean(((data.generatedResults ?? [])[data.activeResultIndex ?? 0]?.url) || data.sourceImageUrl)
  const isRunning = data.executionStatus === "running"

  const existingNames = useMemo(() => {
    const names: string[] = []
    for (const n of nodes) {
      if (n.type === "object" && n.id !== selectedNodeId) {
        const nd = n.data as ObjectNodeData
        if (nd.objectName) names.push(nd.objectName)
      }
    }
    return names
  }, [nodes, selectedNodeId])

  function handleNameChange(newName: string) {
    if (!newName) { onUpdate({ objectName: newName }); return }
    const baseName = newName
    let finalName = baseName
    let version = 2
    const wasVersioned = existingNames.includes(baseName)
    while (existingNames.includes(finalName)) { finalName = `${baseName} (${version})`; version++ }
    if (wasVersioned) {
      onUpdate({ objectName: finalName, sourceImageUrl: "", generatedResults: [], activeResultIndex: 0, executionStatus: "idle" })
    } else {
      onUpdate({ objectName: finalName })
    }
  }

  const duplicateWarning = useMemo(() => {
    if (!data.objectName) return null
    if (data.objectDbId) return null
    const exactMatch = existingNames.includes(data.objectName)
    if (exactMatch) return `An object named "${data.objectName}" already exists. It will be auto-versioned on blur.`
    return null
  }, [data.objectName, data.objectDbId, existingNames])

  function handleUploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    objMediaEditor.openEditor([file])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function handleGenerateAsset(assetType: "angles" | "materials" | "variations") {
    if (!selectedNodeId || !generateAsset) return
    generateAsset(selectedNodeId, assetType)
  }

  const selectedAnimal = getAnimal(data.animalId)
  const selectedVehicle = getVehicle(data.vehicleId)
  const selectedFurniture = getFurniture(data.furnitureId)
  const selectedWeapon = getWeapon(data.weaponId)

  function handlePickAnimal(animalId: string, animal: { label: string; description: string }) {
    onUpdate({
      animalId,
      objectName: animal.label,
      description: animal.description,
    })
  }

  function handlePickVehicle(vehicleId: string, vehicle: { label: string; description: string }) {
    onUpdate({
      vehicleId,
      objectName: vehicle.label,
      description: vehicle.description,
    })
  }

  function handlePickFurniture(furnitureId: string, furniture: { label: string; description: string }) {
    onUpdate({
      furnitureId,
      objectName: furniture.label,
      description: furniture.description,
    })
  }

  function handlePickWeapon(weaponId: string, weapon: { label: string; description: string }) {
    onUpdate({
      weaponId,
      objectName: weapon.label,
      description: weapon.description,
    })
  }

  function handleCategoryChange(next: ObjectNodeData["category"]) {
    // Clear sibling picker IDs when leaving their category so stale selections
    // don't silently travel with unrelated objects.
    const patch: Partial<ObjectNodeData> = { category: next }
    if (next !== "animal" && data.animalId) patch.animalId = undefined
    if (next !== "vehicle" && data.vehicleId) patch.vehicleId = undefined
    if (next !== "furniture" && data.furnitureId) patch.furnitureId = undefined
    if (next !== "weapon" && data.weaponId) patch.weaponId = undefined
    onUpdate(patch)
  }

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="objectName" label="Object Name" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input id="obj-name" value={data.objectName} onChange={(e) => onUpdate({ objectName: e.target.value })} onBlur={(e) => handleNameChange(e.target.value)} placeholder="e.g. Magic Sword (use {} to inject input)" />
        {duplicateWarning && (<p className="text-[10px] text-amber-500 mt-0.5">{duplicateWarning}</p>)}
      </MappableField>
      <MappableField field="description" label="Description" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea id="obj-desc" value={data.description} onChange={(e) => onUpdate({ description: e.target.value })} placeholder="A glowing sword with ancient runes... (use {} to inject input)" rows={3} />
      </MappableField>
      <div>
        <Label htmlFor="obj-category">Category</Label>
        <Select value={data.category} onValueChange={(v) => handleCategoryChange(v as ObjectNodeData["category"])}>
          <SelectTrigger id="obj-category"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="furniture">Furniture</SelectItem>
            <SelectItem value="vehicle">Vehicle</SelectItem>
            <SelectItem value="weapon">Weapon</SelectItem>
            <SelectItem value="food">Food</SelectItem>
            <SelectItem value="clothing">Clothing</SelectItem>
            <SelectItem value="electronics">Electronics</SelectItem>
            <SelectItem value="nature">Nature</SelectItem>
            <SelectItem value="tool">Tool</SelectItem>
            <SelectItem value="animal">Animal</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {data.category === "animal" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Pick an animal</Label>
            {selectedAnimal && (
              <span className="text-[10px] text-muted-foreground">
                Selected: <span className="text-foreground font-medium">{selectedAnimal.label}</span>
              </span>
            )}
          </div>
          <AnimalPicker value={data.animalId ?? ""} onValueChange={handlePickAnimal} />
          <p className="text-[10px] text-muted-foreground">
            Picking auto-fills the name and description. Edit above to fine-tune.
          </p>
        </div>
      )}

      {data.category === "vehicle" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Pick a vehicle</Label>
            {selectedVehicle && (
              <span className="text-[10px] text-muted-foreground">
                Selected: <span className="text-foreground font-medium">{selectedVehicle.label}</span>
              </span>
            )}
          </div>
          <VehiclePicker value={data.vehicleId ?? ""} onValueChange={handlePickVehicle} />
          <p className="text-[10px] text-muted-foreground">
            Picking auto-fills the name and description. Edit above to fine-tune.
          </p>
        </div>
      )}

      {data.category === "furniture" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Pick a furniture piece</Label>
            {selectedFurniture && (
              <span className="text-[10px] text-muted-foreground">
                Selected: <span className="text-foreground font-medium">{selectedFurniture.label}</span>
              </span>
            )}
          </div>
          <FurniturePicker value={data.furnitureId ?? ""} onValueChange={handlePickFurniture} />
          <p className="text-[10px] text-muted-foreground">
            Picking auto-fills the name and description. Edit above to fine-tune.
          </p>
        </div>
      )}

      {data.category === "weapon" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Pick a weapon</Label>
            {selectedWeapon && (
              <span className="text-[10px] text-muted-foreground">
                Selected: <span className="text-foreground font-medium">{selectedWeapon.label}</span>
              </span>
            )}
          </div>
          <WeaponPicker value={data.weaponId ?? ""} onValueChange={handlePickWeapon} />
          <p className="text-[10px] text-muted-foreground">
            Picking auto-fills the name and description. Edit above to fine-tune.
          </p>
        </div>
      )}
      <div>
        <Label htmlFor="obj-style">Style</Label>
        <Select value={data.style} onValueChange={(v) => onUpdate({ style: v as ObjectNodeData["style"] })}>
          <SelectTrigger id="obj-style"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="realistic">Realistic</SelectItem>
            <SelectItem value="anime">Anime</SelectItem>
            <SelectItem value="3d-pixar">3D Pixar</SelectItem>
            <SelectItem value="illustration">Illustration</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="obj-image">Reference Image</Label>
        <div className="flex gap-1.5">
          <Input id="obj-image" value={data.sourceImageUrl} onChange={(e) => onUpdate({ sourceImageUrl: e.target.value })} placeholder="https://... or upload" className="flex-1" />
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif" className="hidden" onChange={handleUploadImage} />
          <Button variant="outline" size="icon" className="shrink-0 h-9 w-9" disabled={uploading} onClick={() => fileInputRef.current?.click()} title="Upload image from computer" aria-label="Upload image from computer">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      <div>
        <Label className="text-xs">Image Model</Label>
        <Select value={data.provider || "nano-banana"} onValueChange={(v) => onUpdate({ provider: v })}>
          <SelectTrigger className="h-8 text-xs mt-1" aria-label="Image model"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" className="z-[9999] max-h-72">
            {IMAGE_GEN_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </div>
      <ModelDescriptionHint modelId={data.provider} />

      <Separator />

      <Button
        size="sm"
        className="w-full text-xs h-8 text-white hover:opacity-90"
        style={{ backgroundColor: '#ff0073' }}
        disabled={isRunning || !data.objectName}
        onClick={() => { if (selectedNodeId && runSingleNode) runSingleNode(selectedNodeId) }}
      >
        {isRunning ? (<><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Generating...</>) : (<><Play className="w-3 h-3 mr-1.5" />Generate Image{creditCost > 0 ? ` (${creditCost} CR)` : ""}</>)}
      </Button>

      <Separator />

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">Object Assets</Label>
        {!hasImage && (<p className="text-[10px] text-muted-foreground">Generate or upload a main image first, then generate assets below.</p>)}

        <Accordion type="multiple" className="w-full">
          <AccordionItem value="angles">
            <AccordionTrigger className="text-xs py-1.5">Angles ({(data.angles ?? []).length})</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <ObjectAssetButton label="Generate Angles" status={data.anglesStatus ?? "idle"} itemCount={(data.angles ?? []).length} onClick={() => handleGenerateAsset("angles")} disabled={!hasImage} />
              <ObjectAssetGrid items={data.angles ?? []} />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="materials">
            <AccordionTrigger className="text-xs py-1.5">Materials ({(data.materials ?? []).length})</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <ObjectAssetButton label="Generate Materials" status={data.materialsStatus ?? "idle"} itemCount={(data.materials ?? []).length} onClick={() => handleGenerateAsset("materials")} disabled={!hasImage} />
              <ObjectAssetGrid items={data.materials ?? []} />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="variations">
            <AccordionTrigger className="text-xs py-1.5">Variations ({(data.variations ?? []).length})</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <ObjectAssetButton label="Generate Variations" status={data.variationsStatus ?? "idle"} itemCount={(data.variations ?? []).length} onClick={() => handleGenerateAsset("variations")} disabled={!hasImage} />
              <ObjectAssetGrid items={data.variations ?? []} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Button
          variant="outline" size="sm" className="w-full text-xs h-8 mt-1"
          disabled={!hasImage || data.anglesStatus === "running" || data.materialsStatus === "running" || data.variationsStatus === "running" || !data.objectName}
          onClick={() => { handleGenerateAsset("angles"); setTimeout(() => handleGenerateAsset("materials"), 500); setTimeout(() => handleGenerateAsset("variations"), 1000) }}
        >
          <Sparkles className="w-3 h-3 mr-1.5" />
          Generate All Assets
        </Button>
      </div>

      <MediaEditorModal editor={objMediaEditor} />
    </div>
  )
}

export function LocationConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<LocationNodeData>) {
  const generateAsset = useWorkflowStore((s) => s.generateLocationAssetFn)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const nodes = useWorkflowStore((s) => s.nodes)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const locMediaEditor = useMediaEditor({
    onComplete: async (results) => {
      const result = results[0]
      if (!result) return
      const url = result.processedUrl ?? result.uploadResult.url
      onUpdate({ sourceImageUrl: url })
      setUploading(false)
    },
    onCancel: () => setUploading(false),
  })

  useEffect(() => {
    prefetchModelCredits(IMAGE_GEN_MODEL_IDS)
  }, [])
  const creditCost = useModelCredits(data.provider || "nano-banana")

  const hasImage = Boolean(((data.generatedResults ?? [])[data.activeResultIndex ?? 0]?.url) || data.sourceImageUrl)
  const isRunning = data.executionStatus === "running"

  const scriptLocSource = sources.find(
    (s) => s.type === "generate-script" && s.sourceHandle === "locations"
  )
  const scriptLocations = useMemo(() => {
    if (!scriptLocSource?.nodeData) return []
    const sd = scriptLocSource.nodeData as Record<string, unknown>
    const results = sd.generatedResults as GeneratedScriptResult[] | undefined
    const activeIndex = (sd.activeResultIndex as number | undefined) ?? 0
    const script = results?.[activeIndex]?.script ?? (sd.generatedScript as GeneratedScript | undefined)
    if (!script?.scenes) return []
    const seen = new Map<string, { name: string; description: string; timeOfDay: string; weather?: string; lighting?: string }>()
    for (const scene of script.scenes) {
      if (!scene.location) continue
      const key = scene.location.name.toLowerCase()
      if (!seen.has(key)) seen.set(key, {
        name: scene.location.name,
        description: scene.location.description,
        timeOfDay: scene.location.timeOfDay,
        weather: scene.location.weather,
        lighting: scene.location.lighting,
      })
    }
    return Array.from(seen.values())
  }, [scriptLocSource])

  const existingNames = useMemo(() => {
    const names: string[] = []
    for (const n of nodes) {
      if (n.type === "location" && n.id !== selectedNodeId) {
        const nd = n.data as LocationNodeData
        if (nd.locationName) names.push(nd.locationName)
      }
    }
    return names
  }, [nodes, selectedNodeId])

  function handleNameChange(newName: string) {
    if (!newName) { onUpdate({ locationName: newName }); return }
    const baseName = newName
    let finalName = baseName
    let version = 2
    const wasVersioned = existingNames.includes(baseName)
    while (existingNames.includes(finalName)) { finalName = `${baseName} (${version})`; version++ }
    if (wasVersioned) {
      onUpdate({ locationName: finalName, sourceImageUrl: "", generatedResults: [], activeResultIndex: 0, executionStatus: "idle" })
    } else {
      onUpdate({ locationName: finalName })
    }
  }

  const duplicateWarning = useMemo(() => {
    if (!data.locationName) return null
    if (data.locationDbId) return null
    const exactMatch = existingNames.includes(data.locationName)
    if (exactMatch) return `A location named "${data.locationName}" already exists. It will be auto-versioned on blur.`
    return null
  }, [data.locationName, data.locationDbId, existingNames])

  function handleUploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    locMediaEditor.openEditor([file])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function handleGenerateAsset(assetType: "timeOfDay" | "weather" | "angles") {
    if (!selectedNodeId || !generateAsset) return
    generateAsset(selectedNodeId, assetType)
  }

  return (
    <div className="flex flex-col gap-3">
      {scriptLocations.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">From Script</Label>
          <Select
            value={data.scriptLocationIndex != null ? String(data.scriptLocationIndex) : ""}
            onValueChange={(v) => {
              const idx = Number(v)
              const loc = scriptLocations[idx]
              if (loc) {
                onUpdate({
                  scriptLocationIndex: idx,
                  locationName: loc.name,
                  description: [loc.description, loc.timeOfDay, loc.weather, loc.lighting].filter(Boolean).join(". "),
                } as any)
              }
            }}
          >
            <SelectTrigger><SelectValue placeholder="Select location..." /></SelectTrigger>
            <SelectContent>
              {scriptLocations.map((l, i) => (
                <SelectItem key={i} value={String(i)}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <MappableField field="locationName" label="Location Name" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input id="loc-name" value={data.locationName} onChange={(e) => onUpdate({ locationName: e.target.value })} onBlur={(e) => handleNameChange(e.target.value)} placeholder="e.g. Ancient Forest (use {} to inject input)" />
        {duplicateWarning && (<p className="text-[10px] text-amber-500 mt-0.5">{duplicateWarning}</p>)}
      </MappableField>
      <MappableField field="description" label="Description" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea id="loc-desc" value={data.description} onChange={(e) => onUpdate({ description: e.target.value })} placeholder="A mystical forest with ancient trees... (use {} to inject input)" rows={3} />
      </MappableField>
      <div>
        <Label htmlFor="loc-category">Category</Label>
        <Select value={data.category} onValueChange={(v) => onUpdate({ category: v as LocationNodeData["category"] })}>
          <SelectTrigger id="loc-category"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="indoor">Indoor</SelectItem>
            <SelectItem value="outdoor">Outdoor</SelectItem>
            <SelectItem value="urban">Urban</SelectItem>
            <SelectItem value="nature">Nature</SelectItem>
            <SelectItem value="fantasy">Fantasy</SelectItem>
            <SelectItem value="sci-fi">Sci-Fi</SelectItem>
            <SelectItem value="historical">Historical</SelectItem>
            <SelectItem value="futuristic">Futuristic</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="loc-style">Style</Label>
        <Select value={data.style} onValueChange={(v) => onUpdate({ style: v as LocationNodeData["style"] })}>
          <SelectTrigger id="loc-style"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="realistic">Realistic</SelectItem>
            <SelectItem value="anime">Anime</SelectItem>
            <SelectItem value="3d-pixar">3D Pixar</SelectItem>
            <SelectItem value="illustration">Illustration</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="loc-image">Reference Image</Label>
        <div className="flex gap-1.5">
          <Input id="loc-image" value={data.sourceImageUrl} onChange={(e) => onUpdate({ sourceImageUrl: e.target.value })} placeholder="https://... or upload" className="flex-1" />
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif" className="hidden" onChange={handleUploadImage} />
          <Button variant="outline" size="icon" className="shrink-0 h-9 w-9" disabled={uploading} onClick={() => fileInputRef.current?.click()} title="Upload image from computer" aria-label="Upload image from computer">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      <MappableField field="provider" label="Image Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.provider || "nano-banana"} onValueChange={(v) => onUpdate({ provider: v })}>
          <SelectTrigger className="h-8 text-xs" aria-label="Image model"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" className="z-[9999] max-h-72">
            {IMAGE_GEN_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.provider} />

      <Separator />

      <Button
        size="sm"
        className="w-full text-xs h-8 text-white hover:opacity-90"
        style={{ backgroundColor: '#ff0073' }}
        disabled={isRunning || !data.locationName}
        onClick={() => { if (selectedNodeId && runSingleNode) runSingleNode(selectedNodeId) }}
      >
        {isRunning ? (<><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Generating...</>) : (<><Play className="w-3 h-3 mr-1.5" />Generate Image{creditCost > 0 ? ` (${creditCost} CR)` : ""}</>)}
      </Button>

      <Separator />

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">Location Assets</Label>
        {!hasImage && (<p className="text-[10px] text-muted-foreground">Generate or upload a main image first, then generate assets below.</p>)}

        <Accordion type="multiple" className="w-full">
          <AccordionItem value="timeOfDay">
            <AccordionTrigger className="text-xs py-1.5">Time of Day ({(data.timeOfDay ?? []).length})</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <LocationAssetButton label="Generate Time of Day" status={data.timeOfDayStatus ?? "idle"} itemCount={(data.timeOfDay ?? []).length} onClick={() => handleGenerateAsset("timeOfDay")} disabled={!hasImage} />
              <LocationAssetGrid items={data.timeOfDay ?? []} />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="weather">
            <AccordionTrigger className="text-xs py-1.5">Weather ({(data.weather ?? []).length})</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <LocationAssetButton label="Generate Weather" status={data.weatherStatus ?? "idle"} itemCount={(data.weather ?? []).length} onClick={() => handleGenerateAsset("weather")} disabled={!hasImage} />
              <LocationAssetGrid items={data.weather ?? []} />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="angles">
            <AccordionTrigger className="text-xs py-1.5">Angles ({(data.angles ?? []).length})</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <LocationAssetButton label="Generate Angles" status={data.anglesStatus ?? "idle"} itemCount={(data.angles ?? []).length} onClick={() => handleGenerateAsset("angles")} disabled={!hasImage} />
              <LocationAssetGrid items={data.angles ?? []} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Button
          variant="outline" size="sm" className="w-full text-xs h-8 mt-1"
          disabled={!hasImage || data.timeOfDayStatus === "running" || data.weatherStatus === "running" || data.anglesStatus === "running" || !data.locationName}
          onClick={() => { handleGenerateAsset("timeOfDay"); setTimeout(() => handleGenerateAsset("weather"), 500); setTimeout(() => handleGenerateAsset("angles"), 1000) }}
        >
          <Sparkles className="w-3 h-3 mr-1.5" />
          Generate All Assets
        </Button>
      </div>

      <MediaEditorModal editor={locMediaEditor} />
    </div>
  )
}
