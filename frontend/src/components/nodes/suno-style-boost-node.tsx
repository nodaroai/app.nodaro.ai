"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Sparkles, Loader2, AlertCircle, Type, Copy, X } from "lucide-react"
import { copyToClipboard } from "@/lib/utils"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { NodeQuickStrip } from "./node-quick-strip"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { isValidSunoStyleBoostConnection } from "@/lib/audio-text-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import type { SunoStyleBoostData } from "@/types/nodes"

const isVisualPicker = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_PROMPT = (t: string) => isValidSunoStyleBoostConnection("prompt", t, isVisualPicker)

function SunoStyleBoostNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SunoStyleBoostData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const generatedText = nodeData.generatedText
  const credits = useModelCredits("suno-style-boost", 1)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Sparkles className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Sparkles className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      hideHeader
      topToolbarContent={
        <NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} />
      }
      handles={[
        { id: "prompt", type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
        { id: "text",   type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
      ]}
    >
      <div className="flex flex-col gap-2 p-3" style={{ minHeight: 180 }}>
        {status === "running" && !generatedText && (
          <div className="flex flex-col items-center justify-center gap-2 h-12 rounded-md bg-muted/30">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <NodeJobProgress progress={nodeData.currentJobProgress} />
          </div>
        )}

        {generatedText && (
          <div className="relative group">
            <div className="px-3 py-2 text-xs text-foreground bg-muted/30 rounded-md max-h-32 overflow-y-auto whitespace-pre-wrap">
              {generatedText}
            </div>
            <div className="absolute -top-1 -right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                aria-label="Copy text"
                className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  copyToClipboard(generatedText, "Text copied")
                }}
              >
                <Copy className="w-3 h-3" />
              </button>
              <button
                type="button"
                aria-label="Delete result"
                className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleteConfirm(true)
                }}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {status === "failed" && !generatedText && (
          <div className="flex flex-col items-center justify-center gap-1 h-12 rounded-md bg-red-500/5 text-red-500 p-2">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="font-medium">Failed</span>
            </div>
            {nodeData.errorMessage && (
              <p className="text-[10px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>{nodeData.errorMessage}</p>
            )}
          </div>
        )}

        {status !== "running" && !generatedText && status !== "failed" && (
          <div className="flex items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40" style={{ minHeight: 120, flex: 1 }}>
            <Sparkles className="w-5 h-5" />
          </div>
        )}

        <span className="text-xs text-muted-foreground">Style Boost</span>
      </div>
    </BaseNode>
    <HandleWithPopover nodeId={id} nodeType="suno-style-boost" handleId="prompt" type="target" position={Position.Left}  label="Prompt" color={TEXT_HANDLE_COLOR} icon={<Type />}      side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_PROMPT} />
    <HandleWithPopover nodeId={id} nodeType="suno-style-boost" handleId="text"   type="source" position={Position.Right} label="Text"   color={TEXT_HANDLE_COLOR} icon={<Sparkles />} side="right" top="24px" />
    <DeleteConfirmationDialog
      isOpen={deleteConfirm}
      onClose={() => setDeleteConfirm(false)}
      onConfirm={() => {
        updateNodeData(id, { generatedText: undefined, executionStatus: "idle" })
      }}
    />
    </div>
  )
}

export const SunoStyleBoostNode = memo(SunoStyleBoostNodeComponent)
