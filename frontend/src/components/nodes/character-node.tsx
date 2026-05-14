"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { UserCircle, Loader2, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useConnectionCount } from "@/hooks/use-connection-count"
import { CachedImage } from "@/components/ui/cached-image"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import type { CharacterNodeData } from "@/types/nodes"

function CharacterNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CharacterNodeData
  const credits = useModelCredits((nodeData.provider as string | undefined) ?? "nano-banana", 2)
  const useFull = useFullResolution(id)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const setCharacterStudioNodeId = useWorkflowStore((s) => s.setCharacterStudioNodeId)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const inConnectionCount = useConnectionCount(id)
  const status = nodeData.executionStatus ?? "idle"

  const expressionCount = (nodeData.expressions ?? []).length
  const poseCount = (nodeData.poses ?? []).length
  const motionCount = (nodeData.motions ?? []).length
  // Per-canvas-node default asset (frontend-only). When the user star'd an
  // asset in the Character Studio, that URL drives the thumbnail here; falls
  // back to the approved portrait URL otherwise. Two character nodes that
  // reference the same DB character can show different thumbnails because
  // `defaultAssetUrl` lives on node data, not the DB row.
  const thumbnailUrl = nodeData.defaultAssetUrl || nodeData.sourceImageUrl
  const thumbnailLabel = nodeData.defaultAssetName || nodeData.characterName || "Character"
  // Whether to render the thumbnail as a <video> rather than a <CachedImage>.
  // Heuristic: if the default-asset URL is in the node's motions array, OR
  // its file extension looks like a video, render as video. Otherwise the
  // CachedImage path takes it (R2 image proxy + thumbnail variants).
  const isVideoDefault =
    nodeData.defaultAssetUrl !== undefined &&
    ((nodeData.motions ?? []).some((m) => m.url === nodeData.defaultAssetUrl) ||
      /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(nodeData.defaultAssetUrl))
  const anyAssetRunning =
    nodeData.expressionStatus === "running" ||
    nodeData.poseStatus === "running" ||
    nodeData.lightingStatus === "running" ||
    nodeData.anglesStatus === "running" ||
    nodeData.motionStatus === "running"

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<UserCircle className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<UserCircle className="h-4 w-4" />}
      category="character"
      credits={credits}
      selected={selected}
      isRunning={status === "running" || anyAssetRunning}
      hideHeader
      topToolbarContent={
        <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
      }
      handles={[
        { id: "in", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
        { id: "characterRef", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
      ]}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#1a2744] border-b border-[#1e3a6e]">
        <span className="text-[11px]">👤</span>
        <span className="text-[11px] font-semibold text-[#93c5fd]">Character</span>
        <span className="ml-auto text-[9px] text-[#3b82f6] bg-[#0f1e40] px-1.5 py-0.5 rounded">entity</span>
      </div>

      {/* Portrait preview — uses defaultAssetUrl when the user star'd a
          studio asset, otherwise falls back to the approved portrait. */}
      <div className="px-2.5 pt-2.5">
        {thumbnailUrl ? (
          <div className="relative">
            {isVideoDefault ? (
              <video
                src={thumbnailUrl}
                className="w-full h-[110px] object-cover rounded-md border border-[#334155] bg-black"
                muted
                playsInline
                loop
                autoPlay
                preload="metadata"
              />
            ) : (
              <CachedImage
                src={thumbnailUrl}
                alt={thumbnailLabel}
                className="w-full h-[110px] object-cover rounded-md border border-[#334155]"
                thumbnail={!useFull}
                thumbnailWidth={320}
              />
            )}
            {nodeData.defaultAssetUrl && (
              // Small ★ marker so users see at-a-glance this thumbnail is
              // a chosen default (not the portrait fallback).
              <span
                aria-hidden
                title={`Default: ${nodeData.defaultAssetName ?? ""}`}
                className="absolute top-1 right-1 px-1 rounded-full bg-black/50 text-[8px] text-yellow-400 leading-tight border border-yellow-400/40"
              >
                ★
              </span>
            )}
            {status === "running" && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-md">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        ) : (
          <div className="w-full h-[110px] rounded-md border border-dashed border-[#334155] flex items-center justify-center text-[10px] text-[#3b4155]">
            {status === "running" ? <Loader2 className="w-5 h-5 animate-spin" /> : "portrait preview"}
          </div>
        )}
      </div>

      {/* Name + style/gender */}
      <div className="px-2.5 pt-1.5 text-[12px] font-semibold text-slate-200 truncate">{nodeData.characterName || "Unnamed"}</div>
      <div className="px-2.5 pb-2 text-[9px] text-slate-600">{`${nodeData.style} · ${nodeData.gender}`}</div>

      {/* Asset badge row */}
      <div className="px-2.5 pb-2 grid grid-cols-3 gap-1 text-[9px] text-muted-foreground">
        <AssetBadge label="Expr" count={expressionCount} status={nodeData.expressionStatus ?? "idle"} />
        <AssetBadge label="Poses" count={poseCount} status={nodeData.poseStatus ?? "idle"} />
        <AssetBadge label="Motions" count={motionCount} status={nodeData.motionStatus ?? "idle"} />
      </div>

      {/* Voice / personality / studio row */}
      <div className="px-2.5 pb-2.5 grid grid-cols-3 gap-1 text-center">
        <div className="bg-[#1a1d27] rounded px-1 py-1">
          <div className="text-[11px]">🎤</div>
          <div className={`text-[8px] font-semibold ${nodeData.voice ? "text-[#22c55e]" : "text-slate-600"}`}>{nodeData.voice ? "✓" : "—"}</div>
          <div className="text-[7px] text-slate-600">voice</div>
        </div>
        <div className="bg-[#1a1d27] rounded px-1 py-1">
          <div className="text-[11px]">🧠</div>
          <div className={`text-[8px] font-semibold ${nodeData.personality ? "text-[#22c55e]" : "text-slate-600"}`}>{nodeData.personality ? "✓" : "—"}</div>
          <div className="text-[7px] text-slate-600">person.</div>
        </div>
        <button
          type="button"
          aria-label="Open Character Studio"
          className="bg-[#1e3a5f] border border-[#3b82f633] rounded px-1 py-1 cursor-pointer hover:bg-[#234670] transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            setCharacterStudioNodeId(id)
          }}
        >
          <div className="text-[11px]">⬡</div>
          <div className="text-[7px] text-[#93c5fd] font-medium">studio</div>
        </button>
      </div>
    </BaseNode>

    {/* Input handle icon */}
    <HandleIcon icon={<Type />} color="pink" side="left" top="calc(100% - 20px)">
      <div className="absolute top-1/2 -translate-y-1/2 -left-[9px] w-[12px] h-[12px] rounded-full bg-[#111827] border border-[#ff0073] text-[#ff0073] text-[8px] font-black flex items-center justify-center">+</div>
      {inConnectionCount >= 2 && (
        <div className="absolute top-1/2 -translate-y-1/2 -right-[9px] w-[13px] h-[13px] rounded-full bg-white text-[#ff0073] text-[8px] font-black flex items-center justify-center">
          {inConnectionCount}
        </div>
      )}
    </HandleIcon>
    {/* Output handle icon */}
    <HandleIcon icon={<UserCircle />} color="pink" side="right" top="20px" />
    </div>
  )
}

function AssetBadge({ label, count, status }: { readonly label: string; readonly count: number; readonly status: string }) {
  if (status === "running") {
    return (
      <span className="flex items-center justify-center gap-0.5 px-1 py-0.5 rounded bg-muted/50">
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        {label}
      </span>
    )
  }
  return (
    <span className={`flex items-center justify-center gap-0.5 px-1 py-0.5 rounded ${count > 0 ? "bg-primary/10 text-primary" : "bg-[#1a1d27] text-slate-600"}`}>
      {label} {count}
    </span>
  )
}

export const CharacterNode = memo(CharacterNodeComponent)
