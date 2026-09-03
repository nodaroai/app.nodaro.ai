"use client"

import { useT } from "@/lib/i18n"
import { memo, useCallback, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Position, type NodeProps } from "@xyflow/react"
import { SearchCheck, Film, Braces, Type, Loader2, AlertCircle, Copy, Expand, X } from "lucide-react"
import { JsonTree, type JsonValue } from "@/components/ui/json-tree"
import { useAnalysisLabeler } from "./analysis-json-labeler"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { NodeJobProgress } from "./node-job-progress"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { useUpstreamVideoDuration } from "@/hooks/use-upstream-video-duration"
import { useUpstreamVideoProbe } from "@/hooks/use-upstream-video-probe"
import { ACCEPTS_VIDEO } from "@/lib/ffmpeg-handles"
import { ACCEPTS_ANALYSIS, DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { buildVideoAuditCreditId } from "@nodaro/shared"
// ONE family rule for the badge, the canvas total and the run-confirm dialog —
// see videoAuditAnalysisWired's doc comment.
import { videoAuditAnalysisWired } from "@/components/editor/workflow-editor/types"
import type { VideoAuditNodeData, VideoAuditReport } from "@/types/nodes"

/** Fixed reading order for the disclosure counts — what changed, what the
 *  guards refused, what is merely flagged. Never alphabetical: "corrected"
 *  first is the whole point of a fix-and-disclose report. */
const FINDING_KINDS = ["corrected", "refused", "watch"] as const

/** `3 corrected · 1 refused · 2 watch` — zero-count kinds are dropped so a
 *  clean audit reads as "nothing changed" instead of three zeroes. */
function summariseFindings(report: VideoAuditReport): string {
  const counts = new Map<string, number>()
  for (const f of report.findings) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1)
  const parts = FINDING_KINDS.filter((k) => (counts.get(k) ?? 0) > 0).map((k) => `${counts.get(k)} ${k}`)
  return parts.length > 0 ? parts.join(" · ") : "nothing changed"
}

/** The node's report strip — the summary sentence plus the counts by kind.
 *  Also shown inside the expanded modal, so it is one component. */
function AuditReportStrip({ report, compact }: { readonly report: VideoAuditReport; readonly compact?: boolean }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2 py-1.5 flex flex-col gap-1 shrink-0">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground tabular-nums">
        <SearchCheck className="w-3 h-3 shrink-0" />
        <span>{summariseFindings(report)}</span>
        {/* The run's OWN truth about which credit family it billed — the wired
            state can change after the fact, the report can't. */}
        {report.autoAnalysis && <span className="ml-auto shrink-0">ran its own analysis</span>}
      </div>
      {report.summary && (
        <p
          className={`text-[10px] leading-snug text-foreground/80 ${compact ? "line-clamp-3" : ""}`}
          title={report.summary}
        >
          {report.summary}
        </p>
      )}
    </div>
  )
}

function ResultTreeModal({
  isOpen, onClose, result, report, labelFor,
}: {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly result: unknown
  readonly report: VideoAuditReport | undefined
  readonly labelFor: ReturnType<typeof useAnalysisLabeler>
}) {
  const t = useT()
  if (!isOpen) return null
  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-8" onClick={onClose}>
      <div
        className="relative w-full max-w-3xl max-h-[85vh] bg-background rounded-lg border border-border shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <SearchCheck className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("node.aiAudit")}</span>
            {report && (
              <span className="text-xs text-muted-foreground tabular-nums">{summariseFindings(report)}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors"
              onClick={() => navigator.clipboard.writeText(JSON.stringify(result, null, 2))}
            >
              {t("cfgext.scrapeCopyJson")}
            </button>
            <button type="button" aria-label="Close" className="text-muted-foreground hover:text-foreground" onClick={onClose}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="overflow-auto p-4 flex flex-col gap-3">
          {report && <AuditReportStrip report={report} />}
          <JsonTree value={result as JsonValue} labelFor={labelFor} className="text-[11px]" />
        </div>
      </div>
    </div>,
    document.body,
  )
}

function VideoAuditNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as VideoAuditNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"
  // The corrected analysis — the SAME canonical shape video-analysis emits, so
  // it renders through the same labeler and wires into the same consumers.
  const result = nodeData.generatedJson
  const scenes = result?.scenes ?? []
  const report = nodeData.lastAuditReport

  // WHICH CREDIT FAMILY: an analysis wired into the `analysis` handle prices
  // under `video-audit` (re-audit only); nothing wired prices under
  // `video-audit:auto` — the node runs a fast analysis itself first. This is a
  // GRAPH fact, not a node-data field, so it is read from the edges.
  const analysisWired = useWorkflowStore(
    useCallback((s) => videoAuditAnalysisWired(id, s.edges), [id]),
  )

  // Duration for the credit-bucket estimate, same ladder and same fallbacks as
  // video-analysis: the wired producer's own duration field, else the video's
  // probed metadata, else undefined → buildVideoAuditCreditId's 600s ceiling.
  // Display only; the route re-probes and the reserve is computed server-side.
  const upstreamDuration = useUpstreamVideoDuration(id, "video")
  const probedVideoDuration = useUpstreamVideoProbe(id, "video", nodeData.probedVideo, updateNodeData)
  const creditModelId = useMemo(
    () =>
      buildVideoAuditCreditId({
        analysisProvided: analysisWired,
        durationSec: upstreamDuration ?? probedVideoDuration ?? undefined,
      }),
    [analysisWired, upstreamDuration, probedVideoDuration],
  )
  const credits = useModelCredits(creditModelId)
  const [treeOpen, setTreeOpen] = useState(false)
  const labelFor = useAnalysisLabeler(result)

  return (
    <div className="relative max-w-[240px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<SearchCheck className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<SearchCheck className="h-4 w-4" />}
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
          { id: "analysis", type: "target", position: Position.Left,  customStyle: { top: '24px',              left: '-29px' },  external: true },
          { id: "video",    type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' },  external: true },
          { id: "json",     type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
          { id: "text",     type: "source", position: Position.Right, customStyle: { top: '52px',              right: '-29px' }, external: true },
        ]}
      >
        <div className="flex flex-col gap-2 p-3 h-full" style={{ minHeight: 160 }}>
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
                <span className="font-medium">{t("node.failed")}</span>
              </div>
              {nodeData.errorMessage && (
                <p className="text-[10px] text-center text-red-400 line-clamp-2" title={nodeData.errorMessage}>
                  {nodeData.errorMessage}
                </p>
              )}
            </div>
          )}

          {/* The disclosure strip is what a user reads first — it sits ABOVE the
              corrected payload, and survives even when the tree is empty. */}
          {status !== "running" && report && <AuditReportStrip report={report} compact />}

          {status !== "running" && result && scenes.length > 0 && (
            <div className="relative group flex-1 min-h-0 flex flex-col">
              {/* Same tree presentation (and the same `nowheel nodrag nopan`
                  scroll contract) as video-analysis: the audited payload IS an
                  analysis, so it is read the same way. See video-analysis-node
                  for why each of those three classes is load-bearing. */}
              <div className="rounded-md border bg-muted/30 flex-1 min-h-0 overflow-auto p-1.5 nowheel nodrag nopan scrollbar-reveal">
                <JsonTree value={result as unknown as JsonValue} labelFor={labelFor} />
              </div>
              <div className="absolute -top-1 -right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  aria-label={t("node.expandResult")}
                  className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => { e.stopPropagation(); setTreeOpen(true) }}
                >
                  <Expand className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  aria-label={t("cfgext.scrapeCopyJson")}
                  className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    navigator.clipboard.writeText(JSON.stringify(result, null, 2))
                  }}
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {status !== "running" && status !== "failed" && scenes.length === 0 && !report && (
            <div
              className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40"
              style={{ minHeight: 120, flex: 1 }}
            >
              <SearchCheck className="w-6 h-6" />
              <span className="text-[10px]">{t("node.connectAVideoToAudit")}</span>
            </div>
          )}

          {/* Honest pre-run disclosure of the pricier family. Hidden while
              running (the strip's own `autoAnalysis` reports the run's truth). */}
          {status !== "running" && !analysisWired && (
            <p className="text-[10px] leading-snug text-muted-foreground/70 shrink-0">
              No analysis wired — this node runs its own fast analysis first, which costs more credits.
            </p>
          )}
        </div>
      </BaseNode>
      {/* An audited analysis is still an analysis — the `analysis` target takes
          a video-analysis (or another audit) result, and this node re-emits the
          corrected one on the same `json`/`text` pair video-analysis uses. */}
      <HandleWithPopover nodeId={id} nodeType="video-audit" handleId="analysis" type="target" position={Position.Left}  label="Analysis"    color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="left"  top="24px"              accepts={ACCEPTS_ANALYSIS} />
      <HandleWithPopover nodeId={id} nodeType="video-audit" handleId="video"    type="target" position={Position.Left}  label="Video"       color={HANDLE_COLORS.video}     icon={<Film />}   side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_VIDEO} />
      <HandleWithPopover nodeId={id} nodeType="video-audit" handleId="json"     type="source" position={Position.Right} label={t("node.scenesJson")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="video-audit" handleId="text"     type="source" position={Position.Right} label="Text"        color={DATA_HANDLE_COLORS.text} icon={<Type />}   side="right" top="52px" />
      {result && (
        <ResultTreeModal isOpen={treeOpen} onClose={() => setTreeOpen(false)} result={result} report={report} labelFor={labelFor} />
      )}
    </div>
  )
}

export const VideoAuditNode = memo(VideoAuditNodeComponent)
