"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Merge, FileText, X, Copy, Type } from "lucide-react"
import { createPortal } from "react-dom"
import { copyToClipboard } from "@/lib/utils"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { isValidCombineTextConnection } from "@/lib/audio-text-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useAutoExecute } from "@/hooks/use-auto-execute"
import type { CombineTextNodeData } from "@/types/nodes"

const isVisualPicker = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_TEXT = (t: string) => isValidCombineTextConnection("text", t, isVisualPicker)

const SEPARATOR_LABELS: Record<string, string> = {
  newline: "\\n",
  "double-newline": "\\n\\n",
  comma: ", ",
  space: "Space",
  custom: "Custom",
}

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
            <Merge className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Combined Text</span>
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

function CombineTextNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CombineTextNodeData
  const combinedText = nodeData.combinedText
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"
  const [previewOpen, setPreviewOpen] = useState(false)

  useAutoExecute(id, data as Record<string, unknown>)

  const lineCount = combinedText
    ? combinedText.split("\n").filter((l) => l.trim().length > 0).length
    : 0

  const separatorLabel = SEPARATOR_LABELS[nodeData.separator] ?? nodeData.separator

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Merge className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Merge className="h-4 w-4" />}
        category="processing"
        credits={0}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={220}
        topToolbarContent={
                      <RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runFromHere?.(nid)} runFromHere />
        }
        handles={[
          { id: "text", type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
          { id: "text", type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
        ]}
      >
        <div className="flex flex-col gap-1">
          {combinedText ? (
            <div className="relative group">
              <div
                className="w-full rounded-md bg-muted/30 p-2 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  setPreviewOpen(true)
                }}
              >
                <p className="text-xs text-foreground/80 line-clamp-3 break-words">
                  {lineCount} line{lineCount !== 1 ? "s" : ""} combined
                </p>
                <span className="text-[10px] text-muted-foreground mt-1 block">
                  Click to expand
                </span>
              </div>
              <div className="absolute -top-1 -right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  aria-label="Copy text"
                  className="w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded"
                  onClick={(e) => {
                    e.stopPropagation()
                    copyToClipboard(combinedText ?? "", "Text copied")
                  }}
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-12 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
              <FileText className="w-5 h-5" />
            </div>
          )}

          <div className="flex justify-between text-muted-foreground">
            <span>Separator: {separatorLabel}</span>
          </div>
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="combine-text" handleId="text" type="target" position={Position.Left}  label="Text" color={TEXT_HANDLE_COLOR} icon={<FileText />} side="left"  top="calc(100% - 24px)" orderMatters accepts={ACCEPTS_TEXT} />
      <HandleWithPopover nodeId={id} nodeType="combine-text" handleId="text" type="source" position={Position.Right} label="Text" color={TEXT_HANDLE_COLOR} icon={<Type />}     side="right" top="24px" />
      <TextPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        text={combinedText ?? ""}
      />
    </div>
  )
}

export const CombineTextNode = memo(CombineTextNodeComponent)
