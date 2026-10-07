"use client"

import { memo, useMemo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ListTree, Braces, Film, Loader2, AlertCircle, Copy, Expand } from "lucide-react"
import { JsonTree, type JsonValue } from "@/components/ui/json-tree"
import { InspectorShell } from "@/components/inspector/inspector-shell"
import { EdlValidityBadge } from "@/components/inspector/edl-validity-badge"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { NodeJobProgress } from "./node-job-progress"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { useEditPlanEstimateDurationSec } from "@/hooks/use-edit-plan-estimate-duration"
import { ACCEPTS_MEDIA } from "@/lib/ffmpeg-handles"
import { ACCEPTS_JSON, DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { editPlanReserveCreditId, asEditPlanMode, asEditPlanTier } from "@nodaro/shared"
import { editPlanPerMinuteReported, useEditPlanModes } from "@/lib/edit-plan-modes"
import { useT } from "@/lib/i18n"
import { copyToClipboard } from "@/lib/utils"
import { editPlanOutputOf } from "@/lib/edit-plan-saved-output"
import type { EditPlanNodeData } from "@/types/nodes"

function EditPlanNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as EditPlanNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"
  // The plan as the person's review leaves it (TA13) — what the node hands
  // downstream, so the badge, the count and the tree describe what renders:
  // the edited cut, or the kept clips only.
  const plan = editPlanOutputOf(nodeData)?.json
  // clips mode emits a bare Edl[] (fans out); tighten/chapters emit an object.
  const clipCount = Array.isArray(plan) ? plan.length : undefined

  const mode = asEditPlanMode(nodeData.mode)
  const tier = asEditPlanTier(nodeData.planTier)
  // Duration for the credit-bucket estimate: the MASTER source's length, through
  // the same resolver the run-level estimates use (so the pill can't disagree
  // with them); unknown → the 180-minute ceiling — never a length
  // borrowed from the wired transcript (lib/edit-plan-estimate says why). The
  // reserve itself is computed server-side.
  const estimateDurationSec = useEditPlanEstimateDurationSec(id)
  // Per started minute once the server says its plugin charges that way
  // (decided 2026-10-07); the answer can land after the first render.
  const capabilityVersion = useEditPlanModes()
  const perMinute = editPlanPerMinuteReported()
  const creditModelId = useMemo(
    () => editPlanReserveCreditId(mode, tier, estimateDurationSec, perMinute),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- capabilityVersion re-reads the store
    [mode, tier, estimateDurationSec, perMinute, capabilityVersion],
  )
  const credits = useModelCredits(creditModelId)
  const [treeOpen, setTreeOpen] = useState(false)

  return (
    <div className="relative max-w-[240px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<ListTree className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<ListTree className="h-4 w-4" />}
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
          { id: "transcript", type: "target", position: Position.Left,  customStyle: { top: "24px",              left: "-29px" },  external: true },
          { id: "silence",    type: "target", position: Position.Left,  customStyle: { top: "52px",              left: "-29px" },  external: true },
          { id: "offsets",    type: "target", position: Position.Left,  customStyle: { top: "80px",              left: "-29px" },  external: true },
          { id: "sources",    type: "target", position: Position.Left,  customStyle: { top: "calc(100% - 24px)", left: "-29px" },  external: true },
          { id: "edl",        type: "source", position: Position.Right, customStyle: { top: "24px",              right: "-29px" }, external: true },
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

          {status !== "running" && plan !== undefined && plan !== null && (
            <div className="relative group flex-1 min-h-0 flex flex-col">
              <div className="flex items-center gap-2 pb-1">
                <EdlValidityBadge value={plan} />
                {clipCount !== undefined && (
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {t("node.editPlanClips", { count: clipCount })}
                  </span>
                )}
              </div>
              {/* nowheel/nodrag/nopan: same rationale as video-analysis — lets the
                  tree scroll inside the node instead of panning the canvas. */}
              <div className="rounded-md border bg-muted/30 flex-1 min-h-0 overflow-auto p-1.5 nowheel nodrag nopan scrollbar-reveal">
                <JsonTree value={plan as JsonValue} />
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
                    copyToClipboard(JSON.stringify(plan, null, 2), t("node.dataCopied"))
                  }}
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {status !== "running" && status !== "failed" && (plan === undefined || plan === null) && (
            <div
              className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40"
              style={{ minHeight: 120, flex: 1 }}
            >
              <ListTree className="w-6 h-6" />
              <span className="text-[10px]">{t("node.editPlanConnectTranscript")}</span>
            </div>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="edit-plan" handleId="transcript" type="target" position={Position.Left}  label={t("node.transcript")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="left"  top="24px"              accepts={ACCEPTS_JSON} />
      <HandleWithPopover nodeId={id} nodeType="edit-plan" handleId="silence"    type="target" position={Position.Left}  label={t("node.silence")}    color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="left"  top="52px"              accepts={ACCEPTS_JSON} />
      <HandleWithPopover nodeId={id} nodeType="edit-plan" handleId="offsets"    type="target" position={Position.Left}  label={t("node.editPlanOffsets")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="left"  top="80px"              accepts={ACCEPTS_JSON} />
      <HandleWithPopover nodeId={id} nodeType="edit-plan" handleId="sources"    type="target" position={Position.Left}  label={t("node.sources")}    color={HANDLE_COLORS.video}    icon={<Film />}   side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_MEDIA} orderMatters />
      <HandleWithPopover nodeId={id} nodeType="edit-plan" handleId="edl"        type="source" position={Position.Right} label={t("node.editPlanEdl")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
      {plan !== undefined && plan !== null && (
        <InspectorShell
          open={treeOpen}
          onClose={() => setTreeOpen(false)}
          icon={<ListTree />}
          title={nodeData.label}
          meta={<EdlValidityBadge value={plan} />}
          copyValue={plan}
        >
          <JsonTree value={plan as JsonValue} className="text-[11px]" />
        </InspectorShell>
      )}
    </div>
  )
}

export const EditPlanNode = memo(EditPlanNodeComponent)
