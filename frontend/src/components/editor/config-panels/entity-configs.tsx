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
  CharacterAssetButton,
  CharacterAssetGrid,
  ObjectAssetButton,
  ObjectAssetGrid,
  LocationAssetButton,
  LocationAssetGrid,
} from "./entity-shared"
import { IMAGE_GEN_MODELS, IMAGE_GEN_MODEL_IDS } from "./model-options"
import { ModelSelectOption } from "./model-select-option"
import { MappableField } from "./mappable-field"
import { prefetchModelCredits, useModelCredits } from "@/hooks/use-model-credits"
import type { ConfigProps } from "./types"

export function CharacterConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<CharacterNodeData>) {
  const generateAsset = useWorkflowStore((s) => s.generateCharacterAssetFn)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const nodes = useWorkflowStore((s) => s.nodes)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const charMediaEditor = useMediaEditor({
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

  const hasPortrait = Boolean(
    ((data.generatedResults ?? [])[data.activeResultIndex ?? 0]?.url) || data.sourceImageUrl,
  )
  const isRunning = data.executionStatus === "running"

  const scriptCharSource = sources.find(
    (s) => s.type === "generate-script" && s.sourceHandle === "characters"
  )
  const scriptCharacters = useMemo(() => {
    if (!scriptCharSource?.nodeData) return []
    const sd = scriptCharSource.nodeData as Record<string, unknown>
    const results = sd.generatedResults as GeneratedScriptResult[] | undefined
    const activeIndex = (sd.activeResultIndex as number | undefined) ?? 0
    const script = results?.[activeIndex]?.script ?? (sd.generatedScript as GeneratedScript | undefined)
    if (!script?.scenes) return []
    const seen = new Map<string, { name: string; description: string }>()
    for (const scene of script.scenes) {
      if (!scene.characters) continue
      for (const c of scene.characters) {
        if (typeof c === "string") {
          const key = c.toLowerCase()
          if (!seen.has(key)) seen.set(key, { name: c, description: "" })
        } else {
          const key = c.name.toLowerCase()
          if (!seen.has(key)) seen.set(key, { name: c.name, description: c.description })
        }
      }
    }
    return Array.from(seen.values())
  }, [scriptCharSource])

  const existingNames = useMemo(() => {
    const names: string[] = []
    for (const n of nodes) {
      if (n.type === "character" && n.id !== selectedNodeId) {
        const nd = n.data as CharacterNodeData
        if (nd.characterName) names.push(nd.characterName)
      }
    }
    return names
  }, [nodes, selectedNodeId])

  function handleNameChange(newName: string) {
    if (!newName) {
      onUpdate({ characterName: newName })
      return
    }
    const baseName = newName
    let finalName = baseName
    let version = 2
    const wasVersioned = existingNames.includes(baseName)
    while (existingNames.includes(finalName)) {
      finalName = `${baseName} (${version})`
      version++
    }
    if (wasVersioned) {
      onUpdate({
        characterName: finalName,
        sourceImageUrl: "",
        generatedResults: [],
        activeResultIndex: 0,
        executionStatus: "idle",
      })
    } else {
      onUpdate({ characterName: finalName })
    }
  }

  const duplicateWarning = useMemo(() => {
    if (!data.characterName) return null
    if (data.characterDbId) return null
    const exactMatch = existingNames.includes(data.characterName)
    if (exactMatch) return `A character named "${data.characterName}" already exists. It will be auto-versioned on blur.`
    return null
  }, [data.characterName, data.characterDbId, existingNames])

  function handleUploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    charMediaEditor.openEditor([file])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function handleGenerateAsset(assetType: "expressions" | "poses" | "lighting" | "angles") {
    if (!selectedNodeId || !generateAsset) return
    generateAsset(selectedNodeId, assetType)
  }

  return (
    <div className="flex flex-col gap-3">
      {scriptCharacters.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">From Script</Label>
          <Select
            value={data.scriptCharacterIndex != null ? String(data.scriptCharacterIndex) : ""}
            onValueChange={(v) => {
              const idx = Number(v)
              const char = scriptCharacters[idx]
              if (char) {
                onUpdate({
                  scriptCharacterIndex: idx,
                  characterName: char.name,
                  description: char.description,
                } as any)
              }
            }}
          >
            <SelectTrigger><SelectValue placeholder="Select character..." /></SelectTrigger>
            <SelectContent>
              {scriptCharacters.map((c, i) => (
                <SelectItem key={i} value={String(i)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div>
        <Label htmlFor="char-name">Character Name</Label>
        <Input
          id="char-name"
          value={data.characterName}
          onChange={(e) => onUpdate({ characterName: e.target.value })}
          onBlur={(e) => handleNameChange(e.target.value)}
          placeholder="e.g. Sir Aldric"
        />
        {duplicateWarning && (
          <p className="text-[10px] text-amber-500 mt-0.5">{duplicateWarning}</p>
        )}
      </div>
      <div>
        <Label htmlFor="char-desc">Description</Label>
        <Textarea
          id="char-desc"
          value={data.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          placeholder="A brave knight in his 30s with blonde hair..."
          rows={3}
        />
      </div>
      <div>
        <Label htmlFor="char-gender">Gender</Label>
        <Select value={data.gender} onValueChange={(v) => onUpdate({ gender: v as CharacterNodeData["gender"] })}>
          <SelectTrigger id="char-gender"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="char-style">Style</Label>
        <Select value={data.style} onValueChange={(v) => onUpdate({ style: v as CharacterNodeData["style"] })}>
          <SelectTrigger id="char-style"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="realistic">Realistic</SelectItem>
            <SelectItem value="anime">Anime</SelectItem>
            <SelectItem value="3d-pixar">3D Pixar</SelectItem>
            <SelectItem value="illustration">Illustration</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="char-outfit">Base Outfit</Label>
        <Textarea
          id="char-outfit"
          value={data.baseOutfit}
          onChange={(e) => onUpdate({ baseOutfit: e.target.value })}
          placeholder="Steel plate armor with blue cape..."
          rows={2}
        />
      </div>

      <div>
        <Label htmlFor="char-image">Reference Image</Label>
        <div className="flex gap-1.5">
          <Input
            id="char-image"
            value={data.sourceImageUrl}
            onChange={(e) => onUpdate({ sourceImageUrl: e.target.value })}
            placeholder="https://... or upload"
            className="flex-1"
          />
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleUploadImage} />
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

      <Separator />

      <Button
        size="sm"
        className="w-full text-xs h-8 text-white hover:opacity-90"
        style={{ backgroundColor: '#ff0073' }}
        disabled={isRunning || !data.characterName}
        onClick={() => { if (selectedNodeId && runSingleNode) runSingleNode(selectedNodeId) }}
      >
        {isRunning ? (<><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Generating...</>) : (<><Play className="w-3 h-3 mr-1.5" />Generate Portrait{creditCost > 0 ? ` (${creditCost} CR)` : ""}</>)}
      </Button>

      <Separator />

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">Character Assets</Label>
        {!hasPortrait && (
          <p className="text-[10px] text-muted-foreground">Generate or upload a main portrait first, then generate assets below.</p>
        )}

        <Accordion type="multiple" className="w-full">
          <AccordionItem value="angles">
            <AccordionTrigger className="text-xs py-1.5">Angles ({(data.angles ?? []).length})</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <CharacterAssetButton label="Generate Angles" status={data.anglesStatus ?? "idle"} itemCount={(data.angles ?? []).length} onClick={() => handleGenerateAsset("angles")} disabled={!hasPortrait} />
              <CharacterAssetGrid items={data.angles ?? []} />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="expressions">
            <AccordionTrigger className="text-xs py-1.5">Expressions ({(data.expressions ?? []).length})</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <CharacterAssetButton label="Generate Expressions" status={data.expressionStatus ?? "idle"} itemCount={(data.expressions ?? []).length} onClick={() => handleGenerateAsset("expressions")} disabled={!hasPortrait} />
              <CharacterAssetGrid items={data.expressions ?? []} />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="poses">
            <AccordionTrigger className="text-xs py-1.5">Poses ({(data.poses ?? []).length})</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <CharacterAssetButton label="Generate Poses" status={data.poseStatus ?? "idle"} itemCount={(data.poses ?? []).length} onClick={() => handleGenerateAsset("poses")} disabled={!hasPortrait} />
              <CharacterAssetGrid items={data.poses ?? []} />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="lighting">
            <AccordionTrigger className="text-xs py-1.5">Lighting ({(data.lightingVariations ?? []).length})</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <CharacterAssetButton label="Generate Lighting" status={data.lightingStatus ?? "idle"} itemCount={(data.lightingVariations ?? []).length} onClick={() => handleGenerateAsset("lighting")} disabled={!hasPortrait} />
              <CharacterAssetGrid items={data.lightingVariations ?? []} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs h-8 mt-1"
          disabled={!hasPortrait || data.expressionStatus === "running" || data.poseStatus === "running" || data.lightingStatus === "running" || data.anglesStatus === "running" || !data.characterName}
          onClick={() => {
            handleGenerateAsset("angles")
            setTimeout(() => handleGenerateAsset("expressions"), 500)
            setTimeout(() => handleGenerateAsset("poses"), 1000)
            setTimeout(() => handleGenerateAsset("lighting"), 1500)
          }}
        >
          <Sparkles className="w-3 h-3 mr-1.5" />
          Generate All Assets
        </Button>
      </div>

      <MediaEditorModal editor={charMediaEditor} />
    </div>
  )
}

export function FaceConfig({ data, onUpdate }: { readonly data: FaceNodeData; readonly onUpdate: (updates: Partial<FaceNodeData>) => void }) {
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
      <div>
        <Label htmlFor="face-name">Face Name</Label>
        <Input id="face-name" value={data.faceName} onChange={(e) => onUpdate({ faceName: e.target.value })} onBlur={(e) => handleNameChange(e.target.value)} placeholder="e.g. John Smith" />
        {duplicateWarning && (<p className="text-[10px] text-amber-500 mt-0.5">{duplicateWarning}</p>)}
      </div>
      <div>
        <Label htmlFor="face-desc">Description</Label>
        <Textarea id="face-desc" value={data.description} onChange={(e) => onUpdate({ description: e.target.value })} placeholder="A person in their 30s with brown eyes and short dark hair..." rows={3} />
      </div>
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
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleUploadImage} />
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

export function ObjectConfig({ data, onUpdate }: { readonly data: ObjectNodeData; readonly onUpdate: (updates: Partial<ObjectNodeData>) => void }) {
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

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="obj-name">Object Name</Label>
        <Input id="obj-name" value={data.objectName} onChange={(e) => onUpdate({ objectName: e.target.value })} onBlur={(e) => handleNameChange(e.target.value)} placeholder="e.g. Magic Sword" />
        {duplicateWarning && (<p className="text-[10px] text-amber-500 mt-0.5">{duplicateWarning}</p>)}
      </div>
      <div>
        <Label htmlFor="obj-desc">Description</Label>
        <Textarea id="obj-desc" value={data.description} onChange={(e) => onUpdate({ description: e.target.value })} placeholder="A glowing sword with ancient runes..." rows={3} />
      </div>
      <div>
        <Label htmlFor="obj-category">Category</Label>
        <Select value={data.category} onValueChange={(v) => onUpdate({ category: v as ObjectNodeData["category"] })}>
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
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
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
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleUploadImage} />
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
      <div>
        <Label htmlFor="loc-name">Location Name</Label>
        <Input id="loc-name" value={data.locationName} onChange={(e) => onUpdate({ locationName: e.target.value })} onBlur={(e) => handleNameChange(e.target.value)} placeholder="e.g. Ancient Forest" />
        {duplicateWarning && (<p className="text-[10px] text-amber-500 mt-0.5">{duplicateWarning}</p>)}
      </div>
      <div>
        <Label htmlFor="loc-desc">Description</Label>
        <Textarea id="loc-desc" value={data.description} onChange={(e) => onUpdate({ description: e.target.value })} placeholder="A mystical forest with ancient trees..." rows={3} />
      </div>
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
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleUploadImage} />
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
