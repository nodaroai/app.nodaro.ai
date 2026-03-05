"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Eye, Type, Loader2, AlertCircle, X, ImageIcon } from "lucide-react"
import { createPortal } from "react-dom"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useConnectionCount } from "@/hooks/use-connection-count"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { EditableNodeLabel } from "./editable-node-label"
import type { ImageToTextData } from "@/types/nodes"

function TextPreviewModal({
  isOpen,
  onClose,
  text,
}: {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly text: string
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
            <Eye className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Describe Image</span>
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

function ImageToTextNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageToTextData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const inConnectionCount = useConnectionCount(id, "image")
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeText = activeResult?.text ?? nodeData.generatedText
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

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
    <div className="relative" style={{ contain: 'inline-size' }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Eye className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Eye className="h-4 w-4" />}
      category="ai"
      credits={1}
      selected={selected}
      isRunning={status === "running"}
      hideHeader
      topToolbarContent={
        status !== "running" ? (
          <RunNodeButton nodeId={id} credits={1} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
        ) : undefined
      }
      handles={[
        { id: "image", type: "target", position: Position.Left, top: "calc(75% + 33px)", customStyle: { top: 'calc(75% + 33px)', left: '-29px' }, hideHandle: true },
        { id: "text", type: "source", position: Position.Right, top: "25%", customStyle: { top: '25%', right: '-29px' }, hideHandle: true },
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
                aria-label="Remove" className="absolute -top-1 -right-1 w-6 h-6 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
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
            <Eye className="w-5 h-5" />
          </div>
        )}

        {results.length > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            {results.slice(0, 5).map((r, i) => (
              <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                <button
                  type="button"
                  aria-label={`Result ${i + 1}`}
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
                  <Eye className="w-4 h-4" />
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
      </div>
    </BaseNode>
    {/* Input handle icon (TYPE 1) */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
      style={{ top: 'calc(75% + 19px)', left: '-29px' }}
    >
      <ImageIcon className="w-3.5 h-3.5 text-white" />
      <div className="absolute top-1/2 -translate-y-1/2 -left-[9px] w-[12px] h-[12px] rounded-full bg-[#111827] border border-[#ff0073] text-[#ff0073] text-[8px] font-black flex items-center justify-center">+</div>
      {inConnectionCount >= 2 && (
        <div className="absolute top-1/2 -translate-y-1/2 -right-[9px] w-[13px] h-[13px] rounded-full bg-white text-[#ff0073] text-[8px] font-black flex items-center justify-center">
          {inConnectionCount}
        </div>
      )}
    </div>
    {/* Output handle icon */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30"
      style={{ top: 'calc(25% - 47px)', right: '-29px' }}
    >
      <Type className="w-3.5 h-3.5 text-white" />
    </div>
    <DeleteConfirmationDialog
      isOpen={deleteConfirm !== null}
      onClose={() => setDeleteConfirm(null)}
      onConfirm={() => {
        if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
      }}
    />
    <TextPreviewModal
      isOpen={previewOpen}
      onClose={() => setPreviewOpen(false)}
      text={activeText ?? ""}
    />
    </div>
  )
}

export const ImageToTextNode = memo(ImageToTextNodeComponent)
