"use client"

import { memo, useState, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Scissors, Braces, Film, AudioLines, Loader2, AlertCircle } from "lucide-react"
import { applyEdlCreditId } from "@nodaro/shared"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { ACCEPTS_MEDIA } from "@/lib/ffmpeg-handles"
import { ACCEPTS_JSON, DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { useApplyEdlEstimateMinutes } from "@/hooks/use-apply-edl-estimate-minutes"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "./video-node-defaults"
import { useT } from "@/lib/i18n"
import type { ApplyEdlData } from "@/types/nodes"

function ApplyEdlNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ApplyEdlData
  const t = useT()
  // Priced per OUTPUT MINUTE: the model cost is a rate, so the pill multiplies it
  // by the minutes this render can reserve (the shared resolver every run-level
  // estimate uses). It used to read `useEstimatedCredits`, which has no apply-edl
  // case — the pill and its Run button showed 0. The rate is the row of the
  // render's quality (a preview's `apply-edl:proxy`), the id the run reserves on.
  const credits = useModelCredits(applyEdlCreditId(nodeData.quality)) * useApplyEdlEstimateMinutes(id)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const output = nodeData.output ?? "video"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl ?? nodeData.generatedAudioUrl
  const [mediaError, setMediaError] = useState(false)

  useEffect(() => { setMediaError(false) }, [activeUrl])

  // Result aspect drives node sizing (shared media-node-sizing invariant) —
  // 16:9 until a video result lands, then snaps to the real aspect.
  const { aspectRatio: mediaAspectRatio, onLoadDimensions } = useResultAspectRatio(id, results, activeIndex)
  const hasResult = status !== "running" && !!activeUrl && !mediaError

  return (
    <div className="relative group/node" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      <EditableNodeLabel label={nodeData.label} icon={<Scissors className="w-3.5 h-3.5" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Scissors className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        {...videoNodeSizing(mediaAspectRatio)}
        topToolbarContent={<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />}
        handles={[
          { id: "edl",        type: "target", position: Position.Left,  customStyle: { top: "24px",              left: "-29px" },  external: true },
          { id: "transcript", type: "target", position: Position.Left,  customStyle: { top: "52px",              left: "-29px" },  external: true },
          { id: "sources",    type: "target", position: Position.Left,  customStyle: { top: "calc(100% - 24px)", left: "-29px" },  external: true },
          { id: "media",      type: "source", position: Position.Right, customStyle: { top: "calc(100% - 24px)", right: "-29px" }, external: true },
          { id: "json",       type: "source", position: Position.Right, customStyle: { top: "24px",              right: "-29px" }, external: true },
        ]}
      >
        <div className="flex flex-col gap-1 p-2 h-full" style={{ minHeight: 120 }}>
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 flex-1 rounded-md bg-muted/30">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={nodeData.currentJobProgress} />
            </div>
          )}

          {hasResult && output === "video" && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={activeUrl}
              controls
              className="w-full flex-1 rounded-md bg-black object-contain"
              onLoadedMetadata={(e) => onLoadDimensions({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
              onError={() => setMediaError(true)}
            />
          )}

          {hasResult && output === "audio" && (
            <div className="flex flex-col items-center justify-center gap-2 flex-1 rounded-md bg-muted/30 p-2">
              <AudioLines className="w-5 h-5 text-muted-foreground" />
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio src={activeUrl} controls className="w-full" onError={() => setMediaError(true)} />
            </div>
          )}

          {status === "failed" && !activeUrl && (
            <div className="flex flex-col items-center justify-center gap-1 flex-1 rounded-md bg-red-500/5 text-red-500 p-2">
              <div className="flex items-center gap-1.5"><AlertCircle className="w-4 h-4 shrink-0" /><span className="font-medium">{t("node.failed")}</span></div>
              {nodeData.errorMessage && (
                <p className="text-[10px] text-center text-red-400 line-clamp-2" title={nodeData.errorMessage}>{nodeData.errorMessage}</p>
              )}
            </div>
          )}

          {status !== "running" && !hasResult && status !== "failed" && (
            <div className="flex flex-col items-center justify-center gap-1 flex-1 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
              <Scissors className="w-5 h-5" />
              {/* One key per medium, not an interpolated noun or a "→": an arrow
                  points the wrong way in RTL and a spliced-in noun breaks
                  agreement in every gendered locale. */}
              <span className="text-[10px] text-center px-2">
                {t(output === "audio" ? "node.applyEdlConnectAudio" : "node.applyEdlConnectVideo")}
              </span>
            </div>
          )}
        </div>
      </BaseNode>

      <HandleWithPopover nodeId={id} nodeType="apply-edl" handleId="edl"        type="target" position={Position.Left}  label="EDL"        color={DATA_HANDLE_COLORS.json}  icon={<Braces />}     side="left"  top="24px"              accepts={ACCEPTS_JSON} />
      <HandleWithPopover nodeId={id} nodeType="apply-edl" handleId="transcript" type="target" position={Position.Left}  label="Transcript" color={DATA_HANDLE_COLORS.json}  icon={<Braces />}     side="left"  top="52px"              accepts={ACCEPTS_JSON} />
      <HandleWithPopover nodeId={id} nodeType="apply-edl" handleId="sources"    type="target" position={Position.Left}  label="Sources"    color={HANDLE_COLORS.video}      icon={<Film />}       side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_MEDIA} orderMatters />
      <HandleWithPopover nodeId={id} nodeType="apply-edl" handleId="media"      type="source" position={Position.Right} label={output === "audio" ? "Audio" : "Video"} color={output === "audio" ? HANDLE_COLORS.audio : HANDLE_COLORS.video} icon={output === "audio" ? <AudioLines /> : <Film />} side="right" top="calc(100% - 24px)" />
      <HandleWithPopover nodeId={id} nodeType="apply-edl" handleId="json"       type="source" position={Position.Right} label="Transcript" color={DATA_HANDLE_COLORS.json}  icon={<Braces />}     side="right" top="24px" />
    </div>
  )
}

export const ApplyEdlNode = memo(ApplyEdlNodeComponent)
