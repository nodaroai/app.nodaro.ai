"use client"

import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Send, Download, ArrowRight, ArrowLeft } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { isTeleportDefaultLabel, TELEPORTER_PAN_EVENT, type TeleportSendData, type TeleportReceiveData } from "@/types/nodes"
import { isImageUrl, isVideoUrl } from "@/lib/media-type"

type TeleporterNodeData = TeleportSendData | TeleportReceiveData

const HIDDEN_HANDLE_STYLE = { opacity: 0, pointerEvents: "none" as const, width: 1, height: 1 }

function TeleportNodeShell({ id, data, selected, variant }: NodeProps & { variant: "send" | "receive" }) {
  const nodeData = data as TeleporterNodeData
  const partnerType = variant === "send" ? "teleport-receive" : "teleport-send"
  const Icon = variant === "send" ? Send : Download
  const typeLabel = variant === "send" ? "SEND" : "RECV"
  const JumpIcon = variant === "send" ? ArrowRight : ArrowLeft

  const isHighlighted = useWorkflowStore((s) => {
    if (!s.selectedNodeId || s.selectedNodeId === id) return false
    const sel = s.nodes.find((n) => n.id === s.selectedNodeId)
    return sel?.type === partnerType &&
      (sel.data as TeleporterNodeData).channel === nodeData.channel
  })

  const firstPartnerId = useWorkflowStore((s) => {
    const partner = s.nodes.find(
      (n) => n.type === partnerType && (n.data as TeleporterNodeData).channel === nodeData.channel
    )
    return partner?.id ?? null
  })

  const result = nodeData.result ?? ""
  const isImage = typeof result === "string" && isImageUrl(result)
  const isVideo = typeof result === "string" && isVideoUrl(result)
  const hasThumb = isImage || isVideo

  const hasCustomName = !isTeleportDefaultLabel(nodeData.label, nodeData.channel)
  const badgeText = hasCustomName ? `${nodeData.channel} \u00b7 ${nodeData.label}` : nodeData.channel

  const handleJump = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!firstPartnerId) return
    window.dispatchEvent(new CustomEvent(TELEPORTER_PAN_EVENT, { detail: { nodeId: firstPartnerId } }))
  }

  const jumpButton = firstPartnerId ? (
    <button
      type="button"
      className="flex items-center justify-center w-5 h-5 rounded-full hover:bg-white/10 transition-colors"
      style={{ color: nodeData.channelColor }}
      onClick={handleJump}
      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
      title="Jump to partner"
      aria-label="Jump to partner"
    >
      <JumpIcon className="w-3 h-3" />
    </button>
  ) : null

  const thumbnail = hasThumb ? (
    <div
      className="w-6 h-6 rounded-md overflow-hidden shrink-0 border"
      style={{ borderColor: nodeData.channelColor + "40" }}
    >
      {isImage ? (
        <img src={result} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <video src={result} className="w-full h-full object-cover" muted playsInline preload="metadata" />
      )}
    </div>
  ) : null

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
          : HIDDEN_HANDLE_STYLE
        }
      />

      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={variant === "receive"
          ? { background: nodeData.channelColor, border: "2px solid var(--card)" }
          : HIDDEN_HANDLE_STYLE
        }
      />

      <div className="flex items-center gap-1.5 py-1">
        {variant === "receive" && jumpButton}
        {thumbnail}
        <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: nodeData.channelColor }} />
        <span className="text-xs font-semibold truncate" style={{ color: nodeData.channelColor }}>
          {typeLabel}
        </span>
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full truncate max-w-[140px]"
          style={{ backgroundColor: nodeData.channelColor + "20", color: nodeData.channelColor }}
        >
          {badgeText}
        </span>
        {variant === "send" && jumpButton}
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
