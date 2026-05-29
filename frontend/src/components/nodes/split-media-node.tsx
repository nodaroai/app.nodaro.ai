"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Scissors, Loader2, AlertCircle, Video, AudioWaveform, LayoutGrid } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { isValidSplitMediaConnection } from "@/lib/audio-text-handles"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import type { SplitMediaData } from "@/types/nodes"

const ACCEPTS_VIDEO = (t: string) => isValidSplitMediaConnection("video", t)
const ACCEPTS_AUDIO = (t: string) => isValidSplitMediaConnection("audio", t)

function SplitMediaNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SplitMediaData
  const credits = useModelCredits("ffmpeg", 2)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const videoChunks = nodeData.generatedVideoUrls ?? []
  const audioChunks = nodeData.generatedAudioUrls ?? []
  const chunkCount = Math.max(videoChunks.length, audioChunks.length)
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div className="relative" style={{ maxWidth: "220px" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Scissors className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Scissors className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        topToolbarContent={
          <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
        }
        handles={[
          { id: "video", type: "target", position: Position.Left, customStyle: { top: "40%", left: "-29px" }, external: true },
          { id: "audio", type: "target", position: Position.Left, customStyle: { top: "70%", left: "-29px" }, external: true },
          { id: "video", type: "source", position: Position.Right, customStyle: { top: "30%", right: "-29px" }, external: true },
          { id: "audio", type: "source", position: Position.Right, customStyle: { top: "70%", right: "-29px" }, external: true },
        ]}
      >
        <div className="flex flex-col gap-2 p-3" style={{ minHeight: 140 }}>
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 h-12 rounded-md bg-muted/30">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={nodeData.currentJobProgress} />
            </div>
          )}

          {status === "completed" && chunkCount > 0 && (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                className="flex items-center gap-1.5 px-2 py-1 bg-black/40 hover:bg-black/60 border border-white/10 text-white text-[11px] rounded-md w-fit"
                onClick={(e) => { e.stopPropagation(); setShowDetails(v => !v) }}
              >
                <LayoutGrid className="w-3 h-3" />
                <span>{chunkCount} chunks</span>
              </button>
              {showDetails && (
                <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
                  {audioChunks.map((url, i) => (
                    <div key={`a-${i}`} className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <span className="text-[10px] text-muted-foreground">Chunk {i + 1}</span>
                      <audio controls src={url} className="w-full h-7" style={{ height: '28px' }} />
                    </div>
                  ))}
                  {videoChunks.map((url, i) => (
                    <div key={`v-${i}`} className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <span className="text-[10px] text-muted-foreground">Video chunk {i + 1}</span>
                      <video controls src={url} className="w-full rounded" style={{ maxHeight: '60px' }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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

          {status !== "running" && status !== "completed" && status !== "failed" && (
            <div className="flex items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40" style={{ minHeight: 80, flex: 1 }}>
              <Scissors className="w-5 h-5" />
            </div>
          )}

          <span className="text-xs text-muted-foreground">
            Split · {nodeData.chunkDuration}s chunks
          </span>
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="split-media" handleId="video" type="target" position={Position.Left}  label="Video" color="#3B82F6" icon={<Video />}          side="left"  top="40%" accepts={ACCEPTS_VIDEO} />
      <HandleWithPopover nodeId={id} nodeType="split-media" handleId="audio" type="target" position={Position.Left}  label="Audio" color="#F59E0B" icon={<AudioWaveform />} side="left"  top="70%" accepts={ACCEPTS_AUDIO} />
      <HandleWithPopover nodeId={id} nodeType="split-media" handleId="video" type="source" position={Position.Right} label="Video" color="#3B82F6" icon={<Video />}          side="right" top="30%" />
      <HandleWithPopover nodeId={id} nodeType="split-media" handleId="audio" type="source" position={Position.Right} label="Audio" color="#F59E0B" icon={<AudioWaveform />} side="right" top="70%" />
    </div>
  )
}

export const SplitMediaNode = memo(SplitMediaNodeComponent)
