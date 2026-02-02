"use client"

import { useState, useCallback } from "react"
import { ChevronDown, Plus, X, Eye, Users, MapPin, Box, Camera, Palette, Volume2, ArrowRightLeft, StickyNote, Download, MessageSquare, Check, RatioIcon } from "lucide-react"
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
import type { SceneNodeDataType, SceneCharacterEntry, SceneObjectEntry, SceneDialogueEntry, SceneLocationEntry } from "@/types/nodes"

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

function QuickAddInput({
  category,
  placeholder,
  onAdd,
}: {
  readonly category: "character" | "location" | "object"
  readonly placeholder: string
  readonly onAdd: (name: string, description: string) => void
}) {
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [expanded, setExpanded] = useState(false)

  function handleAdd() {
    const trimmedName = name.trim()
    if (!trimmedName) return
    onAdd(trimmedName, desc.trim())
    setName("")
    setDesc("")
    setExpanded(false)
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] rounded-md border border-dashed hover:bg-muted transition-colors text-muted-foreground"
      >
        <Plus className="w-3 h-3" /> Quick add {category} by description
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1 p-2 rounded-md border border-dashed bg-muted/10">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={`${category.charAt(0).toUpperCase() + category.slice(1)} name`}
        className="h-6 text-[10px]"
        autoFocus
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd() } if (e.key === "Escape") setExpanded(false) }}
      />
      <Input
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder={placeholder}
        className="h-6 text-[10px]"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd() } if (e.key === "Escape") setExpanded(false) }}
      />
      <div className="flex gap-1 justify-end">
        <button type="button" onClick={() => setExpanded(false)} className="text-[10px] px-2 py-0.5 rounded hover:bg-muted">Cancel</button>
        <button type="button" onClick={handleAdd} disabled={!name.trim()} className="text-[10px] px-2 py-0.5 rounded bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50">Add</button>
      </div>
    </div>
  )
}

export function SceneConfig({ data, onUpdate }: SceneConfigProps) {
  const allAssets = useWorkflowStore((s) => s.characterDefinitions)
  const addCharacterDefinition = useWorkflowStore((s) => s.addCharacterDefinition)
  const [showPromptPreview, setShowPromptPreview] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importTarget, setImportTarget] = useState<"character" | "location" | "object">("character")
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set())

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

  function markRecentlyAdded(id: string) {
    setRecentlyAdded((prev) => new Set([...prev, id]))
    setTimeout(() => setRecentlyAdded((prev) => { const next = new Set(prev); next.delete(id); return next }), 2000)
  }

  function handleImported(ids: string[]) {
    const { characterDefinitions } = useWorkflowStore.getState()
    for (const id of ids) {
      const asset = characterDefinitions.find((a) => a.id === id)
      if (!asset) continue
      const cat = asset.category ?? "character"
      const locs = data.locations ?? []
      if (cat === "character" && !data.characters.some((c) => c.assetId === id)) {
        const entry: SceneCharacterEntry = { assetId: id, mood: "", action: "" }
        onUpdate({ characters: [...data.characters, entry] })
        markRecentlyAdded(id)
      } else if (cat === "location" && !locs.some((l) => l.assetId === id)) {
        const entry: SceneLocationEntry = { assetId: id, isPrimary: locs.length === 0 }
        onUpdate({ locations: [...locs, entry] })
        markRecentlyAdded(id)
      } else if (cat === "object" && !data.objects.some((o) => o.assetId === id)) {
        const entry: SceneObjectEntry = { assetId: id }
        onUpdate({ objects: [...data.objects, entry] })
        markRecentlyAdded(id)
      }
    }
  }

  const handleQuickAdd = useCallback((category: "character" | "location" | "object", name: string, description: string) => {
    const id = crypto.randomUUID()
    addCharacterDefinition({ id, name, type: "description", category, description: description || undefined })
    if (category === "character") {
      const entry: SceneCharacterEntry = { assetId: id, mood: "", action: "" }
      onUpdate({ characters: [...data.characters, entry] })
    } else if (category === "location") {
      const locs = data.locations ?? []
      const entry: SceneLocationEntry = { assetId: id, isPrimary: locs.length === 0 }
      onUpdate({ locations: [...locs, entry] })
    } else {
      const entry: SceneObjectEntry = { assetId: id, description: description || undefined }
      onUpdate({ objects: [...data.objects, entry] })
    }
    markRecentlyAdded(id)
  }, [addCharacterDefinition, data.characters, data.locations, data.objects, onUpdate])

  const usedCharIds = new Set(data.characters.map((c) => c.assetId))
  const availableChars = characterAssets.filter((a) => !usedCharIds.has(a.id))
  const usedLocIds = new Set((data.locations ?? []).map((l) => l.assetId))
  const availableLocs = locationAssets.filter((a) => !usedLocIds.has(a.id))
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
            <div key={`${entry.assetId}-${i}`} className={`flex flex-col gap-1.5 p-2 rounded-md border transition-colors duration-500 ${recentlyAdded.has(entry.assetId) ? "bg-green-500/10 border-green-500/30" : "bg-muted/20"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {recentlyAdded.has(entry.assetId) && <Check className="w-3 h-3 text-green-500" />}
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
        <QuickAddInput
          category="character"
          placeholder="e.g. tall knight with blonde hair and blue cape"
          onAdd={(name, desc) => handleQuickAdd("character", name, desc)}
        />
        <button
          type="button"
          onClick={() => openImportModal("character")}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] rounded-md border border-dashed hover:bg-muted transition-colors"
        >
          <Download className="w-3 h-3" /> Import from other projects
        </button>
      </CollapsibleSection>

      {/* Dialogue */}
      <CollapsibleSection title={`Dialogue (${data.dialogue?.length ?? 0})`} icon={<MessageSquare className="w-3.5 h-3.5" />} defaultOpen={(data.dialogue?.length ?? 0) > 0}>
        {(data.dialogue ?? []).map((entry, i) => (
          <div key={i} className="flex flex-col gap-1.5 p-2 rounded-md border bg-muted/20">
            <div className="flex items-center justify-between gap-1.5">
              <Select
                value={entry.characterId ?? "__narrator__"}
                onValueChange={(v) => {
                  const charAsset = v === "__narrator__" ? undefined : allAssets.find((a) => a.id === v)
                  const newDialogue = (data.dialogue ?? []).map((d, di) =>
                    di === i ? { ...d, characterId: v === "__narrator__" ? undefined : v, characterName: v === "__narrator__" ? "Narrator" : charAsset?.name ?? d.characterName } : d
                  )
                  onUpdate({ dialogue: newDialogue })
                }}
              >
                <SelectTrigger className="h-6 text-[10px] flex-1"><SelectValue placeholder="Speaker" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__narrator__">Narrator</SelectItem>
                  {characterAssets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex items-center gap-1.5">
                        {a.referenceImageUrl && <img src={a.referenceImageUrl} alt={a.name} className="w-4 h-4 rounded object-cover inline" />}
                        {a.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={entry.emotion ?? ""}
                onChange={(e) => {
                  const newDialogue = (data.dialogue ?? []).map((d, di) => di === i ? { ...d, emotion: e.target.value } : d)
                  onUpdate({ dialogue: newDialogue })
                }}
                placeholder="Emotion"
                className="h-6 text-[10px] w-20"
              />
              <button
                type="button"
                onClick={() => onUpdate({ dialogue: (data.dialogue ?? []).filter((_, di) => di !== i) })}
                className="p-0.5 hover:text-destructive"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <Textarea
              value={entry.text}
              onChange={(e) => {
                const newDialogue = (data.dialogue ?? []).map((d, di) => di === i ? { ...d, text: e.target.value } : d)
                onUpdate({ dialogue: newDialogue })
              }}
              placeholder="Dialogue line..."
              rows={2}
              className="text-[10px] resize-none"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            const newEntry: SceneDialogueEntry = { characterName: "Narrator", text: "" }
            onUpdate({ dialogue: [...(data.dialogue ?? []), newEntry] })
          }}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] rounded-md border border-dashed hover:bg-muted transition-colors"
        >
          <Plus className="w-3 h-3" /> Add dialogue line
        </button>
      </CollapsibleSection>

      {/* Locations */}
      <CollapsibleSection title={`Locations (${(data.locations ?? []).length})`} icon={<MapPin className="w-3.5 h-3.5" />} defaultOpen={(data.locations ?? []).length > 0}>
        {(data.locations ?? []).map((loc, i) => {
          const asset = allAssets.find((a) => a.id === loc.assetId)
          return (
            <div key={`${loc.assetId}-${i}`} className={`flex flex-col gap-1.5 p-2 rounded-md border transition-colors duration-500 ${recentlyAdded.has(loc.assetId) ? "bg-green-500/10 border-green-500/30" : "bg-muted/20"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {recentlyAdded.has(loc.assetId) && <Check className="w-3 h-3 text-green-500" />}
                  {asset?.referenceImageUrl && (
                    <img src={asset.referenceImageUrl} alt={asset?.name} className="w-6 h-6 rounded object-cover" />
                  )}
                  <span className="text-xs font-medium">{loc.name ?? asset?.name ?? "Unknown"}</span>
                  {loc.isPrimary && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-cyan-500/10 text-cyan-500">Primary</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {!loc.isPrimary && (
                    <button
                      type="button"
                      onClick={() => {
                        const newLocs = (data.locations ?? []).map((l, li) => ({ ...l, isPrimary: li === i }))
                        onUpdate({ locations: newLocs })
                      }}
                      className="text-[9px] px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
                      title="Set as primary"
                    >
                      Primary
                    </button>
                  )}
                  <button type="button" onClick={() => {
                    const newLocs = (data.locations ?? []).filter((_, li) => li !== i)
                    if (loc.isPrimary && newLocs.length > 0) {
                      newLocs[0] = { ...newLocs[0], isPrimary: true }
                    }
                    onUpdate({ locations: newLocs })
                  }} className="p-0.5 hover:text-destructive">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <div>
                  <Label className="text-[10px]">Time</Label>
                  <Select
                    value={loc.timeOfDay ?? data.timeOfDay}
                    onValueChange={(v) => {
                      const newLocs = (data.locations ?? []).map((l, li) => li === i ? { ...l, timeOfDay: v as SceneLocationEntry["timeOfDay"] } : l)
                      onUpdate({ locations: newLocs })
                    }}
                  >
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
                  <Select
                    value={loc.weather ?? data.weather}
                    onValueChange={(v) => {
                      const newLocs = (data.locations ?? []).map((l, li) => li === i ? { ...l, weather: v as SceneLocationEntry["weather"] } : l)
                      onUpdate({ locations: newLocs })
                    }}
                  >
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
                  <Select
                    value={loc.lighting ?? data.lighting}
                    onValueChange={(v) => {
                      const newLocs = (data.locations ?? []).map((l, li) => li === i ? { ...l, lighting: v as SceneLocationEntry["lighting"] } : l)
                      onUpdate({ locations: newLocs })
                    }}
                  >
                    <SelectTrigger className="h-6 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["natural", "artificial", "dramatic", "soft", "harsh", "backlit"].map((l) => (
                        <SelectItem key={l} value={l}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )
        })}
        {availableLocs.length > 0 && (
          <Select onValueChange={(v) => {
            const locs = data.locations ?? []
            const entry: SceneLocationEntry = { assetId: v, isPrimary: locs.length === 0 }
            onUpdate({ locations: [...locs, entry] })
          }}>
            <SelectTrigger className="h-7 text-[10px]">
              <Plus className="w-3 h-3 mr-1" />
              <SelectValue placeholder="Add location..." />
            </SelectTrigger>
            <SelectContent>
              {availableLocs.map((a) => (
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
        <QuickAddInput
          category="location"
          placeholder="e.g. dark medieval castle courtyard at dusk"
          onAdd={(name, desc) => handleQuickAdd("location", name, desc)}
        />
        <button
          type="button"
          onClick={() => openImportModal("location")}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] rounded-md border border-dashed hover:bg-muted transition-colors"
        >
          <Download className="w-3 h-3" /> Import from other projects
        </button>

        {/* Default environment (when no locations or as fallback) */}
        <div className="mt-1">
          <Label className="text-[10px] text-muted-foreground">Default Environment</Label>
          <div className="grid grid-cols-3 gap-1.5 mt-0.5">
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
        </div>
      </CollapsibleSection>

      {/* Objects */}
      <CollapsibleSection title={`Objects (${data.objects.length})`} icon={<Box className="w-3.5 h-3.5" />}>
        {data.objects.map((entry, i) => {
          const asset = allAssets.find((a) => a.id === entry.assetId)
          return (
            <div key={`${entry.assetId}-${i}`} className={`flex items-center gap-1.5 p-2 rounded-md border transition-colors duration-500 ${recentlyAdded.has(entry.assetId) ? "bg-green-500/10 border-green-500/30" : "bg-muted/20"}`}>
              {recentlyAdded.has(entry.assetId) && <Check className="w-3 h-3 text-green-500" />}
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
        <QuickAddInput
          category="object"
          placeholder="e.g. glowing enchanted sword with runes"
          onAdd={(name, desc) => handleQuickAdd("object", name, desc)}
        />
        <button
          type="button"
          onClick={() => openImportModal("object")}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] rounded-md border border-dashed hover:bg-muted transition-colors"
        >
          <Download className="w-3 h-3" /> Import from other projects
        </button>
      </CollapsibleSection>

      {/* Cinematography */}
      <CollapsibleSection title="Cinematography" icon={<Camera className="w-3.5 h-3.5" />}>
        <div>
          <Label className="text-[10px]">Aspect Ratio</Label>
          <div className="flex gap-1 mt-0.5">
            {(["16:9", "9:16", "1:1", "4:3", "21:9", "4:5"] as const).map((ratio) => (
              <button
                key={ratio}
                type="button"
                onClick={() => onUpdate({ aspectRatio: ratio })}
                className={`flex flex-col items-center gap-0.5 px-1.5 py-1 rounded text-[9px] border transition-colors ${
                  data.aspectRatio === ratio
                    ? "border-violet-500 bg-violet-500/10 text-violet-500"
                    : "border-muted hover:bg-muted/50 text-muted-foreground"
                }`}
              >
                <div
                  className={`border rounded-sm ${data.aspectRatio === ratio ? "border-violet-500" : "border-muted-foreground/40"}`}
                  style={{
                    width: ratio === "9:16" ? 10 : ratio === "1:1" ? 14 : ratio === "4:5" ? 12 : 20,
                    height: ratio === "9:16" ? 18 : ratio === "1:1" ? 14 : ratio === "4:3" ? 15 : ratio === "4:5" ? 15 : ratio === "21:9" ? 9 : 12,
                  }}
                />
                <span>{ratio}</span>
              </button>
            ))}
          </div>
        </div>
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
