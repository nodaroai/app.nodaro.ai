"use client"

import { memo, useState, useMemo, useEffect } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Clapperboard, Loader2, AlertCircle, Type, Image as ImageIcon, Images, Film, Minus, Volume2, Music, Users, Aperture, Sparkles, Copy, ListChecks } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { GvpContinueControl } from "./gvp-continue-control"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { EditableNodeLabel } from "./editable-node-label"
import { NodeJobProgress } from "./node-job-progress"
import { VideoResultOverlay } from "./video-result-overlay"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getJobStatusLean } from "@/lib/api"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "./video-node-defaults"
import { isValidGenerateVideoProConnection } from "@/lib/generate-video-pro-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared"
import { estimateGenerateVideoProCredits } from "@/components/editor/workflow-editor/types"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { GenerateVideoProNodeData, GeneratedResult } from "@/types/nodes"

// Stable, module-level `accepts` predicates — see generate-image-node.tsx /
// generate-video-node.tsx for why these live outside the component (avoids a
// fresh arrow ref on every render busting HandleWithPopover's useMemo).
const isPickerType = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_PROMPT      = (t: string) => isValidGenerateVideoProConnection("prompt", t, isPickerType)
const ACCEPTS_NEGATIVE    = (t: string) => isValidGenerateVideoProConnection("negative", t, isPickerType)
const ACCEPTS_START_FRAME = (t: string) => isValidGenerateVideoProConnection("startFrame", t, isPickerType)
const ACCEPTS_END_FRAME   = (t: string) => isValidGenerateVideoProConnection("endFrame", t, isPickerType)
const ACCEPTS_IMAGE_REFS  = (t: string) => isValidGenerateVideoProConnection("imageReferences", t, isPickerType)
const ACCEPTS_VIDEO_REFS  = (t: string) => isValidGenerateVideoProConnection("videoReferences", t, isPickerType)
const ACCEPTS_AUDIO       = (t: string) => isValidGenerateVideoProConnection("audio", t, isPickerType)
const ACCEPTS_AUDIO_REFS  = (t: string) => isValidGenerateVideoProConnection("audioReferences", t, isPickerType)
const ACCEPTS_ASSETS      = (t: string) => isValidGenerateVideoProConnection("assets", t, isPickerType)
const ACCEPTS_LOOK        = (t: string) => isValidGenerateVideoProConnection("look", t, isPickerType)
const ACCEPTS_ELEMENTS    = (t: string) => isValidGenerateVideoProConnection("elements", t, isPickerType)

// FULL 11-pip stack — generate-video's EXACT cluster layout (its
// HANDLE_OFFSET map: 28px within a cluster, 40px between clusters):
//   Text:    prompt(24) → negative(52)
//   Image:   start(92) → end(120) → imgRefs(148) → vidRefs(176)
//   Audio:   audio(216) → audioRefs(244)
//   Pickers: assets(284) → elements(312) → look(340)
// gvp has no inline-prompt mode, so the offsets are static (no chrome shift).
const HANDLE_TOP = {
  prompt: "calc(100% - 24px)",
  negative: "calc(100% - 52px)",
  startFrame: "calc(100% - 92px)",
  endFrame: "calc(100% - 120px)",
  imageReferences: "calc(100% - 148px)",
  videoReferences: "calc(100% - 176px)",
  audio: "calc(100% - 216px)",
  audioReferences: "calc(100% - 244px)",
  assets: "calc(100% - 284px)",
  elements: "calc(100% - 312px)",
  look: "calc(100% - 340px)",
} as const

function GenerateVideoProNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as GenerateVideoProNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)

  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [videoError, setVideoError] = useState(false)

  const status = (nodeData.executionStatus as string | undefined) ?? "idle"
  const results = (nodeData.generatedResults as GeneratedResult[] | undefined) ?? []
  const activeIndex = (nodeData.activeResultIndex as number | undefined) ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? (nodeData.generatedVideoUrl as string | undefined)
  const provider = nodeData.provider ?? "seedance-2"

  // PLAN-ONLY result — the engine's full per-segment configuration (no video).
  const plan = nodeData.generatedPlan as
    | {
        plannerModel?: string
        totalDurationSec?: number
        segmentCount?: number
        segments?: Array<{ index: number; prompt?: string; duration?: number; transition?: string }>
      }
    | undefined
  const planSegments = Array.isArray(plan?.segments) ? plan.segments : []

  // Reset the video-error gate whenever the active result changes (mirrors
  // voice-changer-pro-node.tsx) so a stale error doesn't hide a fresh result.
  useEffect(() => {
    setVideoError(false)
  }, [activeUrl])

  // PLAN-ONLY refresh-resume: the executor's inline poll dies with the page.
  // Media jobs have the My Library backstop, but a plan exists ONLY in the
  // job's output_data — after a reload a node saved mid-run would stay
  // "running" forever with a completed plan nobody can see (user-hit on the
  // feature's first prod run). While this node mounts running a plan-only
  // job, poll lean status and hydrate the terminal state. Idempotent next to
  // a live executor poll: both write the same terminal fields, and the effect
  // stops itself the moment status leaves "running".
  const planResumeJobId = status === "running" && nodeData.planOnly === true ? (nodeData.currentJobId as string | undefined) : undefined
  useEffect(() => {
    if (!planResumeJobId) return
    let stopped = false
    const t = setInterval(async () => {
      try {
        const job = await getJobStatusLean(planResumeJobId)
        if (stopped) return
        if (job.status === "completed") {
          const plan = (job.output_data as Record<string, unknown> | undefined)?.plan
          updateNodeData(id, {
            executionStatus: "completed",
            generatedPlan: plan as Record<string, unknown> | undefined,
            currentJobId: undefined,
            currentJobProgress: undefined,
          })
        } else if (job.status === "failed") {
          updateNodeData(id, {
            executionStatus: "failed",
            errorMessage: job.error_message ?? "Planning failed",
            currentJobId: undefined,
            currentJobProgress: undefined,
          })
        }
      } catch {
        /* transient poll failure — keep trying while mounted */
      }
    }, 3000)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [planResumeJobId, id, updateNodeData])

  // Run-strip credit estimate via the SAME closed-form the popup badge and
  // the backend reservation use (fee + first segment at the no-ref rate +
  // remaining seconds and tail overlaps at the ref rate for multi-segment
  // runs; the plain single-segment composite below 15s). The useModelCredits
  // calls both SUBSCRIBE this component to the live prices and WARM the
  // shared react-query cache estimateGenerateVideoProCredits reads — their
  // return values are intentionally unused. Previously the strip showed the
  // single-segment 8s composite regardless of duration, so a 60s run
  // displayed ~1/6th of the real reservation (user bug report).
  const resolution = nodeData.resolution || "720p"
  const creditIdentifier = buildVideoCreditModelIdentifier(
    provider,
    nodeData.duration,
    false,
    "text-to-video",
    undefined,
    nodeData.resolution,
    false,
  )
  useModelCredits(creditIdentifier, 82)
  useModelCredits(`${provider}:8s:${resolution}`, 82)
  useModelCredits(`${provider}:8s:${resolution}-ref`, 50)
  useModelCredits("generate-video-pro", 10)
  const credits = estimateGenerateVideoProCredits(nodeData)

  // Result-aspect-ratio for the BaseNode minHeight calc + video-element sizing.
  const { aspectRatio: mediaAspectRatio, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)

  // Video result fills the node transparently (no card chrome) once a
  // playable result exists — same convention as every other video node.
  const hasVideoResult = status !== "running" && !!activeUrl && !videoError

  // BaseNode handles array. `external: true` so BaseNode counts the handle
  // toward node sizing but does NOT render a duplicate <Handle> — the
  // HandleWithPopover instances below own DOM rendering.
  const handles = useMemo(
    () => [
      { id: "prompt",          type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.prompt,          left: "-29px" }, external: true },
      { id: "negative",        type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.negative,        left: "-29px" }, external: true },
      { id: "startFrame",      type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.startFrame,      left: "-29px" }, external: true },
      { id: "endFrame",        type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.endFrame,        left: "-29px" }, external: true },
      { id: "imageReferences", type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.imageReferences, left: "-29px" }, external: true },
      { id: "videoReferences", type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.videoReferences, left: "-29px" }, external: true },
      { id: "audio",           type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.audio,           left: "-29px" }, external: true },
      { id: "audioReferences", type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.audioReferences, left: "-29px" }, external: true },
      { id: "assets",          type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.assets,          left: "-29px" }, external: true },
      { id: "elements",        type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.elements,        left: "-29px" }, external: true },
      { id: "look",            type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.look,            left: "-29px" }, external: true },
      { id: "video",           type: "source" as const, position: Position.Right, customStyle: { top: "24px",                     right: "-29px" }, external: true },
    ],
    [],
  )

  // Re-register handles with React Flow on mount — edges to new handles
  // render unreliably otherwise (mirrors every other typed-handle node).
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, updateNodeInternals])

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  return (
    <div className="relative" style={{ width: "100%", height: "100%" }}>
      <EditableNodeLabel
        label={(nodeData.label as string) ?? "Generate Video Pro"}
        icon={<Clapperboard className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={(nodeData.label as string) ?? "Generate Video Pro"}
        icon={<Clapperboard className="h-4 w-4" />}
        category="i2v"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        className={hasVideoResult ? "!border-0 !shadow-none !bg-transparent" : undefined}
        hideHeader
        // Shared video-node sizing: 16:9 @ VIDEO_NODE_MIN_HEIGHT (≈654×368) when
        // idle, snaps to the real result aspect once a result loads.
        {...videoNodeSizing(mediaAspectRatio)}
        handles={handles}
        // Standard quick strip (never rawToolbarContent) — never gated behind
        // !isRunning so Stop/Discard stays visible mid-run. The Continue control
        // self-hides unless the last run was a stopped/partial delivery.
        topToolbarContent={
          <NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"}>
            <GvpContinueControl nodeId={id} />
          </NodeQuickStrip>
        }
      >
        {hasVideoResult ? null : (
          <div className="relative w-full h-full group/video">
            {status === "running" && (
              <div className="flex flex-col items-center justify-center gap-2 bg-muted/30 rounded-xl w-full h-full min-h-[80px]">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                <NodeJobProgress progress={nodeData.currentJobProgress as number | undefined} />
              </div>
            )}
            {status === "failed" && !activeUrl && (
              <div className="flex flex-col items-center justify-center gap-1 rounded-xl p-2 h-[180px] bg-red-500/5 text-red-500">
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="font-medium">Failed</span>
                </div>
                {nodeData.errorMessage ? (
                  <p
                    className="text-[10px] text-center line-clamp-2 text-red-400"
                    title={nodeData.errorMessage as string}
                  >
                    {nodeData.errorMessage as string}
                  </p>
                ) : null}
              </div>
            )}
            {/* PLAN-ONLY result: per-segment configuration table (mirrors the
                video-analysis scene-table pattern; copy button → full JSON). */}
            {status !== "running" && status !== "failed" && !activeUrl && plan && (
              <div className="relative group p-1.5">
                <div className="flex items-center gap-1.5 px-1 pb-1 text-[10px] font-medium text-muted-foreground">
                  <ListChecks className="w-3 h-3 shrink-0" />
                  <span>
                    Plan — {planSegments.length || plan.segmentCount || 0} segment{(planSegments.length || plan.segmentCount) === 1 ? "" : "s"}
                    {plan.totalDurationSec ? ` · ${plan.totalDurationSec}s` : ""}
                  </span>
                </div>
                <div className="rounded-md border bg-muted/30 text-[10px] max-h-40 overflow-y-auto divide-y divide-border/60">
                  {planSegments.map((s) => (
                    <div key={s.index} className="flex flex-col gap-0.5 px-2 py-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-muted-foreground tabular-nums">#{s.index + 1}</span>
                        {s.duration != null && <span className="text-muted-foreground/70 tabular-nums">{s.duration}s</span>}
                        {s.transition && <span className="text-muted-foreground/60 uppercase text-[9px] tracking-wide">{s.transition}</span>}
                      </div>
                      {s.prompt && <span className="text-muted-foreground/70 line-clamp-2">{s.prompt}</span>}
                    </div>
                  ))}
                  {planSegments.length === 0 && (
                    <div className="px-2 py-1 text-muted-foreground/60">Plan ready — copy JSON for details</div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Copy plan JSON"
                  className="absolute top-0.5 right-0.5 w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    navigator.clipboard.writeText(JSON.stringify(nodeData.generatedPlan, null, 2))
                  }}
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            )}
            {status !== "running" && !activeUrl && status !== "failed" && !plan && (
              <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px]">
                <Clapperboard className="w-10 h-10" />
              </div>
            )}
          </div>
        )}
      </BaseNode>

      {/* Video result: rich player overlay filling the transparent node —
          same shared component the other video-result nodes use (expand /
          download / copy / save / settings / edit-in-FreeCut). */}
      {hasVideoResult && (
        <VideoResultOverlay
          url={activeUrl!}
          videoAutoplay={videoAutoplay}
          label={(nodeData.label as string) ?? "Generate Video Pro"}
          hasResults={results.length > 0}
          onExpand={() => setPreviewOpen(true)}
          onDelete={() => setDeleteConfirm(activeIndex)}
          onEdit={() => openFreeCut(id, activeUrl!, activeResult?.freecutProjectUrl)}
          onRawDimensions={handleLoadDimensions}
          onVideoError={() => setVideoError(true)}
          onVideoLoad={() => setVideoError(false)}
          onSettings={() => selectNode(isSettingsOpen ? null : id)}
          isSettingsOpen={isSettingsOpen}
        />
      )}

      {/* FULL 11 typed input pips + 1 output pip — generate-video's exact
          set, order, colors, and icons (parity by construction; see
          generate-video-pro-handles.ts). The one semantic delta:
          videoReferences here is the EXTEND SOURCE (limit 1). */}
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="prompt"          type="target" position={Position.Left}  label="Prompt"        color={TEXT_HANDLE_COLOR}      icon={<Type />}      side="left"  top={HANDLE_TOP.prompt}          accepts={ACCEPTS_PROMPT} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="negative"        type="target" position={Position.Left}  label="Negative"      color={HANDLE_COLORS.negative} icon={<Minus />}     side="left"  top={HANDLE_TOP.negative}        accepts={ACCEPTS_NEGATIVE} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="startFrame"      type="target" position={Position.Left}  label="Start Frame"   color={HANDLE_COLORS.image}    icon={<ImageIcon />} side="left"  top={HANDLE_TOP.startFrame}      accepts={ACCEPTS_START_FRAME} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="endFrame"        type="target" position={Position.Left}  label="End Frame"     color={HANDLE_COLORS.endFrame} icon={<ImageIcon />} side="left"  top={HANDLE_TOP.endFrame}        accepts={ACCEPTS_END_FRAME} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="imageReferences" type="target" position={Position.Left}  label="Image Refs"    color={HANDLE_COLORS.imageRef} icon={<Images />}    side="left"  top={HANDLE_TOP.imageReferences} orderMatters accepts={ACCEPTS_IMAGE_REFS} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="videoReferences" type="target" position={Position.Left}  label="Extend Source" color={HANDLE_COLORS.video}    icon={<Film />}      side="left"  top={HANDLE_TOP.videoReferences} accepts={ACCEPTS_VIDEO_REFS} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="audio"           type="target" position={Position.Left}  label="Audio"         color={HANDLE_COLORS.audio}    icon={<Volume2 />}   side="left"  top={HANDLE_TOP.audio}           accepts={ACCEPTS_AUDIO} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="audioReferences" type="target" position={Position.Left}  label="Audio Refs"    color={HANDLE_COLORS.audioRef} icon={<Music />}     side="left"  top={HANDLE_TOP.audioReferences} orderMatters accepts={ACCEPTS_AUDIO_REFS} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="assets"          type="target" position={Position.Left}  label="Assets"        color={HANDLE_COLORS.identity} icon={<Users />}     side="left"  top={HANDLE_TOP.assets}          orderMatters accepts={ACCEPTS_ASSETS} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="elements"        type="target" position={Position.Left}  label="Elements"      color={HANDLE_COLORS.look}     icon={<Sparkles />}  side="left"  top={HANDLE_TOP.elements}        accepts={ACCEPTS_ELEMENTS} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="look"            type="target" position={Position.Left}  label="Look"          color={HANDLE_COLORS.look}     icon={<Aperture />}  side="left"  top={HANDLE_TOP.look}            accepts={ACCEPTS_LOOK} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="video"           type="source" position={Position.Right} label="Video"         color={HANDLE_COLORS.video}    icon={<Film />}      side="right" top="24px" />

      {activeUrl && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type="video"
          url={activeUrl}
          results={results}
          initialIndex={activeIndex}
        />
      )}

      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
        }}
      />
    </div>
  )
}

export const GenerateVideoProNode = memo(GenerateVideoProNodeComponent)
