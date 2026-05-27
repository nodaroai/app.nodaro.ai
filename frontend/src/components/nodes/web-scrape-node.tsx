"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Globe, Braces } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { estimateNodeCredits } from "@/components/editor/workflow-editor/types"
import { SCRAPER_ACTOR_LABELS } from "@nodaro/shared"
import type { WebScrapeNodeData } from "@/types/nodes"
import { isValidWebScrapeConnection, DATA_HANDLE_COLORS } from "@/lib/data-handles"

const ACCEPTS_IN = (t: string) => isValidWebScrapeConnection("in", t)

const HANDLES = [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, external: true },
  { id: "json", type: "source" as const, position: Position.Right, customStyle: { top: '20px', right: '-29px' }, external: true },
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
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"

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
        isRunning={status === "running"}
        minWidth={220}
        hideHeader
        topToolbarContent={
          <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
        }
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
      <HandleWithPopover nodeId={id} nodeType="web-scrape" handleId="in"   type="target" position={Position.Left}  label="URL / Query" color={DATA_HANDLE_COLORS.text} icon={<Globe />}  side="left"  top="calc(100% - 20px)" accepts={ACCEPTS_IN} />
      <HandleWithPopover nodeId={id} nodeType="web-scrape" handleId="json" type="source" position={Position.Right} label="JSON"        color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="20px" />
    </div>
  )
}

export const WebScrapeNode = memo(WebScrapeNodeComponent)
