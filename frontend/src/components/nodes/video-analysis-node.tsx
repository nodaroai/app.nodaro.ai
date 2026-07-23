"use client"

import { memo, useMemo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ScanSearch, Film, Braces, Type, Loader2, AlertCircle, Copy } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { NodeJobProgress } from "./node-job-progress"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { useUpstreamVideoDuration } from "@/hooks/use-upstream-video-duration"
import { ACCEPTS_VIDEO } from "@/lib/ffmpeg-handles"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { buildVideoAnalysisCreditId, resolveVideoAnalysisModel } from "@nodaro/shared"
import type { VideoAnalysisNodeData } from "@/types/nodes"

function VideoAnalysisNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as VideoAnalysisNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"
  const result = nodeData.generatedJson
  const scenes = result?.scenes ?? []

  // Duration for the credit-bucket estimate: a probed YouTube duration wins
  // (only while it still matches the node's current youtubeUrl), else the wired
  // upstream video's duration, else undefined → buildVideoAnalysisCreditId's
  // ceiling composite. Display only; the real reservation is computed
  // server-side from the actual video length (ffprobe is authoritative).
  const upstreamDuration = useUpstreamVideoDuration(id, "video")
  const probedDuration =
    nodeData.probedYoutube && nodeData.probedYoutube.url === nodeData.youtubeUrl
      ? nodeData.probedYoutube.durationSec
      : undefined
  // Resolve the tier ("fast"/"pro") or raw model to the internal model (default
  // pro) so the pre-run credit estimate matches what the server charges.
  const model = resolveVideoAnalysisModel(nodeData.llmModel)
  const creditModelId = useMemo(
    () => buildVideoAnalysisCreditId(model, probedDuration ?? upstreamDuration ?? undefined),
    [model, probedDuration, upstreamDuration],
  )
  const credits = useModelCredits(creditModelId)

  return (
    <div className="relative max-w-[240px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<ScanSearch className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<ScanSearch className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        minWidth={240}
        hideHeader
        topToolbarContent={
          <NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} />
        }
        handles={[
          { id: "video", type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
          { id: "json",  type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
          { id: "text",  type: "source", position: Position.Right, customStyle: { top: '52px',              right: '-29px' }, external: true },
        ]}
      >
        <div className="flex flex-col gap-2 p-3" style={{ minHeight: 160 }}>
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 h-16 rounded-md bg-muted/30">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={nodeData.currentJobProgress} />
            </div>
          )}

          {status === "failed" && (
            <div className="flex flex-col items-center justify-center gap-1 h-16 rounded-md bg-red-500/5 text-red-500 p-2">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-medium">Failed</span>
              </div>
              {nodeData.errorMessage && (
                <p className="text-[10px] text-center text-red-400 line-clamp-2" title={nodeData.errorMessage}>
                  {nodeData.errorMessage}
                </p>
              )}
            </div>
          )}

          {status !== "running" && result && scenes.length > 0 && (
            <div className="relative group">
              {/* Scene rows WRAP rather than truncate — this preview is the
                  result, so no line is cut mid-sentence. Overall height is
                  bounded by the container's max-h + scroll, never by clipping
                  each row: a long description costs scroll, never content.
                  `items-baseline` keeps #N and the timecode aligned to the
                  label's first line when the label wraps. */}
              <div className="rounded-md border bg-muted/30 text-[10px] max-h-64 overflow-y-auto divide-y divide-border/60">
                {scenes.slice(0, 12).map((s) => (
                  <div key={s.sceneNumber} className="flex flex-col gap-0.5 px-2 py-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-medium text-muted-foreground tabular-nums shrink-0">#{s.sceneNumber}</span>
                      <span className="text-muted-foreground/70 tabular-nums shrink-0">
                        {s.startSec.toFixed(1)}–{s.endSec.toFixed(1)}s
                      </span>
                      <span className="font-medium min-w-0 break-words">{s.label}</span>
                    </div>
                    <span className="text-muted-foreground/70 break-words">{s.visualResolved}</span>
                  </div>
                ))}
                {scenes.length > 12 && (
                  <div className="px-2 py-1 text-muted-foreground/60">+{scenes.length - 12} more scenes</div>
                )}
              </div>
              <button
                type="button"
                aria-label="Copy JSON"
                className="absolute -top-1 -right-1 w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  navigator.clipboard.writeText(JSON.stringify(result, null, 2))
                }}
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          )}

          {status !== "running" && status !== "failed" && scenes.length === 0 && (
            <div
              className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40"
              style={{ minHeight: 120, flex: 1 }}
            >
              <ScanSearch className="w-6 h-6" />
              <span className="text-[10px]">Connect a video or set a URL</span>
            </div>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="video-analysis" handleId="video" type="target" position={Position.Left}  label="Video"       color={HANDLE_COLORS.video}    icon={<Film />}   side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_VIDEO} />
      <HandleWithPopover nodeId={id} nodeType="video-analysis" handleId="json"  type="source" position={Position.Right} label="Scenes JSON" color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
      {/* Same payload as `json`, typed as TEXT — wires straight into prompt/
          text inputs (extractNodeOutput stringifies for both handles). */}
      <HandleWithPopover nodeId={id} nodeType="video-analysis" handleId="text"  type="source" position={Position.Right} label="Text"        color={DATA_HANDLE_COLORS.text} icon={<Type />}   side="right" top="52px" />
    </div>
  )
}

export const VideoAnalysisNode = memo(VideoAnalysisNodeComponent)
