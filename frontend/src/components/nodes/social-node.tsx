"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Instagram, Video, Youtube, Linkedin, Twitter, Facebook, CheckCircle, AlertCircle, Send, Loader2 } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credits"
import { NodeJobProgress } from "./node-job-progress"
import { PLATFORM_LABELS } from "@/lib/social-media-specs"
import type { SocialPostData, SocialPlatformType } from "@/types/nodes"

const PLATFORM_ICONS: Record<SocialPlatformType, React.ReactNode> = {
  instagram: <Instagram className="h-4 w-4" />,
  tiktok: <Video className="h-4 w-4" />,
  youtube: <Youtube className="h-4 w-4" />,
  linkedin: <Linkedin className="h-4 w-4" />,
  x: <Twitter className="h-4 w-4" />,
  facebook: <Facebook className="h-4 w-4" />,
  telegram: <Send className="h-4 w-4" />,
}

function SocialNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SocialPostData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const platform = nodeData.platform
  const icon = PLATFORM_ICONS[platform] || PLATFORM_ICONS.instagram
  const status = nodeData.executionStatus ?? "idle"
  const credits = useModelCredits("social-publish", 1)

  return (
    <div className="relative max-w-[220px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={icon}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={icon}
        category="output"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        minWidth={220}
        hideHeader
        topToolbarContent={
          status !== "running" ? (
            <RunNodeButton nodeId={id} credits={credits} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
          ) : undefined
        }
        handles={[
          { id: "in", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
          { id: "out", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
        ]}
      >
        <div className="p-3 flex flex-col items-center justify-center gap-2" style={{ minHeight: '100px' }}>
          {status === "running" && (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={nodeData.currentJobProgress} />
              <span className="text-[11px] text-muted-foreground">Publishing...</span>
            </div>
          )}

          {status === "completed" && (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle className="w-6 h-6 text-green-500" />
              <span className="text-[11px] font-medium text-green-600 dark:text-green-400">Published</span>
              {nodeData.platformPostUrl && (
                <a
                  href={nodeData.platformPostUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-[#ff0073] hover:underline truncate max-w-[180px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  View post
                </a>
              )}
            </div>
          )}

          {status === "failed" && (
            <div className="flex flex-col items-center gap-1.5">
              <AlertCircle className="w-6 h-6 text-red-500" />
              <span className="text-[11px] font-medium text-red-500">Failed</span>
              {nodeData.errorMessage && (
                <p className="text-[10px] text-center text-red-400 line-clamp-2 max-w-[180px]" title={nodeData.errorMessage}>
                  {nodeData.errorMessage}
                </p>
              )}
            </div>
          )}

          {status === "idle" && (
            <div className="flex flex-col items-center gap-2 text-muted-foreground/50">
              <Send className="w-8 h-8" />
              <span className="text-[11px]">
                {nodeData.caption
                  ? nodeData.caption.slice(0, 50) + (nodeData.caption.length > 50 ? "..." : "")
                  : `Post to ${PLATFORM_LABELS[platform]}`}
              </span>
            </div>
          )}
        </div>
      </BaseNode>
      <HandleIcon icon={icon} color="green" side="left" top="calc(100% - 20px)" />
      <HandleIcon icon={icon} color="green" top="20px" />
    </div>
  )
}

export const SocialNode = memo(SocialNodeComponent)
