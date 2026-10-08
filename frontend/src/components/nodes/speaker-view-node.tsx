"use client"

import { memo, useEffect, useMemo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Users, Braces, Film, Loader2, AlertCircle } from "lucide-react"
import { SPEAKER_VIEW_PRICED, speakerViewAspectOf, speakerViewDefaultsFor, type SpeakerViewNodeSettings } from "@nodaro/render-rules"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { NodeJobProgress } from "./node-job-progress"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { videoNodeSizing } from "./video-node-defaults"
import { SPEAKER_LAYOUT_LABEL_KEYS, SPEAKER_SWITCH_LABEL_KEYS } from "./speaker-view-quick-configs"
import { EdlValidityBadge } from "@/components/inspector/edl-validity-badge"
import { PreviewBadge, isPreviewQuality } from "@/components/render/preview-badge"
import { ACCEPTS_JSON, DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { speakerViewContextOf, speakerViewEdits, speakerViewTranscript } from "@/lib/speaker-view-context"
import { speakerViewBatchValidity } from "@/lib/speaker-view-validity"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { useT } from "@/lib/i18n"
import type { SpeakerViewData } from "@/types/nodes"

/** The settings a person can set; any of them present means defaults are not ours to write. */
const SETTING_KEYS = ["layout", "switchType", "switchDurationMs", "emphasisStyle", "emphasisDurationMs", "targetAspect"] as const

function SpeakerViewNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SpeakerViewData
  const t = useT()
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  // The take on show is a Preview (a private 720p render) — from what the take
  // IS, never from the node's Quality setting.
  const showsPreview = isPreviewQuality(activeResult)
  const [mediaError, setMediaError] = useState(false)
  useEffect(() => { setMediaError(false) }, [activeUrl])

  // What is wired in, read once: the edits (a pack in clips mode), the
  // transcript, and the facts the face states.
  const ctx = useMemo(() => speakerViewContextOf(id, nodes, edges), [id, nodes, edges])
  const verdict = useMemo(
    () => speakerViewBatchValidity(speakerViewEdits(id, nodes, edges), speakerViewTranscript(id, nodes, edges), nodeData),
    [id, nodes, edges, nodeData],
  )
  const settings = nodeData as SpeakerViewNodeSettings
  const layout = typeof nodeData.layout === "string" && SPEAKER_LAYOUT_LABEL_KEYS[nodeData.layout] ? nodeData.layout : "auto"
  const switchKey = typeof nodeData.switchType === "string" ? SPEAKER_SWITCH_LABEL_KEYS[nodeData.switchType] : SPEAKER_SWITCH_LABEL_KEYS.cut
  const summary = [speakerViewAspectOf(settings, ctx), t(SPEAKER_LAYOUT_LABEL_KEYS[layout]!), switchKey ? t(switchKey) : t("speakerView.switch.crossfade")].join(" · ")

  // SV20: a node that has never been set takes its defaults from the topology
  // of the first edit that is known for it (one camera: Single + Pan; two or
  // more: Auto + Cut; emphasis Scale 300 ms; the edit's aspect). Set ONCE — any
  // setting already on the node, however it got there, is a person's choice and
  // is never overwritten by re-wiring. A convenience, not the invariant: the
  // normalizer at run is what keeps a node valid.
  const hasSettings = SETTING_KEYS.some((k) => nodeData[k] !== undefined)
  useEffect(() => {
    if (ctx && !hasSettings) updateNodeData(id, speakerViewDefaultsFor(ctx))
  }, [ctx, hasSettings, id, updateNodeData])

  // Result aspect drives node sizing (shared media-node-sizing invariant) —
  // 16:9 until a video result lands, then snaps to the real aspect.
  const { aspectRatio: mediaAspectRatio, onLoadDimensions } = useResultAspectRatio(id, results, activeIndex)
  const hasResult = status !== "running" && !!activeUrl && !mediaError

  return (
    <div className="relative group/node" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      <EditableNodeLabel label={nodeData.label} icon={<Users className="w-3.5 h-3.5" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Users className="h-4 w-4" />}
        category="processing"
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        {...videoNodeSizing(mediaAspectRatio)}
        topToolbarContent={
          <NodeQuickStrip
            nodeId={id}
            isRunning={status === "running"}
            disabled={!SPEAKER_VIEW_PRICED}
            disabledReason={!SPEAKER_VIEW_PRICED ? t("speakerView.notPriced") : undefined}
          />
        }
        handles={[
          { id: "edl",        type: "target", position: Position.Left,  customStyle: { top: "24px",              left: "-29px" },  external: true },
          { id: "transcript", type: "target", position: Position.Left,  customStyle: { top: "52px",              left: "-29px" },  external: true },
          { id: "video",      type: "source", position: Position.Right, customStyle: { top: "calc(100% - 24px)", right: "-29px" }, external: true },
          { id: "json",       type: "source", position: Position.Right, customStyle: { top: "24px",              right: "-29px" }, external: true },
        ]}
      >
        <div className="relative flex flex-col gap-1 p-2 h-full" style={{ minHeight: 120 }}>
          {hasResult && showsPreview && <PreviewBadge className="absolute start-3 top-3 z-10 pointer-events-none" />}
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 flex-1 rounded-md bg-muted/30">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={nodeData.currentJobProgress} />
            </div>
          )}

          {hasResult && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={activeUrl}
              controls
              className="w-full flex-1 rounded-md bg-black object-contain"
              onLoadedMetadata={(e) => onLoadDimensions({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
              onError={() => setMediaError(true)}
            />
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
            <div className="flex flex-col items-center justify-center gap-1.5 flex-1 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/60 p-2">
              <Users className="w-5 h-5" />
              {ctx ? (
                <>
                  <span className="text-[10px] text-center px-2" data-testid="speaker-view-summary">{summary}</span>
                  <span className="text-[10px] text-center px-2">{t("speakerView.inputSummary", { speakers: ctx.clips[0]!.speakerCount, cameras: ctx.clips[0]!.cameras })}</span>
                  <EdlValidityBadge verdict={verdict} />
                </>
              ) : (
                <span className="text-[10px] text-center px-2">{t("speakerView.connect")}</span>
              )}
              {!SPEAKER_VIEW_PRICED && (
                <span data-testid="speaker-view-not-priced" className="text-[10px] text-center px-2 text-amber-700 dark:text-amber-400">{t("speakerView.notPriced")}</span>
              )}
            </div>
          )}
        </div>
      </BaseNode>

      <HandleWithPopover nodeId={id} nodeType="speaker-view" handleId="edl"        type="target" position={Position.Left}  label={t("node.applyEdlEdlIn")}    color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="left"  top="24px"              accepts={ACCEPTS_JSON} />
      <HandleWithPopover nodeId={id} nodeType="speaker-view" handleId="transcript" type="target" position={Position.Left}  label={t("node.transcript")}       color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="left"  top="52px"              accepts={ACCEPTS_JSON} />
      <HandleWithPopover nodeId={id} nodeType="speaker-view" handleId="video"      type="source" position={Position.Right} label={t("node.applyEdlVideoOut")} color={HANDLE_COLORS.video}     icon={<Film />}   side="right" top="calc(100% - 24px)" />
      <HandleWithPopover nodeId={id} nodeType="speaker-view" handleId="json"       type="source" position={Position.Right} label={t("node.applyEdlEdlIn")}    color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
    </div>
  )
}

export const SpeakerViewNode = memo(SpeakerViewNodeComponent)
