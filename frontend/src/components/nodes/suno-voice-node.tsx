"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Mic, AlertCircle, Settings2, CheckCircle2, Loader2, User } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { Button } from "@/components/ui/button"
import { SunoVoiceSetupModal } from "./suno-voice-setup-modal"
import type { SunoVoiceData } from "@/types/nodes"

function SunoVoiceNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SunoVoiceData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const [modalOpen, setModalOpen] = useState(false)

  const status = nodeData.status ?? "idle"
  const ready = Boolean(nodeData.voiceId) && status === "success"
  const inProgress = status === "validating" || status === "wait_validating" || status === "generating"

  return (
    <div className="relative" style={{ maxWidth: "260px" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Mic className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Mic className="h-4 w-4" />}
        category="parameter"
        selected={selected}
        hideHeader
        handles={[
          { id: "voicePersona", type: "source", position: Position.Right, customStyle: { top: "calc(50% - 4px)", right: "-29px" }, external: true },
        ]}
      >
        <div className="flex flex-col gap-3 p-3" style={{ minHeight: 140 }}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Voice Persona</div>
              <div className="text-sm font-semibold truncate">
                {nodeData.voiceName?.trim() || (ready ? "Untitled voice" : "Not configured")}
              </div>
              {nodeData.style && ready && (
                <div className="text-[10px] text-muted-foreground truncate" title={nodeData.style}>
                  {nodeData.style}
                </div>
              )}
            </div>
            {ready && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-medium">
                <CheckCircle2 className="w-3 h-3" />
                Ready
              </div>
            )}
            {inProgress && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-medium">
                <Loader2 className="w-3 h-3 animate-spin" />
                {status === "generating" ? "Creating" : "Phrase"}
              </div>
            )}
          </div>

          {status === "fail" && nodeData.errorMessage && (
            <div className="flex items-start gap-1.5 p-2 rounded-md bg-red-500/5 text-red-500 text-[11px]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="line-clamp-2" title={nodeData.errorMessage}>
                {nodeData.errorMessage}
              </span>
            </div>
          )}

          {ready && nodeData.voiceId && (
            <div className="text-[10px] font-mono text-muted-foreground/80 truncate" title={nodeData.voiceId}>
              ID {nodeData.voiceId.slice(0, 8)}…
            </div>
          )}

          <Button
            type="button"
            variant={ready ? "outline" : "default"}
            size="sm"
            className="w-full"
            onClick={(e) => {
              e.stopPropagation()
              setModalOpen(true)
            }}
          >
            <Settings2 className="w-3.5 h-3.5 mr-1.5" />
            {ready ? "Edit Voice" : inProgress ? "Resume Setup" : "Configure Voice"}
          </Button>
        </div>
      </BaseNode>

      <HandleWithPopover nodeId={id} nodeType="suno-voice" handleId="voicePersona" type="source" position={Position.Right} label="Voice persona" color={HANDLE_COLORS.identity} icon={<User />} side="right" top="calc(50% - 4px)" />

      <SunoVoiceSetupModal
        nodeId={id}
        data={nodeData}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </div>
  )
}

export const SunoVoiceNode = memo(SunoVoiceNodeComponent)
