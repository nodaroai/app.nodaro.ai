"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { FileText, Loader2, AlertCircle } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credits"
import type { SunoLyricsData } from "@/types/nodes"

function SunoLyricsNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SunoLyricsData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const activeText = nodeData.generatedText
  const credits = useModelCredits("suno-lyrics", 1)

  return (
    <div className="relative group/run">
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<FileText className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "text", type: "source", position: Position.Right, label: "Text" },
      ]}
    >
      <div className="flex flex-col gap-1">
        {status === "running" && !activeText && (
          <div className="flex items-center justify-center h-12 rounded-md bg-muted/30">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {activeText && (
          <div className="w-full rounded-md bg-muted/30 p-2">
            <p className="text-xs text-foreground/80 line-clamp-3 whitespace-pre-wrap">
              {activeText}
            </p>
            {status === "running" && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        )}

        {status === "failed" && !activeText && (
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

        {status !== "running" && !activeText && status !== "failed" && (
          <div className="flex items-center justify-center h-12 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <FileText className="w-5 h-5" />
          </div>
        )}

        <span className="text-xs text-muted-foreground">Lyrics</span>
      </div>
    </BaseNode>
    <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
    </div>
  )
}

export const SunoLyricsNode = memo(SunoLyricsNodeComponent)
