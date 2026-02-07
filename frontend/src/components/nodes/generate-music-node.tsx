"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Music, Loader2, AlertCircle, X, AudioLines } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import type { GenerateMusicData } from "@/types/nodes"

function GenerateMusicNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as GenerateMusicData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedAudioUrl
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  function handleDeleteResult(indexToDelete: number) {
    const newResults = results.filter((_, i) => i !== indexToDelete)
    let newActiveIndex = activeIndex
    if (indexToDelete === activeIndex) { newActiveIndex = 0 }
    else if (indexToDelete < activeIndex) { newActiveIndex = activeIndex - 1 }
    updateNodeData(id, { generatedResults: newResults, activeResultIndex: newActiveIndex, generatedAudioUrl: newResults[newActiveIndex]?.url })
  }

  return (
    <div className="relative group/run">
    <BaseNode id={id} label={nodeData.label} icon={<Music className="h-4 w-4" />} category="ai" credits={5} selected={selected} isRunning={status === "running"}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Prompt", top: "35%" },
        { id: "ref-audio", type: "target", position: Position.Left, label: "Ref Audio", top: "75%" },
        { id: "audio-out", type: "source", position: Position.Right, label: "Audio" },
      ]}
    >
      <div className="flex flex-col gap-1">
        {status === "running" && (
          <div className="flex items-center justify-center h-16 rounded-md bg-muted/30"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        )}
        {status !== "running" && activeUrl && (
          <div className="relative group">
            <audio src={activeUrl} controls className="w-full h-10" />
            {results.length > 0 && (
              <button type="button" className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}><X className="w-3 h-3" /></button>
            )}
          </div>
        )}
        {status === "failed" && !activeUrl && (
          <div className="flex flex-col items-center justify-center gap-1 h-16 rounded-md bg-red-500/5 text-red-500 p-2">
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
        {status !== "running" && !activeUrl && status !== "failed" && (
          <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40"><Music className="w-5 h-5" /></div>
        )}
        {results.length > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            {results.slice(0, 5).map((r, i) => (
              <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                <div className={`w-10 h-10 flex items-center justify-center rounded cursor-pointer transition-opacity bg-muted ${i === activeIndex ? "opacity-100 ring-2 ring-primary" : "opacity-50 hover:opacity-80"}`} onClick={(e) => { e.stopPropagation(); updateNodeData(id, { activeResultIndex: i, generatedAudioUrl: r.url }) }}>
                  <AudioLines className="w-4 h-4" />
                </div>
                <button type="button" className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(i) }}><X className="w-2.5 h-2.5" /></button>
              </div>
            ))}
          </div>
        )}
        <p className="text-muted-foreground">{nodeData.provider || "musicgen"} - {nodeData.duration}s{nodeData.genre ? ` - ${nodeData.genre}` : ""}{nodeData.instrumental ? " (instrumental)" : ""}</p>
      </div>
    </BaseNode>
    <RunNodeButton nodeId={id} credits={5} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
    <DeleteConfirmationDialog isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }} />
    </div>
  )
}

export const GenerateMusicNode = memo(GenerateMusicNodeComponent)
