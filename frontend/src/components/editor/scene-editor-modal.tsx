"use client"

import { useEffect, useCallback, useState } from "react"
import { createPortal } from "react-dom"
import { X, Play, Loader2, AlertCircle, Eye } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { SceneConfig } from "./scene-config"
import { buildScenePrompt } from "@/lib/prompt-builder"
import { MediaPreviewModal } from "./media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import type { SceneNodeDataType } from "@/types/nodes"

interface SceneEditorModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly nodeId: string
}

export function SceneEditorModal({ isOpen, onClose, nodeId }: SceneEditorModalProps) {
  const nodes = useWorkflowStore((s) => s.nodes)
  const allAssets = useWorkflowStore((s) => s.characterDefinitions)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)

  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const node = nodes.find((n) => n.id === nodeId)
  const data = node?.data as SceneNodeDataType | undefined

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose()
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, handleKeyDown])

  if (!isOpen || !data) return null

  const status = data.executionStatus ?? "idle"
  const results = data.generatedResults ?? []
  const activeIndex = data.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? data.generatedImageUrl
  const generatedPrompt = buildScenePrompt(data, allAssets)

  function handleUpdate(updates: Record<string, unknown>) {
    updateNodeData(nodeId, updates)
  }

  function handleDeleteResult(indexToDelete: number) {
    const newResults = results.filter((_, i) => i !== indexToDelete)
    let newActiveIndex = activeIndex
    if (indexToDelete === activeIndex) {
      newActiveIndex = 0
    } else if (indexToDelete < activeIndex) {
      newActiveIndex = activeIndex - 1
    }
    updateNodeData(nodeId, {
      generatedResults: newResults,
      activeResultIndex: newActiveIndex,
      generatedImageUrl: newResults[newActiveIndex]?.url ?? "",
    })
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="relative bg-background rounded-lg w-[90vw] h-[85vh] max-w-6xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <h2 className="text-sm font-semibold">
            {data.sceneName ? `Scene: ${data.sceneName}` : "Scene Editor"}
          </h2>
          <div className="flex items-center gap-2">
            {status !== "running" && (
              <button
                type="button"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-500 hover:bg-violet-600 text-white rounded-md transition-colors"
                onClick={() => runSingleNode?.(nodeId)}
              >
                <Play className="w-3.5 h-3.5" />
                Generate Image
              </button>
            )}
            <button
              type="button"
              className="p-1.5 hover:bg-muted rounded-md transition-colors"
              onClick={onClose}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body - side by side */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Image + Prompt Preview */}
          <div className="w-1/2 flex flex-col border-r overflow-y-auto">
            {/* Image area */}
            <div className="p-4 flex flex-col gap-3">
              {status === "running" && (
                <div className="flex items-center justify-center h-64 rounded-lg bg-muted/30">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              )}

              {status !== "running" && activeUrl && (
                <div className="relative group">
                  <img
                    src={activeUrl}
                    alt="Scene"
                    className="w-full rounded-lg object-contain max-h-[50vh] cursor-pointer hover:opacity-90 transition-opacity bg-muted/20"
                    onClick={() => setPreviewOpen(true)}
                  />
                  <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      className="p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-md"
                      onClick={() => setPreviewOpen(true)}
                      title="Full preview"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="p-1.5 bg-red-500/80 hover:bg-red-500 text-white rounded-md"
                      onClick={() => setDeleteConfirm(activeIndex)}
                      title="Delete this result"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {status === "failed" && !activeUrl && (
                <div className="flex items-center justify-center gap-2 h-48 rounded-lg bg-red-500/5 text-red-500">
                  <AlertCircle className="w-6 h-6" />
                  <span className="text-sm">Generation failed</span>
                </div>
              )}

              {status !== "running" && !activeUrl && status !== "failed" && (
                <div className="flex items-center justify-center h-48 rounded-lg border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
                  <span className="text-sm">No image generated yet</span>
                </div>
              )}

              {/* Version history */}
              {results.length > 1 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {results.map((r, i) => (
                    <div key={r.jobId} className="relative group/thumb shrink-0">
                      <img
                        src={r.url}
                        alt={`Result ${i + 1}`}
                        className={`w-14 h-14 object-cover rounded-md cursor-pointer transition-opacity ${
                          i === activeIndex
                            ? "opacity-100 ring-2 ring-primary"
                            : "opacity-50 hover:opacity-80"
                        }`}
                        onClick={() => updateNodeData(nodeId, { activeResultIndex: i, generatedImageUrl: r.url })}
                      />
                      <button
                        type="button"
                        className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                        onClick={() => setDeleteConfirm(i)}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Prompt Preview */}
            <div className="px-4 pb-4">
              <div className="rounded-lg border bg-muted/20 p-3">
                <h3 className="text-xs font-medium mb-1.5 text-muted-foreground">Generated Prompt</h3>
                <p className="text-xs leading-relaxed whitespace-pre-wrap">{generatedPrompt || "Configure scene settings to generate a prompt..."}</p>
              </div>
            </div>
          </div>

          {/* Right: All settings */}
          <div className="w-1/2 overflow-y-auto p-4">
            <SceneConfig data={data} onUpdate={handleUpdate} />
          </div>
        </div>
      </div>

      {activeUrl && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type="image"
          url={activeUrl}
        />
      )}
      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
        }}
      />
    </div>,
    document.body
  )
}
