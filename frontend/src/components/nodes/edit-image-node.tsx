"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Wand2, Loader2, AlertCircle, X, Play } from "lucide-react"
import { BaseNode } from "./base-node"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import type { EditImageData } from "@/types/nodes"

const PROVIDER_LABELS: Record<string, string> = {
  "recraft-upscale": "Upscale",
  "recraft-remove-bg": "Remove BG",
  "nano-banana-edit": "Edit",
}

function EditImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as EditImageData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const rawUrl = activeResult?.url ?? nodeData.generatedImageUrl
  const activeUrl = rawUrl && rawUrl.trim() ? rawUrl : undefined
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  function handleDeleteResult(indexToDelete: number) {
    const newResults = results.filter((_, i) => i !== indexToDelete)
    let newActiveIndex = activeIndex
    if (indexToDelete === activeIndex) {
      newActiveIndex = 0
    } else if (indexToDelete < activeIndex) {
      newActiveIndex = activeIndex - 1
    }
    updateNodeData(id, {
      generatedResults: newResults,
      activeResultIndex: newActiveIndex,
      generatedImageUrl: newResults[newActiveIndex]?.url,
    })
  }

  const providerLabel = PROVIDER_LABELS[nodeData.provider] ?? nodeData.provider

  return (
    <div className="relative group/run">
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Wand2 className="h-4 w-4" />}
        category="ai"
        credits={3}
        selected={selected}
        isRunning={status === "running"}
        handles={[
          { id: "image", type: "target", position: Position.Left, label: "Image" },
          { id: "out", type: "source", position: Position.Right, label: "Output" },
        ]}
      >
        <div className="flex flex-col gap-1">
          {status === "running" && (
            <div className="flex items-center justify-center h-28 rounded-md bg-muted/30">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {status !== "running" && activeUrl && (
            <div className="relative group">
              <img
                src={activeUrl}
                alt="Edited"
                className="w-full h-28 object-cover rounded-md cursor-pointer hover:opacity-90 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  setPreviewOpen(true)
                }}
              />
              <div className="absolute top-1 right-1 flex gap-1">
                {results.length > 0 && (
                  <button
                    type="button"
                    className="w-5 h-5 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteConfirm(activeIndex)
                    }}
                    title="Delete this result"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <SaveToLibraryButton url={activeUrl} type="image" />
              </div>
            </div>
          )}

          {status === "failed" && !activeUrl && (
            <div className="flex flex-col items-center justify-center gap-1 h-28 rounded-md bg-red-500/5 text-red-500 p-2">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-medium">Failed</span>
              </div>
              {nodeData.errorMessage && (
                <p className="text-[10px] text-center text-red-400 line-clamp-2" title={nodeData.errorMessage}>
                  {nodeData.errorMessage}
                </p>
              )}
            </div>
          )}

          {status !== "running" && !activeUrl && status !== "failed" && (
            <div className="flex items-center justify-center h-28 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
              <Wand2 className="w-6 h-6" />
            </div>
          )}

          {results.length > 1 && (
            <div className="flex gap-1 overflow-x-auto">
              {results.slice(0, 5).map((r, i) => (
                <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                  <img
                    src={r.url}
                    alt={`Result ${i + 1}`}
                    className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${
                      i === activeIndex
                        ? "opacity-100 ring-2 ring-primary"
                        : "opacity-50 hover:opacity-80"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      updateNodeData(id, { activeResultIndex: i, generatedImageUrl: r.url })
                    }}
                  />
                  <button
                    type="button"
                    className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteConfirm(i)
                    }}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-between text-muted-foreground">
            <span>{providerLabel}</span>
          </div>
        </div>
      </BaseNode>
      {status !== "running" && (
        <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 z-10 opacity-0 group-hover/run:opacity-100 transition-opacity">
          <button
            type="button"
            className="flex items-center gap-1 h-6 px-3 text-[11px] font-medium text-white rounded-b-md shadow-md transition-colors"
            style={{ backgroundColor: "#ff0073" }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#e60068")}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#ff0073")}
            onClick={(e) => {
              e.stopPropagation()
              runSingleNode?.(id)
            }}
            title="Run this node only"
          >
            <Play className="w-3 h-3" />
            Run
          </button>
        </div>
      )}
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
    </div>
  )
}

export const EditImageNode = memo(EditImageNodeComponent)
