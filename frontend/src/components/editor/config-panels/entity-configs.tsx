"use client"

import { useState, useRef, useMemo, useEffect } from "react"
import { Play, Loader2, Upload, UserCircle, ChevronDown, Check } from "lucide-react"
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
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useMediaEditor, MediaEditorModal } from "@/components/editor/media-editor"
import { CachedImage } from "@/components/ui/cached-image"
import { useCharacters } from "@/hooks/queries/use-assets-queries"
import { useAuth } from "@/hooks/use-auth"
import type { DbCharacter } from "@/lib/api"
import type {
  CharacterNodeData,
  FaceNodeData,
  ObjectNodeData,
  LocationNodeData,
  GeneratedScript,
  GeneratedScriptResult,
} from "@/types/nodes"
import {
  LocationAssetButton,
  LocationAssetGrid,
} from "./entity-shared"
import { IMAGE_GEN_MODELS, IMAGE_GEN_MODEL_IDS } from "./model-options"
import { ModelSelectOption } from "./model-select-option"
import { ModelDescriptionHint } from "./model-description-hint"
import { MappableField } from "./mappable-field"
import { prefetchModelCredits, useModelCredits } from "@/ee/hooks/use-model-credits"
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

      {/* Replace / pick from library. Lets the user re-bind this canvas node
          to a different character without opening the gallery sidebar first. */}
      <ReplaceCharacterPicker
        currentDbId={data.characterDbId || null}
        onPick={(picked) =>
          onUpdate({
            characterDbId: picked.id,
            characterName: picked.name,
            description: picked.description ?? "",
            gender: (picked.gender as CharacterNodeData["gender"]) ?? "other",
            style: (picked.style as CharacterNodeData["style"]) ?? "realistic",
            baseOutfit: picked.baseOutfit ?? "",
            sourceImageUrl: picked.sourceImageUrl ?? "",
            expressions: picked.expressions ?? [],
            poses: picked.poses ?? [],
            lightingVariations: picked.lightingVariations ?? [],
            angles: picked.angles ?? [],
            motions: picked.motions ?? [],
            voice: picked.voice ?? undefined,
            personality: picked.personality ?? undefined,
          })
        }
      />

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

        {/* Identity Injection — when enabled, downstream Generate/Modify Image
            and Image-to-Video nodes receive `injectCharacterContext: true` +
            the character's DB id, so the backend appends the canonical
            description + an identity-preserve suffix to the prompt before
            the model call. Default OFF for backwards-compat. */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="char-inject-identity"
              checked={data.injectIdentityInPrompts === true}
              onChange={(e) => onUpdate({ injectIdentityInPrompts: e.target.checked })}
            />
            <Label htmlFor="char-inject-identity" className="text-xs">
              Inject identity description in downstream prompts
            </Label>
          </div>
          <p className="text-[10px] text-muted-foreground">
            When enabled, downstream image/video nodes wired to this character will use the canonical identity description for better consistency.
          </p>
          {data.injectIdentityInPrompts && !(data.canonicalDescription && data.canonicalDescription.trim().length > 0) && (
            <p className="text-[10px] text-amber-500">
              No canonical description yet — generate a portrait in the studio first.
            </p>
          )}
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

/**
 * Compact "Replace character" button that opens a dropdown listing all active
 * characters in the user's library. Picking one re-binds this node's
 * `characterDbId` + populates every field from the picked row — useful when a
 * user wants to drop a Character node and reuse a library entry without going
 * through the gallery sidebar. Hidden state (assets, voice, personality) is
 * copied wholesale so the studio shows the picked character as soon as it opens.
 */
function ReplaceCharacterPicker({
  currentDbId,
  onPick,
}: {
  currentDbId: string | null
  onPick: (c: DbCharacter) => void
}) {
  const { user } = useAuth()
  const projectId = useWorkflowStore((s) => s.projectId)
  const { data: characters = [], isLoading } = useCharacters(projectId ?? undefined, user?.id)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return characters
    return characters.filter((c) => c.name.toLowerCase().includes(q))
  }, [characters, filter])

  const label = currentDbId ? "Replace from library" : "Pick from library"

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-[11px] bg-muted/30 border border-border rounded-md px-3 py-2 hover:bg-muted/50 transition-colors"
      >
        <UserCircle className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 text-left text-muted-foreground">{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 left-0 right-0 bg-popover border rounded-md shadow-lg max-h-[280px] flex flex-col">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search characters…"
            autoFocus
            className="text-[11px] bg-transparent border-b px-3 py-2 outline-none placeholder:text-muted-foreground"
          />
          <div className="flex-1 overflow-y-auto py-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-4 text-[11px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-[11px] text-muted-foreground text-center">
                {characters.length === 0 ? "No saved characters yet" : "No matches"}
              </div>
            ) : (
              filtered.map((c) => {
                const isCurrent = c.id === currentDbId
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      onPick(c)
                      setOpen(false)
                      setFilter("")
                    }}
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-accent ${isCurrent ? "bg-accent/40" : ""}`}
                  >
                    {c.sourceImageUrl ? (
                      <CachedImage src={c.sourceImageUrl} alt={c.name} className="w-7 h-7 rounded object-cover" thumbnail thumbnailWidth={56} />
                    ) : (
                      <div className="w-7 h-7 rounded bg-muted flex items-center justify-center">
                        <UserCircle className="h-4 w-4 text-muted-foreground/40" />
                      </div>
                    )}
                    <span className="flex-1 text-[11px] truncate">{c.name}</span>
                    {isCurrent && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
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

type ObjectConfigProps = ConfigProps<ObjectNodeData> & { nodeId?: string }

export function ObjectConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeId }: ObjectConfigProps) {
  const setObjectStudioNodeId = useWorkflowStore((s) => s.setObjectStudioNodeId)

  const anglesCount = (data.angles ?? []).length
  const materialsCount = (data.materials ?? []).length
  const variationsCount = (data.variations ?? []).length
  const motionCount = (data.motionClips ?? []).length
  const refsCount = (data.referencePhotos ?? []).length

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">Object</div>
        <div className="text-[13px] font-semibold text-foreground">{data.objectName || "(unnamed object)"}</div>
        <div className="text-[10px] text-muted-foreground">
          {data.style} · {data.category} · {anglesCount} angles · {materialsCount} materials · {variationsCount} variations · {motionCount} motion · {refsCount} refs
        </div>
      </div>

      <button
        type="button"
        onClick={() => nodeId && setObjectStudioNodeId(nodeId)}
        className="w-full text-left bg-[#0e3a2e] border border-[#34D39944] rounded-md px-3.5 py-2.5 flex items-center gap-2 hover:bg-[#114b3b] transition-colors disabled:opacity-50"
        disabled={!nodeId}
        aria-label="Open Object Studio"
      >
        <span className="text-base leading-none">⬡</span>
        <span>
          <span className="block text-[11px] font-semibold text-[#6ee7b7]">Open Object Studio</span>
          <span className="block text-[9px] text-muted-foreground">Edit appearance, assets, motion &amp; reference photos</span>
        </span>
        <span className="ml-auto text-[#34D399]">→</span>
      </button>

      <div className="border-t border-border pt-3 flex flex-col gap-3">
        {/* Style Lock — when enabled, downstream image/video nodes wired to
            this object will use the canonical caption + style lock for better
            visual consistency. Default ON. */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="obj-style-lock"
              checked={data.styleLock ?? true}
              onChange={(e) => onUpdate({ styleLock: e.target.checked })}
            />
            <Label htmlFor="obj-style-lock" className="text-xs">
              Style Lock
            </Label>
          </div>
          <p className="text-[10px] text-muted-foreground">
            When enabled, downstream image/video nodes wired to this object will use the canonical caption for better consistency.
          </p>
        </div>

        {/* Field Mappings — keep the {} input-injection mapping for the
            Object Name, the one referenceable field that survives the move
            to the studio. */}
        <MappableField field="objectName" label="Object Name" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Input
            id="obj-name"
            value={data.objectName}
            onChange={(e) => onUpdate({ objectName: e.target.value })}
            placeholder="e.g. Magic Sword (use {} to inject input)"
          />
        </MappableField>
      </div>
    </div>
  )
}

type LocationConfigProps = ConfigProps<LocationNodeData> & { nodeId?: string }

export function LocationConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeId }: LocationConfigProps) {
  const setLocationStudioNodeId = useWorkflowStore((s) => s.setLocationStudioNodeId)

  const todCount = (data.timeOfDay ?? []).length
  const weatherCount = (data.weather ?? []).length
  const seasonsCount = (data.seasons ?? []).length
  const anglesCount = (data.angles ?? []).length
  const lightingCount = (data.lighting ?? []).length

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">Location</div>
        <div className="text-[13px] font-semibold text-foreground">{data.locationName || "(unnamed location)"}</div>
        <div className="text-[10px] text-muted-foreground">
          {data.style} · {data.category} · {todCount} tod · {weatherCount} weather · {seasonsCount} seasons · {anglesCount} angles · {lightingCount} lighting
        </div>
      </div>

      <button
        type="button"
        onClick={() => nodeId && setLocationStudioNodeId(nodeId)}
        className="w-full text-left bg-[#0e3a4a] border border-[#22D3EE44] rounded-md px-3.5 py-2.5 flex items-center gap-2 hover:bg-[#114b5f] transition-colors disabled:opacity-50"
        disabled={!nodeId}
        aria-label="Open Location Studio"
      >
        <span className="text-base leading-none">⬡</span>
        <span>
          <span className="block text-[11px] font-semibold text-[#67e8f9]">Open Location Studio</span>
          <span className="block text-[9px] text-muted-foreground">Edit appearance, assets &amp; atmosphere</span>
        </span>
        <span className="ml-auto text-[#22D3EE]">→</span>
      </button>

      <div className="border-t border-border pt-3 flex flex-col gap-3">
        {/* Style Lock — when enabled, downstream image/video nodes wired to this
            location will use the canonical caption + style lock for better
            visual consistency. Default ON. */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="loc-style-lock"
              checked={data.styleLock ?? true}
              onChange={(e) => onUpdate({ styleLock: e.target.checked })}
            />
            <Label htmlFor="loc-style-lock" className="text-xs">
              Style Lock
            </Label>
          </div>
          <p className="text-[10px] text-muted-foreground">
            When enabled, downstream image/video nodes wired to this location will use the canonical caption for better consistency.
          </p>
        </div>

        {/* Field Mappings — keep the {} input-injection mapping for the Location Name,
            the one referenceable field that survives the move to the studio. */}
        <MappableField field="locationName" label="Location Name" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Input
            id="loc-name"
            value={data.locationName}
            onChange={(e) => onUpdate({ locationName: e.target.value })}
            placeholder="e.g. Ancient Forest (use {} to inject input)"
          />
        </MappableField>
      </div>
    </div>
  )
}
