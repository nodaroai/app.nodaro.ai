"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { MessageSquare, Type, Loader2, AlertCircle, X, FileText, Copy, Download, BookOpen, AlignLeft } from "lucide-react"
import { computeDeleteResultUpdates, copyToClipboard, downloadTextFile } from "@/lib/utils"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credits"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS } from "@nodaro-shared/llm-models"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import type { LLMChatData } from "@/types/nodes"

function LLMChatNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as LLMChatData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeText = activeResult?.text ?? nodeData.generatedText
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const credits = useModelCredits(buildLlmCreditIdentifier("llm-chat", nodeData.llmModel || LLM_FEATURE_DEFAULTS["llm-chat"]), 3)

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedText", "text"))
  }

  return (
    <div className="relative" style={{ maxWidth: '280px' }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<MessageSquare className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<MessageSquare className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        minWidth={260}
        minHeight={180}
        hideHeader
        topToolbarContent={
          <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
        }
        handles={[
          { id: "prompt", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
          { id: "references", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 50px)', left: '-29px' }, hideHandle: true },
          { id: "system-prompt", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 80px)', left: '-29px' }, hideHandle: true },
          { id: "text", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
        ]}
      >
        <div className="flex flex-col gap-1 h-full">
          {status === "running" && !activeText && (
            <div className="flex items-center justify-center h-12 rounded-md bg-muted/30">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {activeText && (
            <div className="relative group flex-1 flex flex-col">
              <div className="w-full rounded-md bg-muted/20 p-3 flex-1 flex flex-col">
                <div className="overflow-y-auto flex-1 pr-1" style={{ maxHeight: '200px' }}>
                  <p className="text-sm text-foreground/85 whitespace-pre-wrap leading-relaxed">
                    {activeText.length > 80 ? `${activeText.slice(0, 80)}...` : activeText}
                  </p>
                </div>
              </div>
              {status === "running" && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
              <div className="absolute -top-1 -right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  aria-label="Copy text"
                  className="w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded"
                  onClick={(e) => {
                    e.stopPropagation()
                    copyToClipboard(activeText ?? "", "Text copied")
                  }}
                >
                  <Copy className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  aria-label="Download"
                  className="w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded"
                  onClick={(e) => {
                    e.stopPropagation()
                    downloadTextFile(activeText ?? "", `${nodeData.label || "llm-chat"}.txt`)
                  }}
                >
                  <Download className="w-3 h-3" />
                </button>
                {results.length > 0 && (
                  <button
                    type="button"
                    aria-label="Remove"
                    className="w-5 h-5 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full"
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
            <div className="flex items-center justify-center py-6 text-muted-foreground/40">
              <span className="text-xs">No output yet</span>
            </div>
          )}

          {results.length > 1 && (
            <div className="flex gap-1 overflow-x-auto">
              {results.slice(0, 5).map((r, i) => (
                <div key={`result-${i}`} className="relative group/thumb shrink-0">
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
                    <FileText className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove"
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

          {activeText && (
            <div className="flex items-center gap-1 px-1 pt-1">
              <span className="text-[10px] text-muted-foreground/50">{nodeData.llmModel || "default"}</span>
            </div>
          )}
        </div>
      </BaseNode>
      {/* Input handle icons */}
      <HandleIcon icon={<Type />} color="pink" side="left" top="calc(100% - 20px)" label="prompt" />
      <HandleIcon icon={<BookOpen />} color="pink" side="left" top="calc(100% - 50px)" label="refs" />
      <HandleIcon icon={<AlignLeft />} color="pink" side="left" top="calc(100% - 80px)" label="system" />
      {/* Output handle icon */}
      <HandleIcon icon={<Type />} color="pink" side="right" top="20px" />
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

export const LLMChatNode = memo(LLMChatNodeComponent)
