"use client"

import { useEffect, useCallback, useState, useMemo, createContext, useContext } from "react"
import { createPortal } from "react-dom"
import { X, ImageIcon, Film, Sparkles, Play, Loader2, AlertCircle, RotateCcw, Layers, Info, Link, Scissors, UserPlus, FileText, Download, Plus, Trash2, Clapperboard, Eye, MessageSquare, Users, Pen, GripVertical } from "lucide-react"
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, sortableKeyboardCoordinates, useSortable, rectSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { ExtractReferencesModal } from "./extract-references-modal"
import { DefineCharacterModal } from "./define-character-modal"
import { ImportAssetsModal } from "./manage-characters-modal"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { GeneratedScript, ExtractedReference, CharacterDefinition, ScriptScene } from "@/types/nodes"
import { getSceneCharacterNames, getSceneMoodDisplay } from "@/types/nodes"

interface ScriptPreviewModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly script: GeneratedScript
  readonly onGenerateScene: (sceneIndex: number) => Promise<void>
  readonly onSetActiveImage: (sceneIndex: number, imageIndex: number) => void
  readonly onDeleteImage: (sceneIndex: number, imageIndex: number) => void
  readonly onExpandToNodes: () => void
  readonly onUpdateSceneCharacters: (sceneIndex: number, characters: string[]) => void
  readonly onUpdateSceneField: (sceneIndex: number, field: string, value: unknown) => void
  readonly onCreateSceneNode: (sceneIndex: number) => void
  readonly onUpdateScenes: (scenes: readonly ScriptScene[]) => void
  readonly extractedReferences: readonly ExtractedReference[]
  readonly onSaveReferences: (references: readonly ExtractedReference[]) => void
}

export function ScriptPreviewModal({
  isOpen,
  onClose,
  script,
  onGenerateScene,
  onSetActiveImage,
  onDeleteImage,
  onExpandToNodes,
  onUpdateSceneCharacters,
  onUpdateSceneField,
  onCreateSceneNode,
  onUpdateScenes,
  extractedReferences,
  onSaveReferences,
}: ScriptPreviewModalProps) {
  const [generatingAll, setGeneratingAll] = useState(false)
  const [extractModalScene, setExtractModalScene] = useState<number | null>(null)
  const [extractAutoOpened, setExtractAutoOpened] = useState(false)
  const [characterInput, setCharacterInput] = useState<Record<number, string>>({})
  const [allProgress, setAllProgress] = useState({ current: 0, total: 0 })
  const [deleteConfirm, setDeleteConfirm] = useState<{ sceneIndex: number; imageIndex: number } | null>(null)
  const [focusedCharInput, setFocusedCharInput] = useState<number | null>(null)
  const [confirmingDeleteScene, setConfirmingDeleteScene] = useState<number | null>(null)
  const [showDefineCharModal, setShowDefineCharModal] = useState(false)
  const [showManageCharModal, setShowManageCharModal] = useState(false)
  const [editingCharDef, setEditingCharDef] = useState<CharacterDefinition | null>(null)
  const allCharDefs = useWorkflowStore((s) => s.characterDefinitions)
  const addCharacterDefinition = useWorkflowStore((s) => s.addCharacterDefinition)
  const updateCharacterDefinition = useWorkflowStore((s) => s.updateCharacterDefinition)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose()
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, handleKeyDown])

  const sceneIds = useMemo(() => script.scenes.map((s) => `scene-${s.sceneNumber}`), [script.scenes])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (!isOpen) return null

  const sceneCount = script.scenes.length
  const totalCredits = 2 + sceneCount * 28
  const pendingCount = script.scenes.filter((s) => {
    const images = s.generatedImages ?? []
    return images.length === 0 && s.imageStatus !== "running"
  }).length
  const hasAnyRunning = script.scenes.some((s) => s.imageStatus === "running")

  // Build map of character name -> list of scene numbers they appear in
  const charSceneMap: Record<string, number[]> = {}
  for (const scene of script.scenes) {
    for (const char of getSceneCharacterNames(scene.characters)) {
      const arr = charSceneMap[char] ?? []
      arr.push(scene.sceneNumber)
      charSceneMap[char] = arr
    }
  }
  // Include names from extracted references so they appear as suggestions in all scenes
  for (const ref of extractedReferences) {
    if (ref.type === "character" && !charSceneMap[ref.name]) {
      charSceneMap[ref.name] = [ref.sourceSceneIndex + 1]
    }
  }
  // Include names from workflow-level character definitions
  for (const def of allCharDefs) {
    if (!charSceneMap[def.name]) {
      charSceneMap[def.name] = []
    }
  }
  const allCharacters = Object.keys(charSceneMap)

  function hasDescriptionOnlyChars(sceneIndex: number): boolean {
    const scene = script.scenes[sceneIndex]
    const chars = getSceneCharacterNames(scene?.characters)
    const currentDefs = useWorkflowStore.getState().characterDefinitions
    return chars.some((name) => {
      const def = currentDefs.find((c) => c.name === name)
      return def && def.type === "description" && !def.referenceImageUrl
    })
  }

  async function handleGenerateScene(sceneIndex: number) {
    await onGenerateScene(sceneIndex)
    // After successful generation, auto-open Extract modal if description-only chars exist
    if (hasDescriptionOnlyChars(sceneIndex)) {
      setExtractAutoOpened(true)
      setExtractModalScene(sceneIndex)
    }
  }

  async function handleGenerateAll() {
    setGeneratingAll(true)
    setAllProgress({ current: 0, total: pendingCount })
    let completed = 0

    for (let i = 0; i < script.scenes.length; i++) {
      const scene = script.scenes[i]
      const images = scene.generatedImages ?? []
      if (images.length > 0 || scene.imageStatus === "running") continue

      try {
        await handleGenerateScene(i)
      } catch {
        // Continue to next scene on failure
      }
      completed += 1
      setAllProgress({ current: completed, total: pendingCount })
    }

    setGeneratingAll(false)
  }

  function renumberScenes(scenes: readonly ScriptScene[]): readonly ScriptScene[] {
    return scenes.map((s, idx) => ({ ...s, sceneNumber: idx + 1 }))
  }

  function handleDeleteScene(sceneIndex: number) {
    if (script.scenes.length <= 1) return
    const updated = script.scenes.filter((_, idx) => idx !== sceneIndex)
    setConfirmingDeleteScene(null)
    onUpdateScenes(renumberScenes(updated))
  }

  function handleAddScene(insertAfterIndex?: number) {
    const insertIdx = insertAfterIndex !== undefined ? insertAfterIndex + 1 : script.scenes.length
    const newScene: ScriptScene = {
      sceneNumber: insertIdx + 1,
      visualDescription: "",
      action: "",
      mood: "",
      durationHint: 5,
      imagePrompt: "",
    }
    const updated = [
      ...script.scenes.slice(0, insertIdx),
      newScene,
      ...script.scenes.slice(insertIdx),
    ]
    onUpdateScenes(renumberScenes(updated))
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = sceneIds.indexOf(String(active.id))
    const newIndex = sceneIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const updated = [...script.scenes]
    const [moved] = updated.splice(oldIndex, 1)
    updated.splice(newIndex, 0, moved)
    onUpdateScenes(renumberScenes(updated))
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-8"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="relative bg-card rounded-xl shadow-2xl w-[95vw] max-w-[1400px] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-3 right-3 z-10 text-muted-foreground hover:text-foreground transition-colors"
          onClick={onClose}
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b">
          <h2 className="text-lg font-semibold pr-8">{script.title}</h2>
          <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
            <span>{sceneCount} scenes</span>
            <span>{script.totalDuration}s total</span>
            <span className="flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />
              Est. {totalCredits} credits
            </span>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="flex items-center gap-2 h-8 px-4 text-xs font-medium rounded-md bg-purple-600 hover:bg-purple-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={generatingAll || hasAnyRunning || pendingCount === 0}
              onClick={handleGenerateAll}
            >
              {generatingAll ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Generating {allProgress.current}/{allProgress.total}...
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  Generate All Images
                  {pendingCount > 0 && (
                    <span className="text-purple-200">
                      ({pendingCount * 5} credits for {pendingCount} images)
                    </span>
                  )}
                </>
              )}
            </button>
            <button
              type="button"
              className="flex items-center gap-2 h-8 px-4 text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors"
              onClick={onExpandToNodes}
            >
              <Layers className="w-3.5 h-3.5" />
              Expand to Nodes
            </button>
          </div>
        </div>

        {/* Storyboard grid */}
        <div className="flex-1 overflow-y-auto p-6">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sceneIds} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {script.scenes.map((scene, i) => {
              const status = scene.imageStatus ?? "idle"
              const images = scene.generatedImages ?? []
              const activeIdx = scene.activeImageIndex ?? 0
              const activeImage = images[activeIdx]
              const charNames = getSceneCharacterNames(scene.characters)

              return (
                <SortableSceneCard key={scene.sceneNumber} id={`scene-${scene.sceneNumber}`} disabled={generatingAll}>
                <div
                  className={`rounded-lg border p-3 flex flex-col gap-2 min-w-0 group/scene ${
                    status === "failed"
                      ? "border-red-500/50 bg-red-500/5"
                      : "bg-muted/20"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                      <DragHandle />
                      Scene {scene.sceneNumber}
                    </span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={scene.durationHint}
                        onChange={(e) => onUpdateSceneField(i, "durationHint", Math.max(1, Math.min(60, parseInt(e.target.value) || 1)))}
                        className="w-12 h-5 text-xs text-right text-muted-foreground bg-transparent border border-transparent hover:border-border focus:border-primary focus:outline-none rounded px-1"
                        title="Duration (seconds)"
                      />
                      {script.scenes.length > 1 && (
                        confirmingDeleteScene === i ? (
                          <span className="flex items-center gap-1 text-[10px]">
                            <span className="text-red-500 font-medium">Delete?</span>
                            <button
                              type="button"
                              className="px-1.5 py-0.5 rounded text-[10px] bg-muted hover:bg-muted/80 text-muted-foreground"
                              onClick={(e) => { e.stopPropagation(); setConfirmingDeleteScene(null) }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="px-1.5 py-0.5 rounded text-[10px] bg-red-500 hover:bg-red-600 text-white"
                              onClick={(e) => { e.stopPropagation(); handleDeleteScene(i) }}
                            >
                              Delete
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="w-5 h-5 flex items-center justify-center text-muted-foreground/40 hover:text-red-500 transition-colors opacity-0 group-hover/scene:opacity-100"
                            onClick={(e) => { e.stopPropagation(); setConfirmingDeleteScene(i) }}
                            title="Delete scene"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Image area */}
                  <div className="relative w-full aspect-video rounded-md overflow-hidden">
                    {activeImage ? (
                      <img
                        src={activeImage.url}
                        alt={`Scene ${scene.sceneNumber}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-muted/40 border border-dashed border-muted-foreground/20 flex items-center justify-center">
                        {status === "running" ? (
                          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground/40" />
                        ) : status === "failed" ? (
                          <AlertCircle className="w-6 h-6 text-red-400/60" />
                        ) : (
                          <ImageIcon className="w-8 h-8 text-muted-foreground/20" />
                        )}
                      </div>
                    )}

                    {/* Running overlay on existing image */}
                    {status === "running" && activeImage && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <Loader2 className="w-5 h-5 animate-spin text-white/70" />
                      </div>
                    )}

                    {/* Hover overlay with Run/Retry button */}
                    {status !== "running" && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/scene:opacity-100 transition-opacity">
                        <button
                          type="button"
                          className="flex items-center gap-1.5 h-7 px-3 text-xs font-medium rounded-md bg-white/90 text-black hover:bg-white transition-colors"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleGenerateScene(i)
                          }}
                        >
                          {status === "failed" && !activeImage ? (
                            <><RotateCcw className="w-3 h-3" />Retry</>
                          ) : activeImage ? (
                            <><Play className="w-3 h-3" />New Version</>
                          ) : (
                            <><Play className="w-3 h-3" />Generate</>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Version indicators */}
                  {images.length > 1 && (
                    <div className="flex gap-1 overflow-x-auto">
                      {images.slice(0, 5).map((img, vi) => (
                        <div key={img.jobId} className="relative group/ver shrink-0">
                          <button
                            type="button"
                            className={`w-7 h-7 rounded overflow-hidden border transition-opacity ${
                              vi === activeIdx
                                ? "opacity-100 ring-1 ring-primary border-primary"
                                : "opacity-50 hover:opacity-80 border-border"
                            }`}
                            onClick={(e) => {
                              e.stopPropagation()
                              onSetActiveImage(i, vi)
                            }}
                          >
                            <img src={img.url} alt={`v${vi + 1}`} className="w-full h-full object-cover" />
                          </button>
                          <button
                            type="button"
                            className="absolute -top-1 -right-1 w-3.5 h-3.5 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/ver:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleteConfirm({ sceneIndex: i, imageIndex: vi })
                            }}
                          >
                            <X className="w-2 h-2" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Extract references button */}
                  {activeImage && (
                    <button
                      type="button"
                      className="flex items-center gap-1 w-full h-6 px-2 text-[10px] font-medium rounded border border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors"
                      onClick={(e) => { e.stopPropagation(); setExtractModalScene(i) }}
                    >
                      <Scissors className="w-3 h-3" />
                      Extract References
                      {extractedReferences.filter((r) => r.sourceSceneIndex === i).length > 0 && (
                        <span className="ml-auto text-[9px] bg-purple-600 text-white rounded-full px-1.5">
                          {extractedReferences.filter((r) => r.sourceSceneIndex === i).length}
                        </span>
                      )}
                    </button>
                  )}

                  {/* Create Scene Node button */}
                  <button
                    type="button"
                    className="flex items-center gap-1 w-full h-6 px-2 text-[10px] font-medium rounded border border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                    onClick={(e) => { e.stopPropagation(); onCreateSceneNode(i) }}
                  >
                    <Clapperboard className="w-3 h-3" />
                    Create Scene Node
                  </button>

                  {/* Mood - editable (always visible, compact) */}
                  <input
                    type="text"
                    value={getSceneMoodDisplay(scene.mood)}
                    onChange={(e) => {
                      const val = e.target.value
                      onUpdateSceneField(i, "mood", val.includes(",") ? val.split(",").map((s) => s.trim()).filter(Boolean) : val)
                    }}
                    className="w-full text-[10px] italic text-muted-foreground bg-transparent border border-transparent hover:border-border focus:border-primary focus:outline-none rounded px-1.5 py-0.5"
                    placeholder="Mood (comma-separated)..."
                  />

                  {/* Section: Action */}
                  <div className="border-t border-border/20 pt-1.5">
                    <div className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                      <Pen className="w-3 h-3" />Action
                    </div>
                    <textarea
                      value={scene.action}
                      onChange={(e) => onUpdateSceneField(i, "action", e.target.value)}
                      rows={2}
                      className="w-full text-xs font-medium bg-transparent border border-transparent hover:border-border focus:border-primary focus:outline-none rounded px-1.5 py-1 resize-y"
                      placeholder="Action..."
                    />
                  </div>

                  {/* Section: Visual Description */}
                  <div className="border-t border-border/20 pt-1.5">
                    <div className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                      <Eye className="w-3 h-3" />Visual Description
                    </div>
                    <textarea
                      value={scene.visualDescription}
                      onChange={(e) => onUpdateSceneField(i, "visualDescription", e.target.value)}
                      rows={3}
                      className="w-full text-[10px] text-muted-foreground/70 bg-transparent border border-transparent hover:border-border focus:border-primary focus:outline-none rounded px-1.5 py-1 resize-y"
                      placeholder="Visual description..."
                    />
                  </div>

                  {/* Section: Dialogue */}
                  <div className="border-t border-border/20 pt-1.5">
                    <div className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                      <MessageSquare className="w-3 h-3" />
                      Dialogue
                      {(scene.dialogue ?? []).length > 0 && (
                        <span className="text-[9px] font-normal normal-case tracking-normal text-muted-foreground/60">
                          ({(scene.dialogue ?? []).length})
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      {(scene.dialogue ?? []).map((d, di) => (
                        <div key={di} className="flex flex-col gap-0.5 pl-1 border-l-2 border-purple-500/30">
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={d.speaker}
                              onChange={(e) => {
                                const newDialogue = [...(scene.dialogue ?? [])]
                                newDialogue[di] = { ...newDialogue[di], speaker: e.target.value }
                                onUpdateSceneField(i, "dialogue", newDialogue)
                              }}
                              className="flex-1 text-[10px] font-medium bg-transparent border border-transparent hover:border-border focus:border-primary focus:outline-none rounded px-1 py-0.5"
                              placeholder="Speaker"
                            />
                            <input
                              type="text"
                              value={d.emotion ?? ""}
                              onChange={(e) => {
                                const newDialogue = [...(scene.dialogue ?? [])]
                                newDialogue[di] = { ...newDialogue[di], emotion: e.target.value || undefined }
                                onUpdateSceneField(i, "dialogue", newDialogue)
                              }}
                              className="w-16 text-[10px] italic text-muted-foreground bg-transparent border border-transparent hover:border-border focus:border-primary focus:outline-none rounded px-1 py-0.5"
                              placeholder="emotion"
                            />
                            <button
                              type="button"
                              className="text-muted-foreground/40 hover:text-red-500 transition-colors"
                              onClick={() => {
                                const newDialogue = (scene.dialogue ?? []).filter((_, j) => j !== di)
                                onUpdateSceneField(i, "dialogue", newDialogue)
                              }}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                          <input
                            type="text"
                            value={d.text}
                            onChange={(e) => {
                              const newDialogue = [...(scene.dialogue ?? [])]
                              newDialogue[di] = { ...newDialogue[di], text: e.target.value }
                              onUpdateSceneField(i, "dialogue", newDialogue)
                            }}
                            className="w-full text-[10px] text-muted-foreground bg-transparent border border-transparent hover:border-border focus:border-primary focus:outline-none rounded px-1 py-0.5"
                            placeholder="Line..."
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const newDialogue = [...(scene.dialogue ?? []), { speaker: "", text: "", emotion: "" }]
                          onUpdateSceneField(i, "dialogue", newDialogue)
                        }}
                        className="flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-foreground transition-colors self-start px-1"
                      >
                        <Plus className="w-2.5 h-2.5" /> Add line
                      </button>
                    </div>
                  </div>

                  {/* Section: Characters */}
                  <div className="border-t border-border/20 pt-1.5">
                    <div className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                      <Users className="w-3 h-3" />
                      Characters
                      {charNames.length > 0 && (
                        <span className="text-[9px] font-normal normal-case tracking-normal text-muted-foreground/60">
                          ({charNames.length})
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {charNames.map((char) => {
                        const otherScenes = (charSceneMap[char] ?? []).filter((n) => n !== scene.sceneNumber)
                        const matchingDef = allCharDefs.find((d) => d.name === char)
                        const isDescOnly = matchingDef?.type === "description" && !matchingDef.referenceImageUrl
                        const hasRef = matchingDef?.type === "reference" || !!matchingDef?.referenceImageUrl
                        return (
                          <span
                            key={char}
                            className="inline-flex items-center gap-1 h-6 px-2.5 text-xs font-medium rounded-full bg-purple-600 text-white"
                            title={isDescOnly ? "Description only - needs reference image" : hasRef ? "Has reference image" : undefined}
                          >
                            {isDescOnly && <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />}
                            {hasRef && <ImageIcon className="w-3 h-3 text-blue-200" />}
                            {matchingDef ? (
                              <button type="button" className="hover:underline" onClick={(e) => { e.stopPropagation(); setEditingCharDef(matchingDef); setShowDefineCharModal(true) }}>{char}</button>
                            ) : char}
                            {otherScenes.length > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-purple-200" title={`Also in scene${otherScenes.length > 1 ? "s" : ""} ${otherScenes.join(", ")}`}>
                                <Link className="w-2.5 h-2.5" />
                                <span className="text-[9px]">{otherScenes.length}</span>
                              </span>
                            )}
                            <button
                              type="button"
                              className="hover:text-red-300 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation()
                                onUpdateSceneCharacters(i, charNames.filter((c) => c !== char))
                              }}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        )
                      })}
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Search characters..."
                          className="h-6 w-28 px-2 text-xs rounded-full border border-muted-foreground/30 bg-muted/40 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30 placeholder:text-muted-foreground/50"
                          value={characterInput[i] ?? ""}
                          onChange={(e) => setCharacterInput({ ...characterInput, [i]: e.target.value })}
                          onFocus={() => setFocusedCharInput(i)}
                          onBlur={() => setTimeout(() => setFocusedCharInput(null), 150)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault()
                              setFocusedCharInput(null)
                              ;(e.target as HTMLInputElement).blur()
                            } else if (e.key === "Enter") {
                              e.preventDefault()
                              const val = (characterInput[i] ?? "").trim()
                              const isDefined = allCharDefs.some((d) => d.name === val) || extractedReferences.some((r) => r.name === val)
                              if (val && isDefined && !charNames.includes(val)) {
                                onUpdateSceneCharacters(i, [...charNames, val])
                              }
                              setCharacterInput({ ...characterInput, [i]: "" })
                              if (val === "" || !isDefined) {
                                setFocusedCharInput(null)
                                ;(e.target as HTMLInputElement).blur()
                              }
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        {focusedCharInput === i && (() => {
                          const sceneChars = new Set(charNames)
                          const inputVal = (characterInput[i] ?? "").toLowerCase()
                          const suggestions = allCharacters.filter(
                            (c) => !sceneChars.has(c) && (inputVal === "" || c.toLowerCase().includes(inputVal))
                          )
                          if (suggestions.length === 0 && !inputVal) return null
                          return (
                            <div className="absolute top-full left-0 mt-1 w-44 max-h-28 overflow-y-auto rounded-md border bg-popover shadow-md z-30">
                              {suggestions.map((char) => (
                                <button
                                  key={char}
                                  type="button"
                                  className="w-full text-left px-2 py-1 text-xs hover:bg-muted transition-colors flex items-center justify-between"
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    onUpdateSceneCharacters(i, [...charNames, char])
                                    setCharacterInput({ ...characterInput, [i]: "" })
                                  }}
                                >
                                  <span className="flex items-center gap-1">
                                    {extractedReferences.some((r) => r.name === char) && (
                                      <Scissors className="w-2.5 h-2.5 text-primary" />
                                    )}
                                    {(() => {
                                      const def = allCharDefs.find((d) => d.name === char)
                                      if (def?.type === "description" && !def.referenceImageUrl) {
                                        return <span title="Description only - needs reference"><FileText className="w-2.5 h-2.5 text-orange-500" /></span>
                                      }
                                      if (def?.type === "reference" || def?.referenceImageUrl) {
                                        return <span title="Has reference image"><ImageIcon className="w-2.5 h-2.5 text-blue-500" /></span>
                                      }
                                      return null
                                    })()}
                                    {char}
                                  </span>
                                  <span className="text-[9px] text-muted-foreground">
                                    {(charSceneMap[char] ?? []).length} scene{(charSceneMap[char] ?? []).length !== 1 ? "s" : ""}
                                  </span>
                                </button>
                              ))}
                              {suggestions.length === 0 && inputVal && (
                                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                  No character found.{" "}
                                  <button
                                    type="button"
                                    className="text-primary hover:underline"
                                    onMouseDown={(e) => {
                                      e.preventDefault()
                                      setCharacterInput({ ...characterInput, [i]: "" })
                                      setShowDefineCharModal(true)
                                    }}
                                  >
                                    Define new
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      {i === 0 && (
                        <p className="text-[9px] text-muted-foreground/60">
                          Tip: Use the same name across scenes for a consistent look
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setShowDefineCharModal(true) }}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] rounded border border-dashed hover:bg-muted transition-colors text-muted-foreground whitespace-nowrap"
                      >
                        <UserPlus className="w-2.5 h-2.5" /> Define character
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setShowManageCharModal(true) }}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] rounded border border-dashed hover:bg-muted transition-colors text-muted-foreground whitespace-nowrap"
                      >
                        <Download className="w-2.5 h-2.5" /> Import Assets
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 mt-auto pt-1 border-t border-border/30">
                    <span className="flex items-center gap-0.5"><ImageIcon className="w-2.5 h-2.5" />5cr</span>
                    <span className="flex items-center gap-0.5"><Film className="w-2.5 h-2.5" />20cr</span>
                    <span className="flex items-center gap-0.5">3cr</span>
                  </div>
                </div>
                </SortableSceneCard>
              )
            })}
            {/* Add Scene card */}
            <button
              type="button"
              onClick={() => handleAddScene()}
              className="rounded-lg border-2 border-dashed border-muted-foreground/20 p-3 flex flex-col items-center justify-center gap-2 min-h-[200px] hover:border-primary/40 hover:bg-muted/10 transition-colors cursor-pointer"
            >
              <Plus className="w-6 h-6 text-muted-foreground/40" />
              <span className="text-xs text-muted-foreground/60">Add Scene</span>
            </button>
          </div>
          </SortableContext>
          </DndContext>
        </div>
      </div>
      {extractModalScene !== null && (() => {
        const scene = script.scenes[extractModalScene]
        const images = scene?.generatedImages ?? []
        const activeIdx = scene?.activeImageIndex ?? 0
        const activeImg = images[activeIdx]
        if (!activeImg) return null
        return (
          <ExtractReferencesModal
            isOpen
            onClose={() => { setExtractModalScene(null); setExtractAutoOpened(false) }}
            imageUrl={activeImg.url}
            sceneIndex={extractModalScene}
            sceneCharacters={getSceneCharacterNames(scene?.characters)}
            existingReferences={extractedReferences}
            onSave={(refs) => {
              onSaveReferences(refs)
              const currentDefs = useWorkflowStore.getState().characterDefinitions
              const { updateCharacterDefinition: upgradeChar, addCharacterDefinition: addDef } = useWorkflowStore.getState()
              for (const ref of refs) {
                if (!ref.imageUrl) continue
                if (ref.type === "character") {
                  // Upgrade matching description-only character definitions
                  const matchingDef = currentDefs.find((c) => c.name === ref.name && c.type === "description" && !c.referenceImageUrl)
                  if (matchingDef) {
                    upgradeChar(matchingDef.id, { referenceImageUrl: ref.imageUrl })
                  }
                } else {
                  // Add locations and objects to workflow store if not already present
                  const exists = currentDefs.some((c) => c.name === ref.name && c.category === ref.type)
                  if (!exists) {
                    addDef({
                      id: crypto.randomUUID(),
                      name: ref.name,
                      type: "reference",
                      category: ref.type,
                      referenceImageUrl: ref.imageUrl,
                    })
                  }
                }
              }
            }}
            suggestedMessage={extractAutoOpened ? "Save character references for consistent look in other scenes" : undefined}
          />
        )
      })()}
      <DefineCharacterModal
        isOpen={showDefineCharModal}
        onClose={() => { setShowDefineCharModal(false); setEditingCharDef(null) }}
        onSave={(char) => {
          if (editingCharDef) {
            updateCharacterDefinition(char.id, { name: char.name, type: char.type, referenceImageUrl: char.referenceImageUrl, description: char.description })
            setEditingCharDef(null)
          } else {
            addCharacterDefinition(char)
          }
        }}
        existingNames={allCharDefs.map((c) => c.name)}
        editingCharacter={editingCharDef}
      />
      <ImportAssetsModal
        isOpen={showManageCharModal}
        onClose={() => setShowManageCharModal(false)}
      />
      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm !== null) onDeleteImage(deleteConfirm.sceneIndex, deleteConfirm.imageIndex)
        }}
        title="Delete this image version?"
        description="This action cannot be undone. The generated image will be permanently removed."
      />
    </div>,
    document.body
  )
}

function SortableSceneCard({ id, disabled, children }: { readonly id: string; readonly disabled?: boolean; readonly children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  }
  return (
    <SortableDragContext.Provider value={{ listeners: listeners ?? {}, activatorRef: setActivatorNodeRef }}>
      <div ref={setNodeRef} style={style} {...attributes}>
        {children}
      </div>
    </SortableDragContext.Provider>
  )
}

const SortableDragContext = createContext<{
  listeners: Record<string, unknown>
  activatorRef: (node: HTMLElement | null) => void
}>({ listeners: {}, activatorRef: () => {} })

function DragHandle() {
  const { listeners, activatorRef } = useContext(SortableDragContext)
  return (
    <span ref={activatorRef} {...listeners} className="cursor-grab active:cursor-grabbing">
      <GripVertical className="w-3 h-3 text-muted-foreground/30" />
    </span>
  )
}
