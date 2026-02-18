"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { FileText, Loader2, AlertCircle, X } from "lucide-react"
import { createPortal } from "react-dom"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/hooks/use-model-credits"
import type { TranscribeData } from "@/types/nodes"

function TranscriptPreviewModal({
  isOpen,
  onClose,
  text,
  language,
}: {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly text: string
  readonly language: string
}) {
  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[80vh] bg-background rounded-lg border border-border shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Transcript</span>
            {language && language !== "auto" && language !== "unknown" && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                {language}
              </span>
            )}
          </div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={onClose}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{text}</p>
        </div>
      </div>
    </div>,
    document.body
  )
}

function TranscribeNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as TranscribeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeText = activeResult?.text ?? nodeData.generatedText
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const credits = useModelCredits(nodeData.provider ?? "whisper", 1)

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
      generatedText: newResults[newActiveIndex]?.text,
    })
  }

  const truncatedText = activeText && activeText.length > 100
    ? `${activeText.substring(0, 100)}...`
    : activeText

  return (
    <>
      <div className="relative group/run">
        <BaseNode
          id={id}
          label={nodeData.label}
          icon={<FileText className="h-4 w-4" />}
          category="ai"
          credits={credits}
          selected={selected}
          isRunning={status === "running"}
          handles={[
            { id: "in", type: "target", position: Position.Left, label: "Input" },
            { id: "text", type: "source", position: Position.Right, label: "Text" },
          ]}
        >
          <div className="flex flex-col gap-1">
            {status === "running" && !activeText && (
              <div className="flex items-center justify-center h-12 rounded-md bg-muted/30">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {activeText && (
              <div className="relative group">
                <div
                  className="w-full rounded-md bg-muted/30 p-2 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPreviewOpen(true)
                  }}
                >
                  <p className="text-xs text-foreground/80 line-clamp-3">
                    {truncatedText}
                  </p>
                  {activeText.length > 100 && (
                    <span className="text-[10px] text-muted-foreground mt-1 block">
                      Click to expand
                    </span>
                  )}
                </div>
                {status === "running" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                {results.length > 0 && (
                  <button
                    type="button"
                    className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
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
            )}

            {status === "failed" && !activeText && (
              <div className="flex flex-col items-center justify-center gap-1 h-12 rounded-md bg-red-500/5 text-red-500 p-2">
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="font-medium">Failed</span>
                </div>
                {nodeData.errorMessage && (
                  <p className="text-[10px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>
                    {nodeData.errorMessage}
                  </p>
                )}
              </div>
            )}

            {status !== "running" && !activeText && status !== "failed" && (
              <div className="flex items-center justify-center h-12 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
                <FileText className="w-5 h-5" />
              </div>
            )}

            {results.length > 1 && (
              <div className="flex gap-1 overflow-x-auto">
                {results.slice(0, 5).map((r, i) => (
                  <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                    <button
                      type="button"
                      className={`w-8 h-8 flex items-center justify-center rounded cursor-pointer transition-opacity ${
                        i === activeIndex
                          ? "opacity-100 ring-2 ring-primary bg-primary/20"
                          : "opacity-50 hover:opacity-80 bg-muted"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation()
                        updateNodeData(id, { activeResultIndex: i, generatedText: r.text })
                      }}
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove" className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
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
              <span>{nodeData.provider || "whisper"}</span>
              <span>{nodeData.language || "auto"}</span>
            </div>
          </div>
        </BaseNode>
        <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
        <DeleteConfirmationDialog
          isOpen={deleteConfirm !== null}
          onClose={() => setDeleteConfirm(null)}
          onConfirm={() => {
            if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
          }}
        />
      </div>
      <TranscriptPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        text={activeText ?? ""}
        language={activeResult?.language ?? ""}
      />
    </>
  )
}

export const TranscribeNode = memo(TranscribeNodeComponent)
