"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Globe, Type, ImageIcon, Video } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { estimateNodeCredits } from "@/components/editor/workflow-editor/types"
import { SCRAPER_ACTOR_LABELS } from "@nodaro-shared/scraper-actors"
import type { WebScrapeNodeData } from "@/types/nodes"

const HANDLES = [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
  { id: "text", type: "source" as const, position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
  { id: "image", type: "source" as const, position: Position.Right, customStyle: { top: '50px', right: '-29px' }, hideHandle: true },
  { id: "video", type: "source" as const, position: Position.Right, customStyle: { top: '80px', right: '-29px' }, hideHandle: true },
] as const

function getActorSummary(nodeData: WebScrapeNodeData): string {
  switch (nodeData.actor) {
    case "content-crawler":
      return nodeData.url?.trim() || "Enter website URL..."
    case "instagram":
    case "tiktok":
      return nodeData.target?.trim() || "Enter target..."
    case "google-search":
    default:
      return nodeData.query?.trim() || "Enter search query..."
  }
}

function WebScrapeNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as WebScrapeNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const actor = nodeData.actor ?? "google-search"
  const actorLabel = SCRAPER_ACTOR_LABELS[actor]
  const summary = getActorSummary(nodeData)
  const credits = estimateNodeCredits({ type: "web-scrape", data: nodeData })

  return (
    <div className="relative max-w-[220px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Globe className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Globe className="h-4 w-4" />}
        category="input"
        credits={credits}
        selected={selected}
        minWidth={220}
        hideHeader
        handles={HANDLES}
      >
        <div className="p-3 flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-[#38BDF8]">
            {actorLabel}
          </span>
          <p className="text-muted-foreground truncate max-w-[180px]">
            {summary}
          </p>
        </div>
      </BaseNode>
      <HandleIcon icon={<Globe />} color="cyan" side="left" top="calc(100% - 20px)" />
      <HandleIcon icon={<Type />} top="20px" />
      <HandleIcon icon={<ImageIcon />} top="50px" />
      <HandleIcon icon={<Video />} top="80px" />
    </div>
  )
}

export const WebScrapeNode = memo(WebScrapeNodeComponent)
