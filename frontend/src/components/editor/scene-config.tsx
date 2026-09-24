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
import { textToSpeech, getJobStatusLean } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import type { SceneNodeDataType, SceneCharacterEntry, SceneObjectEntry, SceneDialogueEntry, SceneLocationEntry, GenerateScriptData, WorkflowNode, AudioAssignment } from "@/types/nodes"
import { mapScriptSceneToNodeData, getSceneCharacterNames } from "@/types/nodes"
import { VIDEO_I2V_MODELS, VIDEO_T2V_MODELS } from "@/components/editor/config-panels/model-options"
import { ModelSelectOption } from "@/components/editor/config-panels/model-select-option"
import { prefetchModelCredits } from "@/ee/hooks/use-model-credits"
import { WaveformAudioPlayer } from "@/components/audio-player"
import { useT, type MessageKey } from "@/lib/i18n"

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
        <span className="flex-1 text-start">{title}</span>
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

const QUICK_ADD_KEYS: Record<"character" | "location" | "object", { readonly button: MessageKey; readonly name: MessageKey }> = {
  character: { button: "scenecfg.quickAddCharacter", name: "scenecfg.characterName" },
  location: { button: "scenecfg.quickAddLocation", name: "scenecfg.locationName" },
  object: { button: "scenecfg.quickAddObject", name: "scenecfg.objectName" },
}

// Visible labels for the scene's enum options. The stored VALUE — the same
// token `buildScenePrompt` injects into the prompt — never changes; only what
// the user sees does. Typed against the data type so a value added there
// without a label fails tsc.
const SCENE_TIME_OF_DAY_LABEL: Record<SceneNodeDataType["timeOfDay"], MessageKey> = {
  dawn: "scenecfg.opt.dawn",
  morning: "scenecfg.opt.morning",
  noon: "scenecfg.opt.noon",
  afternoon: "scenecfg.opt.afternoon",
  sunset: "scenecfg.opt.sunset",
  evening: "scenecfg.opt.evening",
  night: "scenecfg.opt.night",
}
const SCENE_WEATHER_LABEL: Record<SceneNodeDataType["weather"], MessageKey> = {
  clear: "scenecfg.opt.clear",
  cloudy: "scenecfg.opt.cloudy",
  rainy: "scenecfg.opt.rainy",
  stormy: "scenecfg.opt.stormy",
  foggy: "scenecfg.opt.foggy",
  snowy: "scenecfg.opt.snowy",
}
const SCENE_LIGHTING_LABEL: Record<SceneNodeDataType["lighting"], MessageKey> = {
  natural: "scenecfg.opt.natural",
  artificial: "scenecfg.opt.artificial",
  dramatic: "scenecfg.opt.dramatic",
  soft: "scenecfg.opt.soft",
  harsh: "scenecfg.opt.harsh",
  backlit: "scenecfg.opt.backlit",
}
const SCENE_SHOT_TYPE_LABEL: Record<SceneNodeDataType["shotType"], MessageKey> = {
  "extreme-wide": "scenecfg.opt.shotExtremeWide",
  wide: "scenecfg.opt.shotWide",
  "medium-wide": "scenecfg.opt.shotMediumWide",
  medium: "scenecfg.opt.shotMedium",
  "medium-close": "scenecfg.opt.shotMediumClose",
  "close-up": "scenecfg.opt.shotCloseUp",
  "extreme-close-up": "scenecfg.opt.shotExtremeCloseUp",
}
const SCENE_CAMERA_ANGLE_LABEL: Record<SceneNodeDataType["cameraAngle"], MessageKey> = {
  "eye-level": "scenecfg.opt.eyeLevel",
  "low-angle": "scenecfg.opt.lowAngle",
  "high-angle": "scenecfg.opt.highAngle",
  "birds-eye": "scenecfg.opt.birdsEye",
  "worms-eye": "scenecfg.opt.wormsEye",
  dutch: "scenecfg.opt.dutch",
}
const SCENE_CAMERA_MOVEMENT_LABEL: Record<SceneNodeDataType["cameraMovement"], MessageKey> = {
  static: "scenecfg.opt.static",
  pan: "scenecfg.opt.pan",
  tilt: "scenecfg.opt.tilt",
  dolly: "scenecfg.opt.dolly",
  tracking: "scenecfg.opt.tracking",
  crane: "scenecfg.opt.crane",
  handheld: "scenecfg.opt.handheld",
  zoom: "scenecfg.opt.zoom",
}
const SCENE_DEPTH_OF_FIELD_LABEL: Record<SceneNodeDataType["depthOfField"], MessageKey> = {
  deep: "scenecfg.opt.dofDeep",
  medium: "scenecfg.opt.dofMedium",
  shallow: "scenecfg.opt.dofShallow",
}
const SCENE_LENS_TYPE_LABEL: Record<SceneNodeDataType["lensType"], MessageKey> = {
  wide: "scenecfg.opt.lensWide",
  normal: "scenecfg.opt.lensNormal",
  telephoto: "scenecfg.opt.lensTelephoto",
}
const SCENE_VISUAL_STYLE_LABEL: Record<SceneNodeDataType["visualStyle"], MessageKey> = {
  realistic: "scenecfg.opt.realistic",
  cinematic: "scenecfg.opt.cinematic",
  anime: "scenecfg.opt.anime",
  cartoon: "scenecfg.opt.cartoon",
  noir: "scenecfg.opt.noir",
  vintage: "scenecfg.opt.vintage",
  fantasy: "scenecfg.opt.fantasy",
  "sci-fi": "scenecfg.opt.sciFi",
}
const SCENE_TRANSITION_LABEL: Record<SceneNodeDataType["transitionIn"], MessageKey> = {
  cut: "scenecfg.opt.cut",
  fade: "scene.transitionFade",
  dissolve: "scene.transitionDissolve",
  wipe: "scenecfg.opt.wipe",
}

/** A label record's values, in declaration order, typed as the option union. */
function optionValues<V extends string>(labels: Record<V, MessageKey>): readonly V[] {
  return Object.keys(labels) as V[]
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
  const t = useT()
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
        <Plus className="w-3 h-3" /> {t(QUICK_ADD_KEYS[category].button)}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1 p-2 rounded-md border border-dashed bg-muted/10">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t(QUICK_ADD_KEYS[category].name)}
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
        <button type="button" onClick={() => setExpanded(false)} className="text-[10px] px-2 py-0.5 rounded hover:bg-muted">{t("common.cancel")}</button>
        <button type="button" onClick={handleAdd} disabled={!name.trim()} className="text-[10px] px-2 py-0.5 rounded bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50">{t("common.add")}</button>
      </div>
    </div>
  )
}

export function SceneConfig({ data, onUpdate, step, nodeId }: SceneConfigProps) {
  const { user } = useAuth()
  const t = useT()
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

  useEffect(() => {
    prefetchModelCredits([
      ...VIDEO_I2V_MODELS.map(m => m.value),
      ...VIDEO_T2V_MODELS.map(m => m.value),
    ])
  }, [])

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
          const job = await getJobStatusLean(jobId)
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
    const label = scene.sceneName ? `${idx + 1}. ${scene.sceneName}` : t("cfgext.sceneNumbered", { index: idx + 1 })
    const parts: string[] = [t("scenecfg.importedLabel", { label })]
    if (charNames.length > 0) parts.push(t(charNames.length > 1 ? "scenecfg.characterCountMany" : "scenecfg.characterCountOne", { n: charNames.length }))
    if (dialogueCount > 0) parts.push(t(dialogueCount > 1 ? "scenecfg.dialogueLineCountMany" : "scenecfg.dialogueLineCountOne", { n: dialogueCount }))
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
              <span className="text-xs font-medium">{t("scenecfg.scriptConnection")}</span>
              {data.sourceScriptNodeId && (
                <button type="button" onClick={handleUnlinkScript} className="ms-auto text-[10px] text-muted-foreground hover:text-destructive">
                  {t("scenecfg.unlink")}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <Select
                value={data.sourceScriptNodeId || "__none__"}
                onValueChange={(v) => onUpdate({ sourceScriptNodeId: v === "__none__" ? "" : v, sourceSceneIndex: -1 })}
              >
                <SelectTrigger className="h-7 text-[10px] flex-1" aria-label={t("scenecfg.selectScript")}>
                  <SelectValue placeholder={t("scenecfg.selectScriptPlaceholder")} />
                </SelectTrigger>
                <SelectContent position="popper" className="z-[9999]">
                  <SelectItem value="__none__">{t("scenecfg.noScript")}</SelectItem>
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
                  <SelectTrigger className="h-7 text-[10px] flex-1" aria-label={t("scenecfg.selectScene")}>
                    <SelectValue placeholder={t("scenecfg.selectScenePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[9999]">
                    <SelectItem value="__none__">{t("scenecfg.selectScene")}</SelectItem>
                    {linkedScriptScenes.map((s, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {s.sceneName ? `${i + 1}. ${s.sceneName}` : t("cfgext.sceneNumbered", { index: i + 1 })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {/* Scene preview */}
            {data.sourceScriptNodeId && data.sourceSceneIndex >= 0 && linkedScriptScenes[data.sourceSceneIndex] && (
              <div className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1.5 line-clamp-2">
                {linkedScriptScenes[data.sourceSceneIndex].visualDescription || linkedScriptScenes[data.sourceSceneIndex].action || t("scenecfg.noDescription")}
              </div>
            )}
            {data.sourceScriptNodeId && data.sourceSceneIndex >= 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleImportFromScript}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Download className="w-3 h-3" /> {t("scenecfg.importNow")}
                </button>
                <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={data.autoSyncWithScript ?? false}
                    onChange={(e) => handleAutoSyncToggle(e.target.checked)}
                    className="w-3 h-3"
                  />
                  {t("scenecfg.autoSync")}
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
            <Label className="text-xs">{t("scenecfg.sceneName")}</Label>
            <Input
              value={data.sceneName}
              onChange={(e) => onUpdate({ sceneName: e.target.value })}
              placeholder={t("scenecfg.sceneNamePlaceholder")}
              className="h-8 text-xs mt-1"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-xs">{t("scenecfg.sceneNumber")}</Label>
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
            <Label className="text-xs">{t("cfgext.reduceSummary")}</Label>
            <Textarea
              value={data.summary}
              onChange={(e) => onUpdate({ summary: e.target.value })}
              placeholder={t("scenecfg.summaryPlaceholder")}
              rows={2}
              className="text-xs mt-1 resize-none"
            />
          </div>
        </div>
      {/* Dialogue (text editing) */}
      <CollapsibleSection title={t("scenecfg.dialogueCount", { n: data.dialogue?.length ?? 0 })} icon={<MessageSquare className="w-3.5 h-3.5" />} defaultOpen={(data.dialogue?.length ?? 0) > 0}>
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
                <SelectTrigger className="h-6 text-[10px] flex-1" aria-label={t("scenecfg.selectSpeaker")}><SelectValue placeholder={t("scenecfg.speaker")} /></SelectTrigger>
                <SelectContent position="popper" className="z-[9999]">
                  <SelectItem value="__narrator__">{t("scenecfg.narrator")}</SelectItem>
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
                placeholder={t("scenecfg.emotion")}
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
              placeholder={t("scenecfg.dialogueLinePlaceholder")}
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
          <Plus className="w-3 h-3" /> {t("scenecfg.addDialogueLine")}
        </button>
      </CollapsibleSection>
      </>
      )}

      {/* Step 2: IMAGE - Characters, Locations, Objects */}
      {showStep(2) && (
      <>
      {/* Characters */}
      <CollapsibleSection title={t("scenecfg.charactersCount", { n: data.characters.length })} icon={<Users className="w-3.5 h-3.5" />} defaultOpen={data.characters.length > 0}>
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
                  <span className="text-xs font-medium">{asset?.name ?? t("common.unknown")}</span>
                </div>
                <button type="button" onClick={() => removeCharacter(i)} className="p-0.5 hover:text-destructive">
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="flex gap-1.5">
                <Input
                  value={entry.mood}
                  onChange={(e) => updateCharacter(i, { mood: e.target.value })}
                  placeholder={t("scriptcfg.sceneMood")}
                  className="h-6 text-[10px] flex-1"
                />
                <Input
                  value={entry.action}
                  onChange={(e) => updateCharacter(i, { action: e.target.value })}
                  placeholder={t("scriptcfg.sceneAction")}
                  className="h-6 text-[10px] flex-1"
                />
              </div>
              <Select
                value={entry.positionInFrame ?? "__none__"}
                onValueChange={(v) => updateCharacter(i, { positionInFrame: v === "__none__" ? undefined : v as SceneCharacterEntry["positionInFrame"] })}
              >
                <SelectTrigger className="h-6 text-[10px]" aria-label={t("scenecfg.selectPosition")}><SelectValue placeholder={t("proccfg.position")} /></SelectTrigger>
                <SelectContent position="popper" className="z-[9999]">
                  <SelectItem value="__none__">{t("scenecfg.noPosition")}</SelectItem>
                  <SelectItem value="left">{t("common.left")}</SelectItem>
                  <SelectItem value="center">{t("proccfg.center")}</SelectItem>
                  <SelectItem value="right">{t("common.right")}</SelectItem>
                  <SelectItem value="foreground">{t("scenecfg.foreground")}</SelectItem>
                  <SelectItem value="background">{t("audiocfg.mergeRoleBackground")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )
        })}
        <Select onValueChange={(v) => { if (v === "__create_new__") { setExpandQuickAdd("character") } else { addCharacter(v) } }}>
          <SelectTrigger className="h-7 text-[10px]" aria-label={t("scenecfg.addCharacter")}>
            <Plus className="w-3 h-3 me-1" />
            <SelectValue placeholder={t("scenecfg.addCharacterPlaceholder")} />
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
              <span className="flex items-center gap-1.5 text-violet-500"><Plus className="w-3 h-3" /> {t("scenecfg.createNewCharacter")}</span>
            </SelectItem>
          </SelectContent>
        </Select>
        <QuickAddInput
          category="character"
          placeholder={t("scenecfg.characterExample")}
          onAdd={(name, desc) => handleQuickAdd("character", name, desc)}
          autoExpand={expandQuickAdd === "character"}
          onAutoExpandHandled={() => setExpandQuickAdd(null)}
        />
      </CollapsibleSection>
      {/* Locations */}
      <CollapsibleSection title={t("scenecfg.locationsCount", { n: (data.locations ?? []).length })} icon={<MapPin className="w-3.5 h-3.5" />} defaultOpen={(data.locations ?? []).length > 0}>
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
                  <span className="text-xs font-medium">{loc.name ?? asset?.name ?? t("common.unknown")}</span>
                  {loc.isPrimary && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-cyan-500/10 text-cyan-500">{t("scenecfg.primary")}</span>
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
                      title={t("scenecfg.setAsPrimary")}
                    >
                      {t("scenecfg.primary")}
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
                  <Label className="text-[10px]">{t("scenecfg.time")}</Label>
                  <Select
                    value={loc.timeOfDay ?? data.timeOfDay}
                    onValueChange={(v) => {
                      const newLocs = (data.locations ?? []).map((l, li) => li === i ? { ...l, timeOfDay: v as SceneLocationEntry["timeOfDay"] } : l)
                      onUpdate({ locations: newLocs })
                    }}
                  >
                    <SelectTrigger className="h-6 text-[10px] mt-0.5" aria-label={t("scenecfg.selectTimeOfDay")}><SelectValue /></SelectTrigger>
                    <SelectContent position="popper" className="z-[9999]">
                      {optionValues(SCENE_TIME_OF_DAY_LABEL).map((v) => (
                        <SelectItem key={v} value={v}>{t(SCENE_TIME_OF_DAY_LABEL[v])}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">{t("scenecfg.weather")}</Label>
                  <Select
                    value={loc.weather ?? data.weather}
                    onValueChange={(v) => {
                      const newLocs = (data.locations ?? []).map((l, li) => li === i ? { ...l, weather: v as SceneLocationEntry["weather"] } : l)
                      onUpdate({ locations: newLocs })
                    }}
                  >
                    <SelectTrigger className="h-6 text-[10px] mt-0.5" aria-label={t("scenecfg.selectWeather")}><SelectValue /></SelectTrigger>
                    <SelectContent position="popper" className="z-[9999]">
                      {optionValues(SCENE_WEATHER_LABEL).map((v) => (
                        <SelectItem key={v} value={v}>{t(SCENE_WEATHER_LABEL[v])}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">{t("paramcfg.lighting")}</Label>
                  <Select
                    value={loc.lighting ?? data.lighting}
                    onValueChange={(v) => {
                      const newLocs = (data.locations ?? []).map((l, li) => li === i ? { ...l, lighting: v as SceneLocationEntry["lighting"] } : l)
                      onUpdate({ locations: newLocs })
                    }}
                  >
                    <SelectTrigger className="h-6 text-[10px] mt-0.5" aria-label={t("scenecfg.selectLighting")}><SelectValue /></SelectTrigger>
                    <SelectContent position="popper" className="z-[9999]">
                      {optionValues(SCENE_LIGHTING_LABEL).map((v) => (
                        <SelectItem key={v} value={v}>{t(SCENE_LIGHTING_LABEL[v])}</SelectItem>
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
          <SelectTrigger className="h-7 text-[10px]" aria-label={t("scenecfg.addLocation")}>
            <Plus className="w-3 h-3 me-1" />
            <SelectValue placeholder={t("scenecfg.addLocationPlaceholder")} />
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
              <span className="flex items-center gap-1.5 text-violet-500"><Plus className="w-3 h-3" /> {t("scenecfg.createNewLocation")}</span>
            </SelectItem>
          </SelectContent>
        </Select>
        <QuickAddInput
          category="location"
          placeholder={t("scenecfg.locationExample")}
          onAdd={(name, desc) => handleQuickAdd("location", name, desc)}
          autoExpand={expandQuickAdd === "location"}
          onAutoExpandHandled={() => setExpandQuickAdd(null)}
        />

        {/* Default environment (when no locations or as fallback) */}
        <div className="mt-1">
          <Label className="text-[10px] text-muted-foreground">{t("scenecfg.defaultEnvironment")}</Label>
          <div className="grid grid-cols-3 gap-1.5 mt-0.5">
            <div>
              <Label className="text-[10px]">{t("scenecfg.time")}</Label>
              <Select value={data.timeOfDay} onValueChange={(v) => onUpdate({ timeOfDay: v })}>
                <SelectTrigger className="h-6 text-[10px] mt-0.5" aria-label={t("scenecfg.selectDefaultTimeOfDay")}><SelectValue /></SelectTrigger>
                <SelectContent position="popper" className="z-[9999]">
                  {optionValues(SCENE_TIME_OF_DAY_LABEL).map((v) => (
                    <SelectItem key={v} value={v}>{t(SCENE_TIME_OF_DAY_LABEL[v])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">{t("scenecfg.weather")}</Label>
              <Select value={data.weather} onValueChange={(v) => onUpdate({ weather: v })}>
                <SelectTrigger className="h-6 text-[10px] mt-0.5" aria-label={t("scenecfg.selectDefaultWeather")}><SelectValue /></SelectTrigger>
                <SelectContent position="popper" className="z-[9999]">
                  {optionValues(SCENE_WEATHER_LABEL).map((v) => (
                    <SelectItem key={v} value={v}>{t(SCENE_WEATHER_LABEL[v])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">{t("paramcfg.lighting")}</Label>
              <Select value={data.lighting} onValueChange={(v) => onUpdate({ lighting: v })}>
                <SelectTrigger className="h-6 text-[10px] mt-0.5" aria-label={t("scenecfg.selectDefaultLighting")}><SelectValue /></SelectTrigger>
                <SelectContent position="popper" className="z-[9999]">
                  {optionValues(SCENE_LIGHTING_LABEL).map((v) => (
                    <SelectItem key={v} value={v}>{t(SCENE_LIGHTING_LABEL[v])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Objects */}
      <CollapsibleSection title={t("scenecfg.objectsCount", { n: data.objects.length })} icon={<Box className="w-3.5 h-3.5" />}>
        {data.objects.map((entry, i) => {
          const asset = allAssets.find((a) => a.id === entry.assetId)
          return (
            <div key={`${entry.assetId}-${i}`} className={`flex items-center gap-1.5 p-2 rounded-md border transition-colors duration-500 ${recentlyAdded.has(entry.assetId) ? "bg-green-500/10 border-green-500/30" : "bg-muted/20"}`}>
              {recentlyAdded.has(entry.assetId) && <Check className="w-3 h-3 text-green-500" />}
              {asset?.referenceImageUrl && (
                <CachedImage src={asset.referenceImageUrl} alt={asset.name} className="w-6 h-6 rounded object-cover" thumbnail thumbnailWidth={80} />
              )}
              <span className="text-xs font-medium flex-1">{asset?.name ?? t("common.unknown")}</span>
              <Input
                value={entry.description ?? ""}
                onChange={(e) => updateObject(i, { description: e.target.value })}
                placeholder={t("scenecfg.note")}
                className="h-6 text-[10px] w-24"
              />
              <button type="button" onClick={() => removeObject(i)} className="p-0.5 hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </div>
          )
        })}
        <Select onValueChange={(v) => { if (v === "__create_new__") { setExpandQuickAdd("object") } else { addObject(v) } }}>
          <SelectTrigger className="h-7 text-[10px]" aria-label={t("scenecfg.addObject")}>
            <Plus className="w-3 h-3 me-1" />
            <SelectValue placeholder={t("scenecfg.addObjectPlaceholder")} />
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
              <span className="flex items-center gap-1.5 text-violet-500"><Plus className="w-3 h-3" /> {t("scenecfg.createNewObject")}</span>
            </SelectItem>
          </SelectContent>
        </Select>
        <QuickAddInput
          category="object"
          placeholder={t("scenecfg.objectExample")}
          onAdd={(name, desc) => handleQuickAdd("object", name, desc)}
          autoExpand={expandQuickAdd === "object"}
          onAutoExpandHandled={() => setExpandQuickAdd(null)}
        />
      </CollapsibleSection>
      {/* Cinematography */}
      <CollapsibleSection title={t("scenecfg.cinematography")} icon={<Camera className="w-3.5 h-3.5" />}>
        <div>
          <Label className="text-[10px]">{t("field.aspectRatio")}</Label>
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
            <Label className="text-[10px]">{t("scenecfg.shotType")}</Label>
            <Select value={data.shotType} onValueChange={(v) => onUpdate({ shotType: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5" aria-label={t("scenecfg.selectShotType")}><SelectValue /></SelectTrigger>
              <SelectContent position="popper" className="z-[9999]">
                {optionValues(SCENE_SHOT_TYPE_LABEL).map((v) => (
                  <SelectItem key={v} value={v}>{t(SCENE_SHOT_TYPE_LABEL[v])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px]">{t("scenecfg.cameraAngle")}</Label>
            <Select value={data.cameraAngle} onValueChange={(v) => onUpdate({ cameraAngle: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5" aria-label={t("scenecfg.selectCameraAngle")}><SelectValue /></SelectTrigger>
              <SelectContent position="popper" className="z-[9999]">
                {optionValues(SCENE_CAMERA_ANGLE_LABEL).map((v) => (
                  <SelectItem key={v} value={v}>{t(SCENE_CAMERA_ANGLE_LABEL[v])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px]">{t("scenecfg.movement")}</Label>
            <Select value={data.cameraMovement} onValueChange={(v) => onUpdate({ cameraMovement: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5" aria-label={t("scenecfg.selectCameraMovement")}><SelectValue /></SelectTrigger>
              <SelectContent position="popper" className="z-[9999]">
                {optionValues(SCENE_CAMERA_MOVEMENT_LABEL).map((v) => (
                  <SelectItem key={v} value={v}>{t(SCENE_CAMERA_MOVEMENT_LABEL[v])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px]">{t("scenecfg.depthOfField")}</Label>
            <Select value={data.depthOfField} onValueChange={(v) => onUpdate({ depthOfField: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5" aria-label={t("scenecfg.selectDepthOfField")}><SelectValue /></SelectTrigger>
              <SelectContent position="popper" className="z-[9999]">
                {optionValues(SCENE_DEPTH_OF_FIELD_LABEL).map((v) => (
                  <SelectItem key={v} value={v}>{t(SCENE_DEPTH_OF_FIELD_LABEL[v])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px]">{t("paramcfg.lens")}</Label>
            <Select value={data.lensType} onValueChange={(v) => onUpdate({ lensType: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5" aria-label={t("scenecfg.selectLensType")}><SelectValue /></SelectTrigger>
              <SelectContent position="popper" className="z-[9999]">
                {optionValues(SCENE_LENS_TYPE_LABEL).map((v) => (
                  <SelectItem key={v} value={v}>{t(SCENE_LENS_TYPE_LABEL[v])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CollapsibleSection>

      {/* Mood & Style */}
      <CollapsibleSection title={t("scenecfg.moodStyle")} icon={<Palette className="w-3.5 h-3.5" />}>
        <div>
          <Label className="text-[10px]">{t("scenecfg.visualStyle")}</Label>
          <Select value={data.visualStyle} onValueChange={(v) => onUpdate({ visualStyle: v })}>
            <SelectTrigger className="h-7 text-[10px] mt-0.5" aria-label={t("scenecfg.selectVisualStyle")}><SelectValue /></SelectTrigger>
            <SelectContent position="popper" className="z-[9999]">
              {optionValues(SCENE_VISUAL_STYLE_LABEL).map((v) => (
                <SelectItem key={v} value={v}>{t(SCENE_VISUAL_STYLE_LABEL[v])}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px]">{t("scenecfg.moodTags")}</Label>
          <TagInput
            value={data.mood}
            onChange={(tags) => onUpdate({ mood: tags })}
            placeholder={t("scenecfg.moodTagsPlaceholder")}
          />
        </div>
        <div>
          <Label className="text-[10px]">{t("scenecfg.colorPalette")}</Label>
          <TagInput
            value={data.colorPalette}
            onChange={(tags) => onUpdate({ colorPalette: tags })}
            placeholder={t("scenecfg.colorPalettePlaceholder")}
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
      <CollapsibleSection title={t("scenecfg.voiceAudioCount", { n: data.dialogue?.length ?? 0 })} icon={<MessageSquare className="w-3.5 h-3.5" />} defaultOpen>
        {(data.dialogue ?? []).map((entry, i) => (
          <div key={i} className="flex flex-col gap-1.5 p-2 rounded-md border bg-muted/20">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground">{entry.characterName}</span>
              {entry.emotion && <span>({entry.emotion})</span>}
              {(data.audioAssignments ?? []).some((a) => a.dialogueIndex === i) && (
                <span className="px-1 py-0.5 rounded bg-violet-500/20 text-violet-500 text-[8px] font-medium">{t("integ.connected")}</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground line-clamp-2">{entry.text || t("scenecfg.emptyText")}</p>
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
                <SelectTrigger className="h-6 text-[10px] flex-1" aria-label={t("scenecfg.selectVoice")}><SelectValue placeholder={t("field.voice")} /></SelectTrigger>
                <SelectContent position="popper" className="z-[9999] max-h-48">
                  <SelectItem value="__auto__">{t("scenecfg.autoVoice")}</SelectItem>
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
                {generatingAudio.has(i) ? t("cfgext.entGenerating") : (entry.generatedAudioResults?.length ?? 0) > 0 ? t("scenecfg.newVersion") : t("common.generate")}
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
                            className="absolute -top-1 -end-1 w-3.5 h-3.5 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/aver:opacity-100 transition-opacity text-[8px]"
                            onClick={(e) => { e.stopPropagation(); deleteDialogueAudioVersion(i, vi) }}
                          >
                            <X className="w-2 h-2" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {activeAudio && (
                    <WaveformAudioPlayer url={activeAudio.url} variant="compact" className="w-full" />
                  )}
                </div>
              )
            })()}
          </div>
        ))}
      </CollapsibleSection>
      )}
      {/* Audio */}
      <CollapsibleSection title={t("field.audio")} icon={<Volume2 className="w-3.5 h-3.5" />}>
        <div>
          <Label className="text-[10px]">{t("audiocfg.mergeRoleNarration")}</Label>
          <Textarea
            value={data.narration}
            onChange={(e) => onUpdate({ narration: e.target.value })}
            placeholder={t("scenecfg.narrationPlaceholder")}
            rows={2}
            className="text-xs mt-0.5 resize-none"
          />
        </div>
        <div>
          <Label className="text-[10px]">{t("scenecfg.musicMood")}</Label>
          <Input
            value={data.musicMood}
            onChange={(e) => onUpdate({ musicMood: e.target.value })}
            placeholder={t("scenecfg.musicMoodPlaceholder")}
            className="h-7 text-[10px] mt-0.5"
          />
        </div>
        <div>
          <Label className="text-[10px]">{t("cfgext.kling3SoundEffects")}</Label>
          <TagInput
            value={data.soundEffects}
            onChange={(tags) => onUpdate({ soundEffects: tags })}
            placeholder={t("scenecfg.sfxPlaceholder")}
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
            label: (srcData?.label as string | undefined) ?? srcNode?.type ?? t("field.audio"),
            url: audioUrl,
          }
        })

        const assignments = data.audioAssignments ?? []
        const dialogueLines = data.dialogue ?? []

        return (
          <CollapsibleSection title={t("scenecfg.connectedAudioCount", { n: connectedAudio.length })} icon={<Link2 className="w-3.5 h-3.5" />} defaultOpen>
            {connectedAudio.map((ca) => {
              const assignment = assignments.find((a) => a.handleId === ca.handleId)
              return (
                <div key={ca.handleId} className="flex flex-col gap-1.5 p-2 rounded-md border bg-muted/20">
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 font-medium">
                      {t("scenecfg.audioHandle", { n: ca.handleId.replace("audio", "") })}
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
                      <SelectTrigger className="h-6 text-[10px] flex-1" aria-label={t("scenecfg.assignAudioToDialogue")}><SelectValue placeholder={t("scenecfg.assignToPlaceholder")} /></SelectTrigger>
                      <SelectContent position="popper" className="z-[9999]">
                        <SelectItem value="__none__">{t("scenecfg.unassigned")}</SelectItem>
                        <SelectItem value="__narration__">{t("audiocfg.mergeRoleNarration")}</SelectItem>
                        {dialogueLines.map((d, di) => (
                          <SelectItem key={di} value={String(di)}>
                            {t("scenecfg.dialogueLineOption", { n: di + 1, name: d.characterName, text: `${d.text.slice(0, 30)}${d.text.length > 30 ? "..." : ""}` })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Audio player */}
                  {ca.url && (
                    <WaveformAudioPlayer url={ca.url} variant="compact" className="w-full" />
                  )}
                  {!ca.url && (
                    <p className="text-[9px] text-muted-foreground italic">{t("scenecfg.noAudioYet")}</p>
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
        <Label className="text-xs">{t("scenecfg.videoProvider")}</Label>
        <Select value={data.videoProvider ?? "minimax"} onValueChange={(v) => onUpdate({ videoProvider: v })}>
          <SelectTrigger className="h-8 text-xs mt-1" aria-label={t("scenecfg.selectVideoProvider")}><SelectValue /></SelectTrigger>
          <SelectContent position="popper" className="z-[9999] max-h-72">
            <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground">{t("scenecfg.imageToVideoGroup")}</p>
            {VIDEO_I2V_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
            <SelectSeparator />
            <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground">{t("scenecfg.textToVideoGroup")}</p>
            {VIDEO_T2V_MODELS.filter((m) => !VIDEO_I2V_MODELS.some((i) => i.value === m.value)).map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* Duration */}
      <div>
        <Label className="text-xs">{t("scriptcfg.durationS")}</Label>
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
      <CollapsibleSection title={t("scenecfg.transitions")} icon={<ArrowRightLeft className="w-3.5 h-3.5" />}>
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <Label className="text-[10px]">{t("scenecfg.transitionIn")}</Label>
            <Select value={data.transitionIn} onValueChange={(v) => onUpdate({ transitionIn: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5" aria-label={t("scenecfg.selectTransitionIn")}><SelectValue /></SelectTrigger>
              <SelectContent position="popper" className="z-[9999]">
                {optionValues(SCENE_TRANSITION_LABEL).map((v) => (
                  <SelectItem key={v} value={v}>{t(SCENE_TRANSITION_LABEL[v])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px]">{t("scenecfg.transitionOut")}</Label>
            <Select value={data.transitionOut} onValueChange={(v) => onUpdate({ transitionOut: v })}>
              <SelectTrigger className="h-6 text-[10px] mt-0.5" aria-label={t("scenecfg.selectTransitionOut")}><SelectValue /></SelectTrigger>
              <SelectContent position="popper" className="z-[9999]">
                {optionValues(SCENE_TRANSITION_LABEL).map((v) => (
                  <SelectItem key={v} value={v}>{t(SCENE_TRANSITION_LABEL[v])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CollapsibleSection>

      {/* Director Notes */}
      <CollapsibleSection title={t("scenecfg.directorNotes")} icon={<StickyNote className="w-3.5 h-3.5" />}>
        <Textarea
          value={data.directorNotes}
          onChange={(e) => onUpdate({ directorNotes: e.target.value })}
          placeholder={t("scenecfg.directorNotesPlaceholder")}
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
          <span className="flex-1 text-start">{t("scenecfg.previewGeneratedPrompt")}</span>
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
