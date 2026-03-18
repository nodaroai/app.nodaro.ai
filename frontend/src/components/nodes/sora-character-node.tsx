"use client"

import { memo, useState } from "react"
import { Position, type NodeProps, NodeResizer, Handle } from "@xyflow/react"
import { User, Loader2, AlertCircle, Video, Hash, Copy, Check } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credits"
import type { SoraCharacterData } from "@/types/nodes"

function SoraCharacterNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SoraCharacterData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const [copied, setCopied] = useState(false)
  const credits = useModelCredits("sora-character", 5)

  const modeBadge = nodeData.mode === "sora-task" ? "From Sora Task" : "From Video"
  const promptPreview = nodeData.characterPrompt
    ? nodeData.characterPrompt.length > 60
      ? nodeData.characterPrompt.slice(0, 60) + "…"
      : nodeData.characterPrompt
    : null

  function handleCopyCharacterId() {
    if (nodeData.generatedCharacterId) {
      navigator.clipboard.writeText(nodeData.generatedCharacterId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="relative" style={{ width: 220, minHeight: 220, overflow: "visible" }}>
      <NodeResizer
        isVisible={!!selected}
        minWidth={180}
        minHeight={180}
        lineClassName="!border-[#ff0073]"
        handleClassName="!w-2.5 !h-2.5 !bg-[#ff0073] !border-none !rounded-sm"
      />
      {/* Floating label above node */}
      <EditableNodeLabel
        label={nodeData.label}
        icon={<User className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<User className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        topToolbarContent={
          status !== "running" ? (
            <RunNodeButton nodeId={id} credits={credits} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
          ) : undefined
        }
        handles={[]}
      >
        <div className="flex flex-col gap-2 p-3" style={{ minHeight: 180 }}>
          {/* Mode badge */}
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-[10px] text-muted-foreground font-medium">
              <Video className="w-2.5 h-2.5" />
              {modeBadge}
            </span>
          </div>

          {/* Character prompt preview */}
          {promptPreview && (
            <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2" title={nodeData.characterPrompt}>
              {promptPreview}
            </p>
          )}

          {/* Running state */}
          {status === "running" && (
            <div className="flex items-center justify-center h-12 rounded-md bg-muted/30">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Generated character ID */}
          {nodeData.generatedCharacterId && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleCopyCharacterId() }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/50 text-[10px] text-muted-foreground hover:bg-muted transition-colors truncate"
              title={`Character ID: ${nodeData.generatedCharacterId}`}
            >
              {copied ? <Check className="w-2.5 h-2.5 shrink-0" /> : <Copy className="w-2.5 h-2.5 shrink-0" />}
              <span className="font-mono truncate">{nodeData.generatedCharacterId}</span>
            </button>
          )}

          {/* Failed state */}
          {status === "failed" && (
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

          {/* Idle empty state */}
          {status !== "running" && status !== "failed" && !nodeData.generatedCharacterId && (
            <div
              className="flex items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40"
              style={{ minHeight: 80, flex: 1 }}
            >
              <User className="w-5 h-5" />
            </div>
          )}

          <div className="flex justify-between text-muted-foreground">
            <span>Sora Character</span>
          </div>
        </div>
      </BaseNode>

      {/* Invisible input handle — video */}
      <Handle
        id="video"
        type="target"
        position={Position.Left}
        className="!w-7 !h-7 !bg-transparent !border-0 !opacity-0 touch-manipulation"
        style={{ top: "155px", left: "-29px", transform: "none" }}
      />
      {/* Invisible output handle — characterId */}
      <Handle
        id="characterId"
        type="source"
        position={Position.Right}
        className="!w-7 !h-7 !bg-transparent !border-0 !opacity-0 touch-manipulation"
        style={{ top: "50px", right: "-29px", transform: "none", left: "auto" }}
      />

      {/* Input handle icon */}
      <div
        className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30"
        style={{ top: "155px", left: "-29px" }}
      >
        <Video className="w-3.5 h-3.5 text-white" />
      </div>
      {/* Output handle icon */}
      <div
        className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30"
        style={{ top: "50px", right: "-29px" }}
      >
        <Hash className="w-3.5 h-3.5 text-white" />
      </div>
    </div>
  )
}

export const SoraCharacterNode = memo(SoraCharacterNodeComponent)
