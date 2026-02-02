"use client"

import { useEffect, useCallback, useState } from "react"
import { createPortal } from "react-dom"
import { X, ImageIcon, Film, Sparkles, Play, Loader2, AlertCircle, RotateCcw, Layers, Info, Link, Scissors } from "lucide-react"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { ExtractReferencesModal } from "./extract-references-modal"
import type { GeneratedScript, ExtractedReference } from "@/types/nodes"

interface ScriptPreviewModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly script: GeneratedScript
  readonly onGenerateScene: (sceneIndex: number) => Promise<void>
  readonly onSetActiveImage: (sceneIndex: number, imageIndex: number) => void
  readonly onDeleteImage: (sceneIndex: number, imageIndex: number) => void
  readonly onExpandToNodes: () => void
  readonly onUpdateSceneCharacters: (sceneIndex: number, characters: string[]) => void
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
  extractedReferences,
  onSaveReferences,
}: ScriptPreviewModalProps) {
  const [generatingAll, setGeneratingAll] = useState(false)
  const [extractModalScene, setExtractModalScene] = useState<number | null>(null)
  const [characterInput, setCharacterInput] = useState<Record<number, string>>({})
  const [allProgress, setAllProgress] = useState({ current: 0, total: 0 })
  const [deleteConfirm, setDeleteConfirm] = useState<{ sceneIndex: number; imageIndex: number } | null>(null)
  const [focusedCharInput, setFocusedCharInput] = useState<number | null>(null)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose()
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, handleKeyDown])

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
    for (const char of scene.characters ?? []) {
      const arr = charSceneMap[char] ?? []
      arr.push(scene.sceneNumber)
      charSceneMap[char] = arr
    }
  }
  const allCharacters = Object.keys(charSceneMap)

  async function handleGenerateAll() {
    setGeneratingAll(true)
    setAllProgress({ current: 0, total: pendingCount })
    let completed = 0

    for (let i = 0; i < script.scenes.length; i++) {
      const scene = script.scenes[i]
      const images = scene.generatedImages ?? []
      if (images.length > 0 || scene.imageStatus === "running") continue

      try {
        await onGenerateScene(i)
      } catch {
        // Continue to next scene on failure
      }
      completed += 1
      setAllProgress({ current: completed, total: pendingCount })
    }

    setGeneratingAll(false)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div
        className="relative bg-card rounded-xl shadow-2xl max-w-[90vw] max-h-[85vh] flex flex-col overflow-hidden"
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {script.scenes.map((scene, i) => {
              const status = scene.imageStatus ?? "idle"
              const images = scene.generatedImages ?? []
              const activeIdx = scene.activeImageIndex ?? 0
              const activeImage = images[activeIdx]

              return (
                <div
                  key={scene.sceneNumber}
                  className={`rounded-lg border p-3 flex flex-col gap-2 group/scene ${
                    status === "failed"
                      ? "border-red-500/50 bg-red-500/5"
                      : "bg-muted/20"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Scene {scene.sceneNumber}
                    </span>
                    <span className="text-xs text-muted-foreground">{scene.durationHint}s</span>
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
                            onGenerateScene(i)
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

                  <p className="text-xs font-medium line-clamp-2">{scene.action}</p>
                  <p className="text-[10px] text-muted-foreground italic">{scene.mood}</p>
                  <p className="text-[10px] text-muted-foreground/70 line-clamp-3">{scene.visualDescription}</p>

                  {/* Character tags */}
                  <div className="mt-2 pt-2 border-t border-border/20">
                    <div className="flex items-center gap-1 group/charhelp">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Characters</span>
                      <div className="relative">
                        <Info className="w-3 h-3 text-muted-foreground/40 cursor-help" />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 p-2 rounded-md bg-popover border text-[10px] text-popover-foreground shadow-md opacity-0 pointer-events-none group-hover/charhelp:opacity-100 transition-opacity z-20">
                          Tag characters in this scene. Using the same name across scenes keeps their appearance consistent.
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {(scene.characters ?? []).map((char) => {
                        const otherScenes = (charSceneMap[char] ?? []).filter((n) => n !== scene.sceneNumber)
                        return (
                          <span
                            key={char}
                            className="inline-flex items-center gap-1 h-6 px-2.5 text-xs font-medium rounded-full bg-purple-600 text-white"
                          >
                            {char}
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
                                onUpdateSceneCharacters(i, (scene.characters ?? []).filter((c) => c !== char))
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
                          placeholder="e.g. Hero, Dragon"
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
                              if (val && !(scene.characters ?? []).includes(val)) {
                                onUpdateSceneCharacters(i, [...(scene.characters ?? []), val])
                              }
                              setCharacterInput({ ...characterInput, [i]: "" })
                              if (val === "") {
                                setFocusedCharInput(null)
                                ;(e.target as HTMLInputElement).blur()
                              }
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        {focusedCharInput === i && (() => {
                          const sceneChars = new Set(scene.characters ?? [])
                          const inputVal = (characterInput[i] ?? "").toLowerCase()
                          const suggestions = allCharacters.filter(
                            (c) => !sceneChars.has(c) && (inputVal === "" || c.toLowerCase().includes(inputVal))
                          )
                          if (suggestions.length === 0) return null
                          return (
                            <div className="absolute top-full left-0 mt-1 w-36 max-h-28 overflow-y-auto rounded-md border bg-popover shadow-md z-30">
                              {suggestions.map((char) => (
                                <button
                                  key={char}
                                  type="button"
                                  className="w-full text-left px-2 py-1 text-xs hover:bg-muted transition-colors flex items-center justify-between"
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    onUpdateSceneCharacters(i, [...(scene.characters ?? []), char])
                                    setCharacterInput({ ...characterInput, [i]: "" })
                                  }}
                                >
                                  <span>{char}</span>
                                  <span className="text-[9px] text-muted-foreground">
                                    {(charSceneMap[char] ?? []).length} scene{(charSceneMap[char] ?? []).length !== 1 ? "s" : ""}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )
                        })()}
                      </div>
                    </div>
                    {i === 0 && (
                      <p className="text-[9px] text-muted-foreground/60 mt-1.5">
                        Tip: Use the same name across scenes for a consistent look
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 mt-auto pt-1 border-t border-border/30">
                    <span className="flex items-center gap-0.5"><ImageIcon className="w-2.5 h-2.5" />5cr</span>
                    <span className="flex items-center gap-0.5"><Film className="w-2.5 h-2.5" />20cr</span>
                    <span className="flex items-center gap-0.5">3cr</span>
                  </div>
                </div>
              )
            })}
          </div>
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
            onClose={() => setExtractModalScene(null)}
            imageUrl={activeImg.url}
            sceneIndex={extractModalScene}
            sceneCharacters={scene.characters ?? []}
            existingReferences={extractedReferences}
            onSave={onSaveReferences}
          />
        )
      })()}
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
