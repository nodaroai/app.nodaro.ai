"use client"

import { useState } from "react"
import { ChevronDown, Plus, X, Eye, Users, MapPin, Box, Camera, Palette, Volume2, ArrowRightLeft, StickyNote, Download } from "lucide-react"
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
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { ImportAssetsModal } from "@/components/editor/manage-characters-modal"
import { buildScenePrompt } from "@/lib/prompt-builder"
import type { SceneNodeDataType, SceneCharacterEntry, SceneObjectEntry } from "@/types/nodes"

interface SceneConfigProps {
  readonly data: SceneNodeDataType
  readonly onUpdate: (d: Record<string, unknown>) => void
}

function CollapsibleSection({
  title,
  icon,
  defaultOpen,
  children,
}: {
  readonly title: string
  readonly icon: React.ReactNode
  readonly defaultOpen?: boolean
  readonly children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div className="border rounded-md">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-muted/50 transition-colors"
      >
        {icon}
        <span className="flex-1 text-left">{title}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-3 pb-3 flex flex-col gap-2.5">{children}</div>}
    </div>
  )
}

function TagInput({
  value,
  onChange,
  placeholder,
}: {
  readonly value: readonly string[]
  readonly onChange: (tags: string[]) => void
  readonly placeholder?: string
}) {
  const [input, setInput] = useState("")

  function addTag() {
    const trimmed = input.trim()
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed])
      setInput("")
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1 flex-wrap">
        {value.map((tag) => (
          <span key={tag} className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-muted border">
            {tag}
            <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))} className="hover:text-destructive">
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
      </div>
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag() } }}
        placeholder={placeholder}
        className="h-7 text-xs"
      />
    </div>
  )
}

export function SceneConfig({ data, onUpdate }: SceneConfigProps) {
  const allAssets = useWorkflowStore((s) => s.characterDefinitions)
  const [showPromptPreview, setShowPromptPreview] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importTarget, setImportTarget] = useState<"character" | "location" | "object">("character")

  const characterAssets = allAssets.filter((a) => !a.category || a.category === "character")
  const locationAssets = allAssets.filter((a) => a.category === "location")
  const objectAssets = allAssets.filter((a) => a.category === "object")

  const generatedPrompt = buildScenePrompt(data, allAssets)

  function updateCharacter(index: number, updates: Partial<SceneCharacterEntry>) {
    const newChars = data.characters.map((c, i) => (i === index ? { ...c, ...updates } : c))
    onUpdate({ characters: newChars })
  }

  function removeCharacter(index: number) {
    onUpdate({ characters: data.characters.filter((_, i) => i !== index) })
  }

  function addCharacter(assetId: string) {
    const entry: SceneCharacterEntry = { assetId, mood: "", action: "" }
    onUpdate({ characters: [...data.characters, entry] })
  }

  function updateObject(index: number, updates: Partial<SceneObjectEntry>) {
    const newObjs = data.objects.map((o, i) => (i === index ? { ...o, ...updates } : o))
    onUpdate({ objects: newObjs })
  }

  function removeObject(index: number) {
    onUpdate({ objects: data.objects.filter((_, i) => i !== index) })
  }

  function addObject(assetId: string) {
    const entry: SceneObjectEntry = { assetId }
    onUpdate({ objects: [...data.objects, entry] })
  }

  function openImportModal(target: "character" | "location" | "object") {
    setImportTarget(target)
    setImportModalOpen(true)
  }

  function handleImported(ids: string[]) {
    // After importing, auto-add imported assets to the scene based on their category
    const { characterDefinitions } = useWorkflowStore.getState()
    for (const id of ids) {
      const asset = characterDefinitions.find((a) => a.id === id)
      if (!asset) continue
      const cat = asset.category ?? "character"
      if (cat === "character" && !data.characters.some((c) => c.assetId === id)) {
        const entry: SceneCharacterEntry = { assetId: id, mood: "", action: "" }
        onUpdate({ characters: [...data.characters, entry] })
      } else if (cat === "location" && data.locationAssetId !== id) {
        onUpdate({ locationAssetId: id })
      } else if (cat === "object" && !data.objects.some((o) => o.assetId === id)) {
        const entry: SceneObjectEntry = { assetId: id }
        onUpdate({ objects: [...data.objects, entry] })
      }
    }
  }

  const usedCharIds = new Set(data.characters.map((c) => c.assetId))
  const availableChars = characterAssets.filter((a) => !usedCharIds.has(a.id))
  const usedObjIds = new Set(data.objects.map((o) => o.assetId))
  const availableObjs = objectAssets.filter((a) => !usedObjIds.has(a.id))

  return (
    <div className="flex flex-col gap-3">
      {/* Basic Info - always visible */}
      <div className="flex flex-col gap-2.5">
        <div>
          <Label className="text-xs">Scene Name</Label>
          <Input
            value={data.sceneName}
            onChange={(e) => onUpdate({ sceneName: e.target.value })}
            placeholder="e.g. The Confrontation"
            className="h-8 text-xs mt-1"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs">Scene #</Label>
            <Input
              type="number"
              min={1}
              value={data.sceneNumber}
              onChange={(e) => onUpdate({ sceneNumber: parseInt(e.target.value, 10) || 1 })}
              className="h-8 text-xs mt-1"
            />
          </div>
          <div className="flex-1">
            <Label className="text-xs">Duration (s)</Label>
            <Input
              type="number"
              min={1}
              max={60}
              value={data.duration}
              onChange={(e) => onUpdate({ duration: parseInt(e.target.value, 10) || 5 })}
              className="h-8 text-xs mt-1"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Summary</Label>
          <Textarea
            value={data.summary}
            onChange={(e) => onUpdate({ summary: e.target.value })}
            placeholder="Brief description of what happens in this scene..."
            rows={2}
            className="text-xs mt-1 resize-none"
          />
        </div>
      </div>

      {/* Characters */}
      <CollapsibleSection title={`Characters (${data.characters.length})`} icon={<Users className="w-3.5 h-3.5" />} defaultOpen={data.characters.length > 0}>
        {data.characters.map((entry, i) => {
          const asset = allAssets.find((a) => a.id === entry.assetId)
          return (
            <div key={`${entry.assetId}-${i}`} className="flex flex-col gap-1.5 p-2 rounded-md border bg-muted/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {asset?.referenceImageUrl && (
                    <img src={asset.referenceImageUrl} alt={asset.name} className="w-6 h-6 rounded object-cover" />
                  )}
                  <span className="text-xs font-medium">{asset?.name ?? "Unknown"}</span>
                </div>
                <button type="button" onClick={() => removeCharacter(i)} className="p-0.5 hover:text-destructive">
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="flex gap-1.5">
                <Input
                  value={entry.mood}
                  onChange={(e) => updateCharacter(i, { mood: e.target.value })}
                  placeholder="Mood"
                  className="h-6 text-[10px] flex-1"
                />
                <Input
                  value={entry.action}
                  onChange={(e) => updateCharacter(i, { action: e.target.value })}
                  placeholder="Action"
                  className="h-6 text-[10px] flex-1"
                />
              </div>
              <Select
                value={entry.positionInFrame ?? ""}
                onValueChange={(v) => updateCharacter(i, { positionInFrame: v as SceneCharacterEntry["positionInFrame"] || undefined })}
              >
                <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Position" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="left">Left</SelectItem>
                  <SelectItem value="center">Center</SelectItem>
                  <SelectItem value="right">Right</SelectItem>
                  <SelectItem value="background">Background</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )
        })}
        {availableChars.length > 0 && (
          <Select onValueChange={(v) => addCharacter(v)}>
            <SelectTrigger className="h-7 text-[10px]">
              <Plus className="w-3 h-3 mr-1" />
              <SelectValue placeholder="Add character..." />
            </SelectTrigger>
            <SelectContent>
              {availableChars.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <span className="flex items-center gap-1.5">
                    {a.referenceImageUrl && <img src={a.referenceImageUrl} alt={a.name} className="w-4 h-4 rounded object-cover inline" />}
                    {a.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <button
          type="button"
          onClick={() => openImportModal("character")}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] rounded-md border border-dashed hover:bg-muted transition-colors"
        >
          <Download className="w-3 h-3" /> Import characters from other projects
        </button>
        {availableChars.length === 0 && data.characters.length === 0 && (
          <p className="text-[10px] text-muted-foreground">No character assets defined. Import or extract them from generated images.</p>
        )}
      </CollapsibleSection>

      {/* Location */}
      <CollapsibleSection title="Location" icon={<MapPin className="w-3.5 h-3.5" />} defaultOpen={!!data.locationAssetId}>
        <div>
          <Label className="text-[10px]">Location Asset</Label>
          <Select
            value={data.locationAssetId || ""}
            onValueChange={(v) => onUpdate({ locationAssetId: v === "__none__" ? "" : v })}
          >
            <SelectTrigger className="h-7 text-[10px] mt-0.5"><SelectValue placeholder="Select location..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {locationAssets.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <span className="flex items-center gap-1.5">
                    {a.referenceImageUrl && <img src={a.referenceImageUrl} alt={a.name} className="w-4 h-4 rounded object-cover inline" />}
                    {a.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => openImportModal("location")}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] rounded-md border border-dashed hover:bg-muted transition-colors mt-1.5"
          >
            <Download className="w-3 h-3" /> Import locations from other projects
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <div>
            <Label className="text-[10px]">Time</Label>
            <Select value={data.timeOfDay} onValueChange={(v) => onUpdate({ timeOfDay: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["dawn", "morning", "noon", "afternoon", "sunset", "evening", "night"].map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px]">Weather</Label>
            <Select value={data.weather} onValueChange={(v) => onUpdate({ weather: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["clear", "cloudy", "rainy", "stormy", "foggy", "snowy"].map((w) => (
                  <SelectItem key={w} value={w}>{w}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px]">Lighting</Label>
            <Select value={data.lighting} onValueChange={(v) => onUpdate({ lighting: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["natural", "artificial", "dramatic", "soft", "harsh", "backlit"].map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CollapsibleSection>

      {/* Objects */}
      <CollapsibleSection title={`Objects (${data.objects.length})`} icon={<Box className="w-3.5 h-3.5" />}>
        {data.objects.map((entry, i) => {
          const asset = allAssets.find((a) => a.id === entry.assetId)
          return (
            <div key={`${entry.assetId}-${i}`} className="flex items-center gap-1.5 p-2 rounded-md border bg-muted/20">
              {asset?.referenceImageUrl && (
                <img src={asset.referenceImageUrl} alt={asset.name} className="w-6 h-6 rounded object-cover" />
              )}
              <span className="text-xs font-medium flex-1">{asset?.name ?? "Unknown"}</span>
              <Input
                value={entry.description ?? ""}
                onChange={(e) => updateObject(i, { description: e.target.value })}
                placeholder="Note"
                className="h-6 text-[10px] w-24"
              />
              <button type="button" onClick={() => removeObject(i)} className="p-0.5 hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </div>
          )
        })}
        {availableObjs.length > 0 && (
          <Select onValueChange={(v) => addObject(v)}>
            <SelectTrigger className="h-7 text-[10px]">
              <Plus className="w-3 h-3 mr-1" />
              <SelectValue placeholder="Add object..." />
            </SelectTrigger>
            <SelectContent>
              {availableObjs.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <span className="flex items-center gap-1.5">
                    {a.referenceImageUrl && <img src={a.referenceImageUrl} alt={a.name} className="w-4 h-4 rounded object-cover inline" />}
                    {a.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <button
          type="button"
          onClick={() => openImportModal("object")}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] rounded-md border border-dashed hover:bg-muted transition-colors"
        >
          <Download className="w-3 h-3" /> Import objects from other projects
        </button>
      </CollapsibleSection>

      {/* Cinematography */}
      <CollapsibleSection title="Cinematography" icon={<Camera className="w-3.5 h-3.5" />}>
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <Label className="text-[10px]">Shot Type</Label>
            <Select value={data.shotType} onValueChange={(v) => onUpdate({ shotType: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["extreme-wide", "wide", "medium-wide", "medium", "medium-close", "close-up", "extreme-close-up"].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px]">Camera Angle</Label>
            <Select value={data.cameraAngle} onValueChange={(v) => onUpdate({ cameraAngle: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["eye-level", "low-angle", "high-angle", "birds-eye", "worms-eye", "dutch"].map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px]">Movement</Label>
            <Select value={data.cameraMovement} onValueChange={(v) => onUpdate({ cameraMovement: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["static", "pan", "tilt", "dolly", "tracking", "crane", "handheld", "zoom"].map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px]">Depth of Field</Label>
            <Select value={data.depthOfField} onValueChange={(v) => onUpdate({ depthOfField: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["deep", "medium", "shallow"].map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px]">Lens</Label>
            <Select value={data.lensType} onValueChange={(v) => onUpdate({ lensType: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["wide", "normal", "telephoto"].map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CollapsibleSection>

      {/* Mood & Style */}
      <CollapsibleSection title="Mood & Style" icon={<Palette className="w-3.5 h-3.5" />}>
        <div>
          <Label className="text-[10px]">Visual Style</Label>
          <Select value={data.visualStyle} onValueChange={(v) => onUpdate({ visualStyle: v })}>
            <SelectTrigger className="h-7 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["realistic", "cinematic", "anime", "cartoon", "noir", "vintage", "fantasy", "sci-fi"].map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px]">Mood Tags</Label>
          <TagInput
            value={data.mood}
            onChange={(tags) => onUpdate({ mood: tags })}
            placeholder="Add mood (e.g. tense, dramatic)..."
          />
        </div>
        <div>
          <Label className="text-[10px]">Color Palette</Label>
          <TagInput
            value={data.colorPalette}
            onChange={(tags) => onUpdate({ colorPalette: tags })}
            placeholder="Add color (e.g. gold, crimson)..."
          />
        </div>
      </CollapsibleSection>

      {/* Audio */}
      <CollapsibleSection title="Audio" icon={<Volume2 className="w-3.5 h-3.5" />}>
        <div>
          <Label className="text-[10px]">Narration</Label>
          <Textarea
            value={data.narration}
            onChange={(e) => onUpdate({ narration: e.target.value })}
            placeholder="Narration text for this scene..."
            rows={2}
            className="text-xs mt-0.5 resize-none"
          />
        </div>
        <div>
          <Label className="text-[10px]">Music Mood</Label>
          <Input
            value={data.musicMood}
            onChange={(e) => onUpdate({ musicMood: e.target.value })}
            placeholder="e.g. epic orchestral, tense"
            className="h-7 text-[10px] mt-0.5"
          />
        </div>
        <div>
          <Label className="text-[10px]">Sound Effects</Label>
          <TagInput
            value={data.soundEffects}
            onChange={(tags) => onUpdate({ soundEffects: tags })}
            placeholder="Add SFX (e.g. sword clash, wind)..."
          />
        </div>
      </CollapsibleSection>

      {/* Transitions */}
      <CollapsibleSection title="Transitions" icon={<ArrowRightLeft className="w-3.5 h-3.5" />}>
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <Label className="text-[10px]">Transition In</Label>
            <Select value={data.transitionIn} onValueChange={(v) => onUpdate({ transitionIn: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["cut", "fade", "dissolve", "wipe"].map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px]">Transition Out</Label>
            <Select value={data.transitionOut} onValueChange={(v) => onUpdate({ transitionOut: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["cut", "fade", "dissolve", "wipe"].map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CollapsibleSection>

      {/* Director Notes */}
      <CollapsibleSection title="Director Notes" icon={<StickyNote className="w-3.5 h-3.5" />}>
        <Textarea
          value={data.directorNotes}
          onChange={(e) => onUpdate({ directorNotes: e.target.value })}
          placeholder="Additional direction, references, or notes..."
          rows={3}
          className="text-xs resize-none"
        />
      </CollapsibleSection>

      {/* Prompt Preview */}
      <div className="border rounded-md">
        <button
          type="button"
          onClick={() => setShowPromptPreview(!showPromptPreview)}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium bg-violet-500/10 hover:bg-violet-500/20 transition-colors rounded-md"
        >
          <Eye className="w-3.5 h-3.5" />
          <span className="flex-1 text-left">Preview Generated Prompt</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showPromptPreview ? "rotate-180" : ""}`} />
        </button>
        {showPromptPreview && (
          <div className="px-3 pb-3 pt-2">
            <Textarea
              value={generatedPrompt}
              readOnly
              rows={4}
              className="text-xs resize-none bg-muted/30"
            />
          </div>
        )}
      </div>

      {/* Import Assets Modal */}
      <ImportAssetsModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImported={handleImported}
      />
    </div>
  )
}
