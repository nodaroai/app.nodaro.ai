"use client"

import { hasCredits } from "@/lib/edition"

import { useT, tx } from "@/lib/i18n"
import { memo, useState, useMemo, useEffect } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Clapperboard, Loader2, AlertCircle, AlertTriangle, Type, Image as ImageIcon, Images, Film, Minus, Volume2, Music, Users, Aperture, Sparkles, Copy, ListChecks } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { GvpContinueControl } from "./gvp-continue-control"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { EditableNodeLabel } from "./editable-node-label"
import { NodeJobProgress } from "./node-job-progress"
import { VideoResultOverlay } from "./video-result-overlay"
import { useInlinePromptActive } from "./inline-node-prompt/use-inline-prompt-active"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getJobStatusLean } from "@/lib/api"
import { useModelCredits, useVideoProCredits } from "@/ee/hooks/use-model-credits"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "./video-node-defaults"
import { isValidGenerateVideoProConnection } from "@/lib/generate-video-pro-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared"
import { estimateGenerateVideoProCredits } from "@/components/editor/workflow-editor/types"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { GenerateVideoProNodeData, GeneratedResult, ContentPolicyRewriteEntry } from "@/types/nodes"

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

// FULL 11-pip stack — generate-video's EXACT cluster layout (28px within a
// cluster, 40px between clusters), measured up from the PREVIEW's bottom edge:
//   Text:    prompt(24) → negative(52)
//   Image:   start(92) → end(120) → imgRefs(148) → vidRefs(176)
//   Audio:   audio(216) → audioRefs(244)
//   Pickers: assets(284) → elements(312) → look(340)
// In inline-prompt mode the editor sits BELOW the preview as card chrome, so
// every pip additionally lifts by the measured chrome height (see `handleTop`
// in the component) — exactly like generate-video — instead of spreading down
// beside the prompt.
const HANDLE_OFFSET = {
  prompt: 24,
  negative: 52,
  startFrame: 92,
  endFrame: 120,
  imageReferences: 148,
  videoReferences: 176,
  audio: 216,
  audioReferences: 244,
  assets: 284,
  elements: 312,
  look: 340,
} as const

function GenerateVideoProNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as GenerateVideoProNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)

  // Inline-mode state — mirrors generate-video. BaseNode owns the inline
  // prompt editor and its measurement; this node keeps `showInline` (pure,
  // shared hook) for the result layout + card chrome, and `chromeHeight` (fed
  // by BaseNode via `onChromeHeightChange`) so the bottom-anchored input pips
  // sit beside the PREVIEW, above the editor. Before this the pips ignored
  // the chrome and a delivered result blanketed the drawer (2026-09-16).
  const showInline = useInlinePromptActive("generate-video-pro")
  const [chromeHeight, setChromeHeight] = useState(0)
  const handleTop = (px: number) =>
    showInline ? `calc(100% - ${chromeHeight}px - ${px}px)` : `calc(100% - ${px}px)`

  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [videoError, setVideoError] = useState(false)

  const status = (nodeData.executionStatus as string | undefined) ?? "idle"
  const results = (nodeData.generatedResults as GeneratedResult[] | undefined) ?? []
  const activeIndex = (nodeData.activeResultIndex as number | undefined) ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? (nodeData.generatedVideoUrl as string | undefined)

  // CONTENT-POLICY DISCLOSURE (Task A4, 2026-08-03): the GVP plugin's
  // finalize.ts surfaces a segment's disclosed rewrite-and-retry as a
  // top-level `contentPolicyRewrites` array on the completed job's result
  // JSON — non-fatal, the delivered video is valid and billed. Read it the
  // same way `videoUrl` is read: the ACTIVE result first (so browsing an
  // older, non-rewritten result via history never shows a stale notice),
  // falling back to the top-level node field (mirrors
  // GeneratedResult.warningMessage's exact convention — see ai-avatar-node.tsx).
  // The node-data field is wired by execute-node's gvpProExtractor (live run)
  // and the reload/resume readers (reconcile-completed-jobs.ts,
  // run-handlers.ts's applyRestoredJobCompletion, use-workflow-persistence.ts's
  // syncNodeResultsFromDB) — see GenerateVideoProNodeData.contentPolicyRewrites
  // for the full path list. `GeneratedResult` itself doesn't declare the
  // field (kept off that shared 40+-node-type interface), hence the cast.
  const contentPolicyRewrites =
    (activeResult as unknown as { contentPolicyRewrites?: ContentPolicyRewriteEntry[] } | undefined)
      ?.contentPolicyRewrites ??
    nodeData.contentPolicyRewrites ??
    []
  const contentPolicyNotice =
    contentPolicyRewrites.length > 0
      ? t(contentPolicyRewrites.length > 1 ? "node.segmentPromptAdjustedMany" : "node.segmentPromptAdjustedOne", { segments: contentPolicyRewrites.map((r) => r.segment).join(", ") })
      : undefined

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
            errorMessage: job.error_message ?? tx("node.planningFailed"),
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
  const liveEstimate = useVideoProCredits(nodeData)
  const needsQuote = hasCredits() && nodeData.segmentMode !== undefined
  const credits = needsQuote ? liveEstimate.data?.credits : estimateGenerateVideoProCredits(nodeData)

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
      { id: "prompt",          type: "target" as const, position: Position.Left,  customStyle: { top: handleTop(HANDLE_OFFSET.prompt),          left: "-29px" }, external: true },
      { id: "negative",        type: "target" as const, position: Position.Left,  customStyle: { top: handleTop(HANDLE_OFFSET.negative),        left: "-29px" }, external: true },
      { id: "startFrame",      type: "target" as const, position: Position.Left,  customStyle: { top: handleTop(HANDLE_OFFSET.startFrame),      left: "-29px" }, external: true },
      { id: "endFrame",        type: "target" as const, position: Position.Left,  customStyle: { top: handleTop(HANDLE_OFFSET.endFrame),        left: "-29px" }, external: true },
      { id: "imageReferences", type: "target" as const, position: Position.Left,  customStyle: { top: handleTop(HANDLE_OFFSET.imageReferences), left: "-29px" }, external: true },
      { id: "videoReferences", type: "target" as const, position: Position.Left,  customStyle: { top: handleTop(HANDLE_OFFSET.videoReferences), left: "-29px" }, external: true },
      { id: "audio",           type: "target" as const, position: Position.Left,  customStyle: { top: handleTop(HANDLE_OFFSET.audio),           left: "-29px" }, external: true },
      { id: "audioReferences", type: "target" as const, position: Position.Left,  customStyle: { top: handleTop(HANDLE_OFFSET.audioReferences), left: "-29px" }, external: true },
      { id: "assets",          type: "target" as const, position: Position.Left,  customStyle: { top: handleTop(HANDLE_OFFSET.assets),          left: "-29px" }, external: true },
      { id: "elements",        type: "target" as const, position: Position.Left,  customStyle: { top: handleTop(HANDLE_OFFSET.elements),        left: "-29px" }, external: true },
      { id: "look",            type: "target" as const, position: Position.Left,  customStyle: { top: handleTop(HANDLE_OFFSET.look),            left: "-29px" }, external: true },
      { id: "video",           type: "source" as const, position: Position.Right, customStyle: { top: "24px",                     right: "-29px" }, external: true },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showInline, chromeHeight],
  )

  // Re-register handles with React Flow on changes (the pips move when the
  // inline chrome grows) — edges to new handles render unreliably otherwise
  // (mirrors every other typed-handle node).
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, handles, updateNodeInternals])

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  // Video result: rich player overlay — same shared component the other
  // video-result nodes use (expand / download / copy / save / settings /
  // edit-in-FreeCut). Rendered in ONE of two places (never both): inside the
  // preview box in inline mode, over the whole transparent card otherwise.
  const resultOverlay = hasVideoResult ? (
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
      squareBottom={showInline}
    />
  ) : null

  // CONTENT-POLICY DISCLOSURE (Task A4, 2026-08-03): non-fatal notice —
  // same convention as GeneratedResult.warningMessage (ai-avatar-node.tsx):
  // amber, AlertTriangle, always visible (not hover-gated). Layered above
  // VideoResultOverlay's own z-10 wrapper so it's never hidden behind it.
  const policyNotice = hasVideoResult && contentPolicyNotice ? (
    <div className="absolute inset-x-2 top-2 z-20 flex items-start gap-1.5 rounded-md bg-amber-500/90 backdrop-blur-sm px-2 py-1.5 text-[10px] text-amber-950 shadow-sm">
      <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
      <span className="leading-snug line-clamp-3">{contentPolicyNotice}</span>
    </div>
  ) : null

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
        // Result fills the node transparently (no card chrome) ONLY in the
        // non-inline layout. In inline mode the prompt editor + run strip sit
        // below the preview inside the card, so the card border/background must
        // stay to back that chrome (same rule as generate-video).
        className={!showInline && hasVideoResult ? "!border-0 !shadow-none !bg-transparent" : undefined}
        hideHeader
        // Shared video-node sizing: 16:9 @ VIDEO_NODE_MIN_HEIGHT (≈654×368) when
        // idle, snaps to the real result aspect once a result loads.
        {...videoNodeSizing(mediaAspectRatio)}
        onChromeHeightChange={setChromeHeight}
        handles={handles}
        // Standard quick strip (never rawToolbarContent) — never gated behind
        // !isRunning so Stop/Discard stays visible mid-run. The Continue control
        // self-hides unless the last run was a stopped/partial delivery.
        topToolbarContent={
          <NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"}
            disabled={needsQuote && !liveEstimate.data}
            disabledReason={liveEstimate.isError ? t("vidcfg.segmentMode.quoteError") : t("vidcfg.segmentMode.quoting")}>
            <GvpContinueControl nodeId={id} />
          </NodeQuickStrip>
        }
      >
        {hasVideoResult ? (
          showInline ? (
            // Inline mode: the result covers only the PREVIEW (this relative
            // box), never the prompt editor BaseNode renders below it — the
            // node-level absolute overlay would blanket the whole card, drawer
            // included (the "prompt drawer not shown" report).
            <div className="relative w-full h-full">
              {resultOverlay}
              {policyNotice}
            </div>
          ) : null
        ) : (
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
                  <span className="font-medium">{t("node.failed")}</span>
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
                    {t((planSegments.length || plan.segmentCount) === 1 ? "node.planSegmentsOne" : "node.planSegmentsMany", { n: planSegments.length || plan.segmentCount || 0 })}
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
                    <div className="px-2 py-1 text-muted-foreground/60">{t("node.planReadyCopyJson")}</div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={t("node.copyPlanJson")}
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

      {/* Non-inline layout: the result overlay + notice fill the transparent
          node. (Inline mode renders both inside the preview box above.) */}
      {!showInline && resultOverlay}
      {!showInline && policyNotice}

      {/* FULL 11 typed input pips + 1 output pip — generate-video's exact
          set, order, colors, and icons (parity by construction; see
          generate-video-pro-handles.ts). The one semantic delta:
          videoReferences here is the EXTEND SOURCE (limit 1). */}
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="prompt"          type="target" position={Position.Left}  label="Prompt"        color={TEXT_HANDLE_COLOR}      icon={<Type />}      side="left"  top={handleTop(HANDLE_OFFSET.prompt)}          accepts={ACCEPTS_PROMPT} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="negative"        type="target" position={Position.Left}  label="Negative"      color={HANDLE_COLORS.negative} icon={<Minus />}     side="left"  top={handleTop(HANDLE_OFFSET.negative)}        accepts={ACCEPTS_NEGATIVE} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="startFrame"      type="target" position={Position.Left}  label="Start Frame"   color={HANDLE_COLORS.image}    icon={<ImageIcon />} side="left"  top={handleTop(HANDLE_OFFSET.startFrame)}      accepts={ACCEPTS_START_FRAME} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="endFrame"        type="target" position={Position.Left}  label="End Frame"     color={HANDLE_COLORS.endFrame} icon={<ImageIcon />} side="left"  top={handleTop(HANDLE_OFFSET.endFrame)}        accepts={ACCEPTS_END_FRAME} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="imageReferences" type="target" position={Position.Left}  label="Image Refs"    color={HANDLE_COLORS.imageRef} icon={<Images />}    side="left"  top={handleTop(HANDLE_OFFSET.imageReferences)} orderMatters accepts={ACCEPTS_IMAGE_REFS} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="videoReferences" type="target" position={Position.Left}  label="Extend Source" color={HANDLE_COLORS.video}    icon={<Film />}      side="left"  top={handleTop(HANDLE_OFFSET.videoReferences)} accepts={ACCEPTS_VIDEO_REFS} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="audio"           type="target" position={Position.Left}  label="Audio"         color={HANDLE_COLORS.audio}    icon={<Volume2 />}   side="left"  top={handleTop(HANDLE_OFFSET.audio)}           accepts={ACCEPTS_AUDIO} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="audioReferences" type="target" position={Position.Left}  label="Audio Refs"    color={HANDLE_COLORS.audioRef} icon={<Music />}     side="left"  top={handleTop(HANDLE_OFFSET.audioReferences)} orderMatters accepts={ACCEPTS_AUDIO_REFS} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="assets"          type="target" position={Position.Left}  label="Assets"        color={HANDLE_COLORS.identity} icon={<Users />}     side="left"  top={handleTop(HANDLE_OFFSET.assets)}          orderMatters accepts={ACCEPTS_ASSETS} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="elements"        type="target" position={Position.Left}  label="Elements"      color={HANDLE_COLORS.look}     icon={<Sparkles />}  side="left"  top={handleTop(HANDLE_OFFSET.elements)}        accepts={ACCEPTS_ELEMENTS} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="look"            type="target" position={Position.Left}  label="Look"          color={HANDLE_COLORS.look}     icon={<Aperture />}  side="left"  top={handleTop(HANDLE_OFFSET.look)}            accepts={ACCEPTS_LOOK} />
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
