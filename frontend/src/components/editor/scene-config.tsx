"use client"

import { useState, useCallback, useEffect } from "react"
import { ChevronDown, Plus, X, Eye, Users, MapPin, Box, Camera, Palette, Volume2, ArrowRightLeft, StickyNote, MessageSquare, Check, RatioIcon, AlertCircle, Loader2, Play, Link2, Download } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { CachedImage } from "@/components/ui/cached-image"
import { buildScenePrompt, PROMPT_MAX_LENGTH } from "@/lib/prompt-builder"
import { TTS_VOICES } from "@/lib/tts-voices"
import { textToSpeech, getJobStatus } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import type { SceneNodeDataType, SceneCharacterEntry, SceneObjectEntry, SceneDialogueEntry, SceneLocationEntry, GenerateScriptData, WorkflowNode, AudioAssignment } from "@/types/nodes"
import { mapScriptSceneToNodeData, getSceneCharacterNames } from "@/types/nodes"

type WizardStep = 1 | 2 | 3 | 4

interface SceneConfigProps {
  readonly data: SceneNodeDataType
  readonly onUpdate: (d: Record<string, unknown>) => void
  readonly step?: WizardStep
  readonly nodeId?: string
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
  autoExpand,
  onAutoExpandHandled,
}: {
  readonly category: "character" | "location" | "object"
  readonly placeholder: string
  readonly onAdd: (name: string, description: string) => void
  readonly autoExpand?: boolean
  readonly onAutoExpandHandled?: () => void
}) {
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (autoExpand && !expanded) {
      setExpanded(true)
      onAutoExpandHandled?.()
    }
  }, [autoExpand, expanded, onAutoExpandHandled])

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

export function SceneConfig({ data, onUpdate, step, nodeId }: SceneConfigProps) {
  const { user } = useAuth()
  const allAssets = useWorkflowStore((s) => s.characterDefinitions)
  const addCharacterDefinition = useWorkflowStore((s) => s.addCharacterDefinition)
  const workflowNodes = useWorkflowStore((s) => s.nodes)
  const workflowEdges = useWorkflowStore((s) => s.edges)
  const [showPromptPreview, setShowPromptPreview] = useState(false)
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set())
  const [recentDialogueIndex, setRecentDialogueIndex] = useState<number | null>(null)
  const [expandQuickAdd, setExpandQuickAdd] = useState<"character" | "location" | "object" | null>(null)
  const [generatingAudio, setGeneratingAudio] = useState<Set<number>>(new Set())
  const [importFeedback, setImportFeedback] = useState<string | null>(null)

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

  async function generateDialogueAudio(dialogueIndex: number) {
    const entry = (data.dialogue ?? [])[dialogueIndex]
    if (!entry?.text.trim()) return

    const voiceId = entry.voiceId ?? "Rachel"
    setGeneratingAudio((prev) => new Set([...prev, dialogueIndex]))
    try {
      const { jobId } = await textToSpeech(entry.text, voiceId, undefined, user?.id)

      const poll = setInterval(async () => {
        try {
          const job = await getJobStatus(jobId)
          if (job.status === "completed") {
            clearInterval(poll)
            const audioUrl = job.output_data?.audioUrl ?? ""
            const newResult = { url: audioUrl, jobId, voiceId, createdAt: new Date().toISOString() }
            const currentDialogue = data.dialogue ?? []
            const currentEntry = currentDialogue[dialogueIndex]
            const existingResults = currentEntry?.generatedAudioResults ?? []
            const updatedResults = [...existingResults, newResult]
            const updated = currentDialogue.map((d, di) =>
              di === dialogueIndex ? { ...d, generatedAudioResults: updatedResults, activeAudioIndex: updatedResults.length - 1 } : d
            )
            onUpdate({ dialogue: updated })
            setGeneratingAudio((prev) => { const next = new Set(prev); next.delete(dialogueIndex); return next })
          } else if (job.status === "failed") {
            clearInterval(poll)
            setGeneratingAudio((prev) => { const next = new Set(prev); next.delete(dialogueIndex); return next })
          }
        } catch {
          clearInterval(poll)
          setGeneratingAudio((prev) => { const next = new Set(prev); next.delete(dialogueIndex); return next })
        }
      }, 2000)
    } catch {
      setGeneratingAudio((prev) => { const next = new Set(prev); next.delete(dialogueIndex); return next })
    }
  }

  function deleteDialogueAudioVersion(dialogueIndex: number, versionIndex: number) {
    const currentDialogue = data.dialogue ?? []
    const entry = currentDialogue[dialogueIndex]
    if (!entry?.generatedAudioResults) return
    const newResults = entry.generatedAudioResults.filter((_, i) => i !== versionIndex)
    const currentActive = entry.activeAudioIndex ?? 0
    let newActive = currentActive
    if (versionIndex === currentActive) {
      newActive = 0
    } else if (versionIndex < currentActive) {
      newActive = currentActive - 1
    }
    const updated = currentDialogue.map((d, di) =>
      di === dialogueIndex ? { ...d, generatedAudioResults: newResults.length > 0 ? newResults : undefined, activeAudioIndex: newResults.length > 0 ? newActive : undefined } : d
    )
    onUpdate({ dialogue: updated })
  }

  function setActiveAudioVersion(dialogueIndex: number, versionIndex: number) {
    const currentDialogue = data.dialogue ?? []
    const updated = currentDialogue.map((d, di) =>
      di === dialogueIndex ? { ...d, activeAudioIndex: versionIndex } : d
    )
    onUpdate({ dialogue: updated })
  }

  function markRecentlyAdded(id: string) {
    setRecentlyAdded((prev) => new Set([...prev, id]))
    setTimeout(() => setRecentlyAdded((prev) => { const next = new Set(prev); next.delete(id); return next }), 2000)
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

  // Script connection
  const scriptNodes = workflowNodes.filter((n) => {
    if (n.type !== "generate-script") return false
    const sd = n.data as GenerateScriptData
    return sd.generatedScript || (sd.generatedResults && sd.generatedResults.length > 0)
  })
  const linkedScript = data.sourceScriptNodeId
    ? scriptNodes.find((n) => n.id === data.sourceScriptNodeId)
    : undefined
  const linkedScriptData = linkedScript?.data as GenerateScriptData | undefined
  const linkedActiveScript = linkedScriptData
    ? (linkedScriptData.generatedResults?.[linkedScriptData.activeResultIndex ?? 0]?.script ?? linkedScriptData.generatedScript)
    : undefined
  const linkedScriptScenes = linkedActiveScript?.scenes ?? []

  function doImportFromScript(sceneIndex?: number) {
    const idx = sceneIndex ?? data.sourceSceneIndex
    if (!linkedActiveScript || idx < 0) return
    const scene = linkedActiveScript.scenes[idx]
    if (!scene) return
    const mapped = mapScriptSceneToNodeData(scene)
    const charNames = getSceneCharacterNames(scene.characters)
    const dialogueCount = scene.dialogue?.length ?? 0
    onUpdate({ ...mapped, sceneNumber: idx + 1 })
    const label = scene.sceneName ? `${idx + 1}. ${scene.sceneName}` : `Scene ${idx + 1}`
    const parts: string[] = [`Imported ${label}`]
    if (charNames.length > 0) parts.push(`${charNames.length} character${charNames.length > 1 ? "s" : ""}`)
    if (dialogueCount > 0) parts.push(`${dialogueCount} dialogue line${dialogueCount > 1 ? "s" : ""}`)
    setImportFeedback(parts.join(" -- "))
    setTimeout(() => setImportFeedback(null), 3000)
  }

  function handleImportFromScript() {
    doImportFromScript()
  }

  function handleSceneIndexChange(newIndex: number) {
    onUpdate({ sourceSceneIndex: newIndex })
    if (data.autoSyncWithScript && newIndex >= 0) {
      // Defer import to next tick so data.sourceSceneIndex is updated
      setTimeout(() => doImportFromScript(newIndex), 0)
    }
  }

  function handleUnlinkScript() {
    onUpdate({ sourceScriptNodeId: "", sourceSceneIndex: -1, autoSyncWithScript: false })
    setImportFeedback(null)
  }

  function handleAutoSyncToggle(checked: boolean) {
    onUpdate({ autoSyncWithScript: checked })
    if (checked && data.sourceSceneIndex >= 0) {
      doImportFromScript()
    }
  }

  const showStep = (s: number) => !step || step === s

  return (
    <div className="flex flex-col gap-3">
      {/* Script Connection - always visible when scripts exist */}
      {scriptNodes.length > 0 && (
          <div className="border rounded-md p-3 bg-muted/30 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Script Connection</span>
              {data.sourceScriptNodeId && (
                <button type="button" onClick={handleUnlinkScript} className="ml-auto text-[10px] text-muted-foreground hover:text-destructive">
                  Unlink
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <Select
                value={data.sourceScriptNodeId || "__none__"}
                onValueChange={(v) => onUpdate({ sourceScriptNodeId: v === "__none__" ? "" : v, sourceSceneIndex: -1 })}
              >
                <SelectTrigger className="h-7 text-[10px] flex-1">
                  <SelectValue placeholder="Select script..." />
                </SelectTrigger>
                <SelectContent position="popper" className="z-[9999]">
                  <SelectItem value="__none__">No script</SelectItem>
                  {scriptNodes.map((n) => {
                    const sd = n.data as GenerateScriptData
                    const activeScript = sd.generatedResults?.[sd.activeResultIndex ?? 0]?.script ?? sd.generatedScript
                    const title = activeScript?.title ?? sd.label ?? n.id
                    return (
                      <SelectItem key={n.id} value={n.id}>{title}</SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              {linkedScriptScenes.length > 0 && (
                <Select
                  value={data.sourceSceneIndex >= 0 ? String(data.sourceSceneIndex) : "__none__"}
                  onValueChange={(v) => handleSceneIndexChange(v === "__none__" ? -1 : Number(v))}
                >
                  <SelectTrigger className="h-7 text-[10px] flex-1">
                    <SelectValue placeholder="Select scene..." />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[9999]">
                    <SelectItem value="__none__">Select scene</SelectItem>
                    {linkedScriptScenes.map((s, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {s.sceneName ? `${i + 1}. ${s.sceneName}` : `Scene ${i + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {/* Scene preview */}
            {data.sourceScriptNodeId && data.sourceSceneIndex >= 0 && linkedScriptScenes[data.sourceSceneIndex] && (
              <div className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1.5 line-clamp-2">
                {linkedScriptScenes[data.sourceSceneIndex].visualDescription || linkedScriptScenes[data.sourceSceneIndex].action || "No description"}
              </div>
            )}
            {data.sourceScriptNodeId && data.sourceSceneIndex >= 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleImportFromScript}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Download className="w-3 h-3" /> Import Now
                </button>
                <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={data.autoSyncWithScript ?? false}
                    onChange={(e) => handleAutoSyncToggle(e.target.checked)}
                    className="w-3 h-3"
                  />
                  Auto-sync
                </label>
              </div>
            )}
            {/* Import feedback */}
            {importFeedback && (
              <div className="flex items-center gap-1.5 text-[10px] text-green-600 dark:text-green-400 bg-green-500/10 rounded px-2 py-1">
                <Check className="w-3 h-3 shrink-0" />
                <span>{importFeedback}</span>
              </div>
            )}
          </div>
        )}
      {/* Step 1: STORY */}
      {showStep(1) && (
      <>
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
      {/* Dialogue (text editing) */}
      <CollapsibleSection title={`Dialogue (${data.dialogue?.length ?? 0})`} icon={<MessageSquare className="w-3.5 h-3.5" />} defaultOpen={(data.dialogue?.length ?? 0) > 0}>
        {(data.dialogue ?? []).map((entry, i) => (
          <div key={i} className={`flex flex-col gap-1.5 p-2 rounded-md border transition-colors duration-500 ${recentDialogueIndex === i ? "bg-green-500/10 border-green-500/30" : "bg-muted/20"}`}>
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
                <SelectContent position="popper" className="z-[9999]">
                  <SelectItem value="__narrator__">Narrator</SelectItem>
                  {characterAssets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex items-center gap-1.5">
                        {a.referenceImageUrl && <CachedImage src={a.referenceImageUrl} alt={a.name} className="w-4 h-4 rounded object-cover inline" thumbnail thumbnailWidth={32} />}
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
            const newDialogue = [...(data.dialogue ?? []), newEntry]
            onUpdate({ dialogue: newDialogue })
            const newIdx = newDialogue.length - 1
            setRecentDialogueIndex(newIdx)
            setTimeout(() => setRecentDialogueIndex(null), 2000)
          }}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] rounded-md border border-dashed hover:bg-muted transition-colors"
        >
          <Plus className="w-3 h-3" /> Add dialogue line
        </button>
      </CollapsibleSection>
      </>
      )}

      {/* Step 2: IMAGE - Characters, Locations, Objects */}
      {showStep(2) && (
      <>
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
                    <CachedImage src={asset.referenceImageUrl} alt={asset.name} className="w-6 h-6 rounded object-cover" thumbnail thumbnailWidth={80} />
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
                value={entry.positionInFrame ?? "__none__"}
                onValueChange={(v) => updateCharacter(i, { positionInFrame: v === "__none__" ? undefined : v as SceneCharacterEntry["positionInFrame"] })}
              >
                <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Position" /></SelectTrigger>
                <SelectContent position="popper" className="z-[9999]">
                  <SelectItem value="__none__">No position</SelectItem>
                  <SelectItem value="left">Left</SelectItem>
                  <SelectItem value="center">Center</SelectItem>
                  <SelectItem value="right">Right</SelectItem>
                  <SelectItem value="foreground">Foreground</SelectItem>
                  <SelectItem value="background">Background</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )
        })}
        <Select onValueChange={(v) => { if (v === "__create_new__") { setExpandQuickAdd("character") } else { addCharacter(v) } }}>
          <SelectTrigger className="h-7 text-[10px]">
            <Plus className="w-3 h-3 mr-1" />
            <SelectValue placeholder="Add character..." />
          </SelectTrigger>
          <SelectContent position="popper" className="z-[9999]">
            {availableChars.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                <span className="flex items-center gap-1.5">
                  {a.referenceImageUrl && <CachedImage src={a.referenceImageUrl} alt={a.name} className="w-4 h-4 rounded object-cover inline" thumbnail thumbnailWidth={32} />}
                  {a.name}
                </span>
              </SelectItem>
            ))}
            {availableChars.length > 0 && <SelectSeparator />}
            <SelectItem value="__create_new__">
              <span className="flex items-center gap-1.5 text-violet-500"><Plus className="w-3 h-3" /> Create new character...</span>
            </SelectItem>
          </SelectContent>
        </Select>
        <QuickAddInput
          category="character"
          placeholder="e.g. tall knight with blonde hair and blue cape"
          onAdd={(name, desc) => handleQuickAdd("character", name, desc)}
          autoExpand={expandQuickAdd === "character"}
          onAutoExpandHandled={() => setExpandQuickAdd(null)}
        />
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
                    <CachedImage src={asset.referenceImageUrl} alt={asset?.name} className="w-6 h-6 rounded object-cover" thumbnail thumbnailWidth={80} />
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
                    <SelectContent position="popper" className="z-[9999]">
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
                    <SelectContent position="popper" className="z-[9999]">
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
                    <SelectContent position="popper" className="z-[9999]">
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
        <Select onValueChange={(v) => {
          if (v === "__create_new__") { setExpandQuickAdd("location"); return }
          const locs = data.locations ?? []
          const entry: SceneLocationEntry = { assetId: v, isPrimary: locs.length === 0 }
          onUpdate({ locations: [...locs, entry] })
        }}>
          <SelectTrigger className="h-7 text-[10px]">
            <Plus className="w-3 h-3 mr-1" />
            <SelectValue placeholder="Add location..." />
          </SelectTrigger>
          <SelectContent position="popper" className="z-[9999]">
            {availableLocs.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                <span className="flex items-center gap-1.5">
                  {a.referenceImageUrl && <CachedImage src={a.referenceImageUrl} alt={a.name} className="w-4 h-4 rounded object-cover inline" thumbnail thumbnailWidth={32} />}
                  {a.name}
                </span>
              </SelectItem>
            ))}
            {availableLocs.length > 0 && <SelectSeparator />}
            <SelectItem value="__create_new__">
              <span className="flex items-center gap-1.5 text-violet-500"><Plus className="w-3 h-3" /> Create new location...</span>
            </SelectItem>
          </SelectContent>
        </Select>
        <QuickAddInput
          category="location"
          placeholder="e.g. dark medieval castle courtyard at dusk"
          onAdd={(name, desc) => handleQuickAdd("location", name, desc)}
          autoExpand={expandQuickAdd === "location"}
          onAutoExpandHandled={() => setExpandQuickAdd(null)}
        />

        {/* Default environment (when no locations or as fallback) */}
        <div className="mt-1">
          <Label className="text-[10px] text-muted-foreground">Default Environment</Label>
          <div className="grid grid-cols-3 gap-1.5 mt-0.5">
            <div>
              <Label className="text-[10px]">Time</Label>
              <Select value={data.timeOfDay} onValueChange={(v) => onUpdate({ timeOfDay: v })}>
                <SelectTrigger className="h-6 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
                <SelectContent position="popper" className="z-[9999]">
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
                <SelectContent position="popper" className="z-[9999]">
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
                <SelectContent position="popper" className="z-[9999]">
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
                <CachedImage src={asset.referenceImageUrl} alt={asset.name} className="w-6 h-6 rounded object-cover" thumbnail thumbnailWidth={80} />
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
        <Select onValueChange={(v) => { if (v === "__create_new__") { setExpandQuickAdd("object") } else { addObject(v) } }}>
          <SelectTrigger className="h-7 text-[10px]">
            <Plus className="w-3 h-3 mr-1" />
            <SelectValue placeholder="Add object..." />
          </SelectTrigger>
          <SelectContent position="popper" className="z-[9999]">
            {availableObjs.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                <span className="flex items-center gap-1.5">
                  {a.referenceImageUrl && <CachedImage src={a.referenceImageUrl} alt={a.name} className="w-4 h-4 rounded object-cover inline" thumbnail thumbnailWidth={32} />}
                  {a.name}
                </span>
              </SelectItem>
            ))}
            {availableObjs.length > 0 && <SelectSeparator />}
            <SelectItem value="__create_new__">
              <span className="flex items-center gap-1.5 text-violet-500"><Plus className="w-3 h-3" /> Create new object...</span>
            </SelectItem>
          </SelectContent>
        </Select>
        <QuickAddInput
          category="object"
          placeholder="e.g. glowing enchanted sword with runes"
          onAdd={(name, desc) => handleQuickAdd("object", name, desc)}
          autoExpand={expandQuickAdd === "object"}
          onAutoExpandHandled={() => setExpandQuickAdd(null)}
        />
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
              <SelectContent position="popper" className="z-[9999]">
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
              <SelectContent position="popper" className="z-[9999]">
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
              <SelectContent position="popper" className="z-[9999]">
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
              <SelectContent position="popper" className="z-[9999]">
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
              <SelectContent position="popper" className="z-[9999]">
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
            <SelectContent position="popper" className="z-[9999]">
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
      </>
      )}

      {/* Step 3: AUDIO - Voice & Generation */}
      {showStep(3) && (
      <>
      {/* Dialogue voice selection + audio generation */}
      {(data.dialogue ?? []).length > 0 && (
      <CollapsibleSection title={`Voice & Audio (${data.dialogue?.length ?? 0} lines)`} icon={<MessageSquare className="w-3.5 h-3.5" />} defaultOpen>
        {(data.dialogue ?? []).map((entry, i) => (
          <div key={i} className="flex flex-col gap-1.5 p-2 rounded-md border bg-muted/20">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground">{entry.characterName}</span>
              {entry.emotion && <span>({entry.emotion})</span>}
              {(data.audioAssignments ?? []).some((a) => a.dialogueIndex === i) && (
                <span className="px-1 py-0.5 rounded bg-violet-500/20 text-violet-500 text-[8px] font-medium">Connected</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground line-clamp-2">{entry.text || "(empty)"}</p>
            {/* Voice + Generate */}
            <div className="flex items-center gap-1.5">
              <Select
                value={entry.voiceId ?? "__auto__"}
                onValueChange={(v) => {
                  const newDialogue = (data.dialogue ?? []).map((d, di) =>
                    di === i ? { ...d, voiceId: v === "__auto__" ? undefined : v } : d
                  )
                  onUpdate({ dialogue: newDialogue })
                }}
              >
                <SelectTrigger className="h-6 text-[10px] flex-1"><SelectValue placeholder="Voice" /></SelectTrigger>
                <SelectContent position="popper" className="z-[9999] max-h-48">
                  <SelectItem value="__auto__">Auto (Rachel)</SelectItem>
                  {TTS_VOICES.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                disabled={!entry.text.trim() || generatingAudio.has(i)}
                onClick={() => generateDialogueAudio(i)}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white transition-colors shrink-0"
              >
                {generatingAudio.has(i) ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
                {generatingAudio.has(i) ? "Generating..." : (entry.generatedAudioResults?.length ?? 0) > 0 ? "New Version" : "Generate"}
              </button>
            </div>
            {/* Audio version strip + player */}
            {(entry.generatedAudioResults?.length ?? 0) > 0 && (() => {
              const results = entry.generatedAudioResults ?? []
              const activeIdx = entry.activeAudioIndex ?? 0
              const activeAudio = results[activeIdx]
              return (
                <div className="flex flex-col gap-1">
                  {results.length > 1 && (
                    <div className="flex gap-1 overflow-x-auto">
                      {results.map((r, vi) => (
                        <div key={`${r.jobId}-${i}`} className="relative group/aver shrink-0">
                          <button
                            type="button"
                            onClick={() => setActiveAudioVersion(i, vi)}
                            className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${vi === activeIdx ? "bg-violet-500 text-white" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
                          >
                            {r.voiceId} #{vi + 1}
                          </button>
                          <button
                            type="button"
                            className="absolute -top-1 -right-1 w-3.5 h-3.5 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/aver:opacity-100 transition-opacity text-[8px]"
                            onClick={(e) => { e.stopPropagation(); deleteDialogueAudioVersion(i, vi) }}
                          >
                            <X className="w-2 h-2" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {activeAudio && (
                    <audio
                      src={activeAudio.url}
                      controls
                      className="w-full h-7 [&::-webkit-media-controls-panel]:h-7"
                    />
                  )}
                </div>
              )
            })()}
          </div>
        ))}
      </CollapsibleSection>
      )}
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

      {/* Connected Audio (from TTS nodes connected to audio handles) */}
      {nodeId && (() => {
        const AUDIO_HANDLES = ["audio1", "audio2", "audio3", "audio4", "audio5"] as const
        const audioEdges = workflowEdges.filter(
          (e) => e.target === nodeId && AUDIO_HANDLES.includes(e.targetHandle as typeof AUDIO_HANDLES[number])
        )
        if (audioEdges.length === 0) return null

        const connectedAudio = audioEdges.map((edge) => {
          const srcNode = workflowNodes.find((n) => n.id === edge.source)
          const srcData = srcNode?.data as Record<string, unknown> | undefined
          const results = (srcData?.generatedResults as readonly { url: string; jobId: string }[] | undefined) ?? []
          const activeIdx = (srcData?.activeResultIndex as number | undefined) ?? 0
          const audioUrl = results[activeIdx]?.url ?? (srcData?.generatedAudioUrl as string | undefined)
          return {
            handleId: edge.targetHandle ?? "",
            sourceNodeId: edge.source,
            label: (srcData?.label as string | undefined) ?? srcNode?.type ?? "Audio",
            url: audioUrl,
          }
        })

        const assignments = data.audioAssignments ?? []
        const dialogueLines = data.dialogue ?? []

        return (
          <CollapsibleSection title={`Connected Audio (${connectedAudio.length})`} icon={<Link2 className="w-3.5 h-3.5" />} defaultOpen>
            {connectedAudio.map((ca) => {
              const assignment = assignments.find((a) => a.handleId === ca.handleId)
              return (
                <div key={ca.handleId} className="flex flex-col gap-1.5 p-2 rounded-md border bg-muted/20">
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 font-medium">
                      {ca.handleId.replace("audio", "Audio ")}
                    </span>
                    <span className="text-muted-foreground truncate">{ca.label}</span>
                  </div>
                  {/* Assign to dialogue line */}
                  <div className="flex items-center gap-1.5">
                    <Select
                      value={assignment?.dialogueIndex !== undefined ? String(assignment.dialogueIndex) : "__none__"}
                      onValueChange={(v) => {
                        const newAssignments = assignments.filter((a) => a.handleId !== ca.handleId)
                        if (v !== "__none__") {
                          newAssignments.push({
                            handleId: ca.handleId,
                            sourceNodeId: ca.sourceNodeId,
                            dialogueIndex: parseInt(v, 10),
                            role: "dialogue",
                          })
                        }
                        onUpdate({ audioAssignments: newAssignments })
                      }}
                    >
                      <SelectTrigger className="h-6 text-[10px] flex-1"><SelectValue placeholder="Assign to..." /></SelectTrigger>
                      <SelectContent position="popper" className="z-[9999]">
                        <SelectItem value="__none__">Unassigned</SelectItem>
                        <SelectItem value="__narration__">Narration</SelectItem>
                        {dialogueLines.map((d, di) => (
                          <SelectItem key={di} value={String(di)}>
                            Line {di + 1}: {d.characterName} - {d.text.slice(0, 30)}{d.text.length > 30 ? "..." : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Audio player */}
                  {ca.url && (
                    <audio
                      src={ca.url}
                      controls
                      className="w-full h-7 [&::-webkit-media-controls-panel]:h-7"
                    />
                  )}
                  {!ca.url && (
                    <p className="text-[9px] text-muted-foreground italic">No audio generated yet</p>
                  )}
                </div>
              )
            })}
          </CollapsibleSection>
        )
      })()}

      </>
      )}

      {/* Step 4: VIDEO - Transitions */}
      {showStep(4) && (
      <>
      {/* Video Provider */}
      <div>
        <Label className="text-xs">Video Provider</Label>
        <Select value={data.videoProvider ?? "minimax"} onValueChange={(v) => onUpdate({ videoProvider: v })}>
          <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" className="z-[9999]">
            {["minimax", "veo", "veo3", "veo3.1", "kling", "kling-3.0", "runway", "pika"].map((p) => (
              <SelectItem key={p} value={p}>{p === "veo" ? "VEO 2" : p === "veo3" ? "VEO 3" : p === "veo3.1" ? "VEO 3.1" : p === "kling-3.0" ? "Kling 3.0" : p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* Duration */}
      <div>
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
      {/* Transitions */}
      <CollapsibleSection title="Transitions" icon={<ArrowRightLeft className="w-3.5 h-3.5" />}>
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <Label className="text-[10px]">Transition In</Label>
            <Select value={data.transitionIn} onValueChange={(v) => onUpdate({ transitionIn: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
              <SelectContent position="popper" className="z-[9999]">
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
              <SelectContent position="popper" className="z-[9999]">
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
      </>
      )}

      {/* Prompt Preview - only when not in wizard mode (modal has its own) */}
      {!step && <div className="border rounded-md">
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
            <div className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${
              generatedPrompt.length > PROMPT_MAX_LENGTH
                ? "text-red-500 font-medium"
                : generatedPrompt.length > PROMPT_MAX_LENGTH * 0.9
                  ? "text-amber-500"
                  : "text-muted-foreground"
            }`}>
              {generatedPrompt.length > PROMPT_MAX_LENGTH && (
                <AlertCircle className="w-3 h-3" />
              )}
              <span>{generatedPrompt.length}/{PROMPT_MAX_LENGTH}</span>
            </div>
          </div>
        )}
      </div>}

    </div>
  )
}
