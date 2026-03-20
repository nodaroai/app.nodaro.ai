"use client"

import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Send, Download } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { TeleportSendData, TeleportReceiveData } from "@/types/nodes"

type TeleporterNodeData = TeleportSendData | TeleportReceiveData

function TeleportNodeShell({ id, data, selected, variant }: NodeProps & { variant: "send" | "receive" }) {
  const nodeData = data as TeleporterNodeData
  const partnerType = variant === "send" ? "teleport-receive" : "teleport-send"
  const Icon = variant === "send" ? Send : Download
  const label = variant === "send" ? "SEND" : "RECV"

  // Derive highlight directly from store — no useState/useEffect, no full-store subscription
  const isHighlighted = useWorkflowStore((s) => {
    if (!s.selectedNodeId || s.selectedNodeId === id) return false
    const sel = s.nodes.find((n) => n.id === s.selectedNodeId)
    return sel?.type === partnerType &&
      (sel.data as TeleporterNodeData).channel === nodeData.channel
  })

  return (
    <div
      className={`relative flex items-center rounded-full border-2 px-3 py-1 transition-shadow ${
        selected ? "shadow-lg" : ""
      }`}
      style={{
        borderColor: nodeData.channelColor,
        backgroundColor: "var(--card)",
        minWidth: 120,
        minHeight: 40,
      }}
    >
      {isHighlighted && (
        <div
          className="absolute inset-[-4px] rounded-full animate-pulse pointer-events-none"
          style={{ boxShadow: `0 0 12px 4px ${nodeData.channelColor}`, opacity: 0.6 }}
        />
      )}

      <Handle
        type="target"
        position={Position.Left}
        id="in"
        style={variant === "send"
          ? { background: nodeData.channelColor, border: "2px solid var(--card)" }
          : { opacity: 0, pointerEvents: "none", width: 1, height: 1 }
        }
      />

      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={variant === "receive"
          ? { background: nodeData.channelColor, border: "2px solid var(--card)" }
          : { opacity: 0, pointerEvents: "none", width: 1, height: 1 }
        }
      />

      <div className="flex items-center gap-2 py-1">
        <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: nodeData.channelColor }} />
        <span className="text-xs font-semibold truncate" style={{ color: nodeData.channelColor }}>
          {label}
        </span>
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: nodeData.channelColor + "20", color: nodeData.channelColor }}
        >
          {nodeData.channel}
        </span>
      </div>
    </div>
  )
}

const MemoizedShell = memo(TeleportNodeShell)

export const TeleportSendNode = memo(function TeleportSendNodeWrapper(props: NodeProps) {
  return <MemoizedShell {...props} variant="send" />
})

export const TeleportReceiveNode = memo(function TeleportReceiveNodeWrapper(props: NodeProps) {
  return <MemoizedShell {...props} variant="receive" />
})
