"use client"

import { memo, useState, useMemo, useEffect, useRef, useCallback } from "react"
import { Position, useUpdateNodeInternals, useStore, type NodeProps } from "@xyflow/react"
import {
  Clapperboard,
  Loader2,
  AlertCircle,
  X,
  Image as ImageIcon,
  Images,
  Volume2,
  Music,
  Download,
  LayoutGrid,
  Expand,
  Link,
  Scissors,
  Aperture,
  Sparkles,
  Users,
  Type,
  Minus,
  Film,
} from "lucide-react"
import { BaseNode } from "./base-node"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { EditableNodeLabel } from "./editable-node-label"
import { GenerateVideoQuickToolbar } from "./generate-video-quick-toolbar"
import { GenerateVideoResultInfo } from "./generate-video-result-info"
import { InlineNodePrompt } from "./inline-node-prompt/inline-node-prompt"
import { NodeJobProgress } from "./node-job-progress"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "./video-node-defaults"
import { isValidGenerateVideoConnection } from "@/lib/generate-video-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { getHandleConnectionLimit } from "@/lib/handle-limits"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared"
import { copyToClipboard, computeDeleteResultUpdates } from "@/lib/utils"
import type { GenerateVideoNodeData, GeneratedResult, WorkflowNode } from "@/types/nodes"

// Stable, module-level `accepts` predicates for each typed handle. Defining
// these outside the component avoids creating fresh arrow refs on every
// render — HandleWithPopover's `useMemo([..., accepts])` would otherwise
// bust every render. See generate-image-node.tsx for the same pattern.
const isPickerType = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_PROMPT          = (t: string) => isValidGenerateVideoConnection("prompt", t, isPickerType)
const ACCEPTS_NEGATIVE        = (t: string) => isValidGenerateVideoConnection("negative", t, isPickerType)
const ACCEPTS_STARTFRAME      = (t: string) => isValidGenerateVideoConnection("startFrame", t, isPickerType)
const ACCEPTS_ENDFRAME        = (t: string) => isValidGenerateVideoConnection("endFrame", t, isPickerType)
const ACCEPTS_IMAGE_REFS      = (t: string) => isValidGenerateVideoConnection("imageReferences", t, isPickerType)
const ACCEPTS_VIDEO_REFS      = (t: string) => isValidGenerateVideoConnection("videoReferences", t, isPickerType)
const ACCEPTS_AUDIO           = (t: string) => isValidGenerateVideoConnection("audio", t, isPickerType)
const ACCEPTS_AUDIO_REFS      = (t: string) => isValidGenerateVideoConnection("audioReferences", t, isPickerType)
const ACCEPTS_ASSETS          = (t: string) => isValidGenerateVideoConnection("assets", t, isPickerType)
const ACCEPTS_LOOK            = (t: string) => isValidGenerateVideoConnection("look", t, isPickerType)
const ACCEPTS_ELEMENTS        = (t: string) => isValidGenerateVideoConnection("elements", t, isPickerType)

// Grouped vertical positions: 28px within a cluster; 40px between clusters.
// Anchored 24px from the BOTTOM of the node, mirroring the output pip's 24px
// top inset for visual symmetry. Clusters stack upward so additional pips
// never disturb the primary "Prompt" pip at the visual bottom-left.
//
//   Text:    prompt(24) → negative(52)
//   Image:   start(92) → end(120) → imgRefs(148) → vidRefs(176)   (gap 40 → 92)
//   Audio:   audio(216) → audioRefs(244)                          (gap 40 → 216)
//   Pickers: assets(284) → elements(312) → look(340)              (gap 40 → 284)
//
// Stored as bottom-inset pixel offsets and routed through the per-node
// `handleTop(px)` helper so inline mode can add the prompt-chrome height
// (keeping the pips beside the PREVIEW, not the prompt below it).
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

function GenerateVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as GenerateVideoNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)

  // Inline prompt mode: render the live prompt editor + in-body run strip when
  // the global toggle is ON and the canvas is interactive (NOT the read-only
  // viewer / template-preview modal). OFF → today's behavior byte-for-byte.
  const inlineEnabled = useWorkflowStore((s) => s.inlinePromptMode)
  const interactive = useStore((s) => s.elementsSelectable)
  const showInline = inlineEnabled && interactive
  const chromeRef = useRef<HTMLDivElement>(null)
  const [chromeHeight, setChromeHeight] = useState(0)
  useEffect(() => {
    // Reset the editing-pin when inline turns off so the hover pill isn't left
    // pinned visible (promptFocused can't get a blur if the editor unmounts).
    if (!showInline || !chromeRef.current) { setChromeHeight(0); if (!showInline) setPromptFocused(false); return }
    const el = chromeRef.current
    const ro = new ResizeObserver(() => setChromeHeight(el.offsetHeight))
    ro.observe(el)
    setChromeHeight(el.offsetHeight)
    return () => ro.disconnect()
  }, [showInline])

  const [toolbarDropdownOpen, setToolbarDropdownOpen] = useState(false)
  // Whether the inline prompt editor is focused — reveals the hover pill while
  // editing (the run strip/controls are otherwise hover-only, as before).
  const [promptFocused, setPromptFocused] = useState(false)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const status = (nodeData.executionStatus as string | undefined) ?? "idle"
  const results = (nodeData.generatedResults as GeneratedResult[] | undefined) ?? []
  const activeIndex = (nodeData.activeResultIndex as number | undefined) ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? (nodeData.generatedVideoUrl as string | undefined)
  const activeThumbnail = activeResult?.thumbnailUrl
  const provider = (nodeData.provider as string) ?? "kling"
  const playState = (nodeData.videoPlayState as "loop" | "paused" | "stopped" | undefined) ?? "loop"
  const shouldPlay = videoAutoplay && playState === "loop"
  const videoRef = useRef<HTMLVideoElement>(null)

  // Credit identifier — the "image-to-video" string is a FE DISPLAY DEFAULT.
  // The actual mode is decided by the backend payload-builder at run-time
  // based on connected inputs. Using i2v as the display estimate matches the
  // legacy i2v node's behavior.
  const creditIdentifier = buildVideoCreditModelIdentifier(
    provider,
    nodeData.duration as number | string | undefined,
    nodeData.sound as boolean | undefined,
    "image-to-video",
    (nodeData.videoSize as string | undefined) ?? (nodeData.mode as string | undefined),
    nodeData.resolution as string | undefined,
    Array.isArray(nodeData.referenceVideoUrls) && (nodeData.referenceVideoUrls as unknown[]).length > 0,
  )
  const credits = useModelCredits(creditIdentifier, 25)

  // When inline, the prompt "chrome" sits below the aspect-locked preview, so the
  // bottom-anchored input pips must offset by the chrome height to stay beside the
  // PREVIEW (not spread down beside the prompt). `100% - chrome` = preview bottom.
  const handleTop = (px: number) =>
    showInline ? `calc(100% - ${chromeHeight}px - ${px}px)` : `calc(100% - ${px}px)`

  // Result-aspect-ratio for the BaseNode minHeight calc + video-element sizing.
  const { aspectRatio: mediaAspectRatio, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)

  // Video playback effects (loop / paused / stopped) — mirror i2v exactly.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !activeUrl) return
    if (playState === "paused") {
      v.pause()
      if (nodeData.pausedAtTime !== undefined) v.currentTime = nodeData.pausedAtTime as number
    } else if (playState === "stopped") {
      v.pause()
      v.currentTime = 0
    } else if (shouldPlay) {
      v.play().catch(() => {})
    }
  }, [playState, shouldPlay, activeUrl, nodeData.pausedAtTime])

  const handleVideoStateChange = useCallback(
    (state: { playState: "loop" | "paused" | "stopped"; currentTime: number }) => {
      updateNodeData(id, { videoPlayState: state.playState, pausedAtTime: state.currentTime })
    },
    [id, updateNodeData],
  )

  // BaseNode handles array. `external: true` so BaseNode counts the handle
  // toward node sizing (handleMinHeight) but does NOT render a duplicate
  // <Handle> — the HandleWithPopover instances below own DOM rendering.
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
      { id: "look",            type: "target" as const, position: Position.Left,  customStyle: { top: handleTop(HANDLE_OFFSET.look),            left: "-29px" }, external: true },
      { id: "elements",        type: "target" as const, position: Position.Left,  customStyle: { top: handleTop(HANDLE_OFFSET.elements),        left: "-29px" }, external: true },
      { id: "video",           type: "source" as const, position: Position.Right, customStyle: { top: "24px",                     right: "-29px" }, external: true },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showInline, chromeHeight],
  )

  // Re-register handles with React Flow on changes — edges to new handles
  // render unreliably otherwise.
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, handles, updateNodeInternals])

  // Per-provider "this handle has cap 0" set — drives the muted pip styling
  // below. Edges connecting to these handles are independently grayed/dashed
  // in the canvas's edge enricher (workflow-canvas.tsx). Recomputes on
  // provider OR seedance2InputMode change — the mode is mutually exclusive
  // between frames (start/end) and references on the seedance-2 family.
  const seedance2InputMode = nodeData.seedance2InputMode as "frames" | "references" | undefined
  const disabledHandles = useMemo(() => {
    const fakeNode = {
      type: "generate-video",
      data: { provider, seedance2InputMode },
    } as unknown as WorkflowNode
    const set = new Set<string>()
    for (const hid of ["startFrame", "endFrame", "imageReferences", "videoReferences", "audio", "audioReferences"] as const) {
      const lim = getHandleConnectionLimit(fakeNode, hid)
      if (lim?.limit === 0) set.add(hid)
    }
    return set
  }, [provider, seedance2InputMode])

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  // Media preview (running / result / failed / idle) + ALL absolute hover
  // controls + the LayoutGrid versions toggle. Reused by BOTH the inline and
  // non-inline branches. The caller owns the `group/video` wrapper (hover
  // controls use `group-hover/video:opacity-100`).
  function renderPreview() {
    return (
      <>
        {/* Running state */}
        {status === "running" && (
          <div className="flex flex-col items-center justify-center gap-2 bg-muted/30 rounded-xl w-full h-full min-h-[80px]">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <NodeJobProgress progress={nodeData.currentJobProgress as number | undefined} />
          </div>
        )}

        {/* Video result */}
        {status !== "running" && activeUrl && (
          <>
            {results.length > 1 && (
              <button
                type="button"
                className="absolute top-2 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white text-[11px] rounded-md opacity-0 group-hover/video:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowThumbnails((v) => !v)
                }}
              >
                <LayoutGrid className="w-3 h-3" />
                <span>{results.length}</span>
              </button>
            )}
            <video
              ref={videoRef}
              src={activeUrl}
              crossOrigin="anonymous"
              autoPlay={shouldPlay}
              loop={shouldPlay}
              muted
              playsInline
              poster={activeThumbnail}
              className="w-full h-full object-cover rounded-xl"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                if (v.videoWidth > 0) {
                  handleLoadDimensions({ width: v.videoWidth, height: v.videoHeight })
                }
                if (shouldPlay) v.play().catch(() => {})
              }}
            />
            {/* Top-right: delete */}
            {results.length > 0 && (
              <div className="absolute top-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
                <button
                  type="button"
                  aria-label="Remove result"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteConfirm(activeIndex)
                  }}
                  title="Delete this result"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {/* Bottom-left: expand, download, copy, freecut */}
            <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/video:opacity-100 transition-opacity">
              <button
                type="button"
                aria-label="Expand preview"
                className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  setPreviewOpen(true)
                }}
                title="Fullscreen"
              >
                <Expand className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label="Download"
                className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  const a = document.createElement("a")
                  a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl)}&download=1`
                  a.download = `${(nodeData.label as string) || "video"}.mp4`
                  a.click()
                }}
                title="Download"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label="Copy URL"
                className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  copyToClipboard(activeUrl, "URL copied")
                }}
                title="Copy URL"
              >
                <Link className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label="Edit in FreeCut"
                className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  openFreeCut(id, activeUrl, activeResult?.freecutProjectUrl)
                }}
                title="Edit in FreeCut"
              >
                <Scissors className="w-3.5 h-3.5" />
              </button>
            </div>
            {/* Bottom-right: result-info pill (model · aspect · resolution ·
                duration + audio), read from this result's job. Replaces the
                old Settings gear — open config by selecting the node, same as
                Generate Image. Hover-revealed by default; pinned while the
                versions panel is open so each result's settings stay visible
                as the user switches versions. */}
            <div
              className={`absolute bottom-2 right-2 transition-opacity ${
                showThumbnails ? "opacity-100" : "opacity-0 group-hover/video:opacity-100"
              }`}
            >
              <GenerateVideoResultInfo nodeId={id} result={activeResult} data={nodeData} />
            </div>
          </>
        )}

        {/* Failed state */}
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

        {/* Idle state */}
        {status !== "running" && !activeUrl && status !== "failed" && (
          <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px]">
            <Clapperboard className="w-10 h-10" />
          </div>
        )}
      </>
    )
  }

  return (
    <div className="relative" style={{ width: "100%", height: "100%" }}>
      <EditableNodeLabel
        label={(nodeData.label as string) ?? "Generate Video"}
        icon={<Clapperboard className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={(nodeData.label as string) ?? "Generate Video"}
        icon={<Clapperboard className="h-4 w-4" />}
        category="i2v"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        // Result fills the node transparently (no card chrome) ONLY in the
        // non-inline layout. In inline mode the prompt editor + run strip sit
        // below the preview inside the card, so the card border/background must
        // stay to back that chrome.
        className={!showInline && activeUrl ? "!border-0 !shadow-none !bg-transparent" : undefined}
        hideHeader
        // Shared video-node sizing: 16:9 @ VIDEO_NODE_MIN_HEIGHT (≈654×368) when
        // idle, snaps to the real result aspect once a result loads. (368 also
        // satisfies this node's 11-pip handle stack.)
        {...videoNodeSizing(mediaAspectRatio)}
        chromeHeight={showInline ? chromeHeight : undefined}
        handles={handles}
        rawToolbarContent={
          <GenerateVideoQuickToolbar
            nodeId={id}
            data={nodeData}
            credits={credits}
            isRunning={status === "running"}
            onAnyOpenChange={setToolbarDropdownOpen}
          />
        }
        // The hover pill behaves exactly as before: visible on hover, and ALSO
        // while the inline prompt is being edited (promptFocused).
        keepTopToolbarVisible={toolbarDropdownOpen || promptFocused}
        bottomToolbarContent={
          showThumbnails && results.length > 1 ? (
            <div className="flex gap-2 px-2 py-1.5 bg-black/60 backdrop-blur-sm rounded-xl border border-white/10">
              {results.slice(0, 8).map((r, i) => (
                <div key={`${r.jobId ?? "r"}-${i}`} className="relative shrink-0">
                  {r.thumbnailUrl ? (
                    <CachedImage
                      src={r.thumbnailUrl}
                      alt={`Result ${i + 1}`}
                      className={`w-16 h-16 object-cover rounded-lg cursor-pointer transition-all ${
                        i === activeIndex ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"
                      }`}
                      thumbnail
                      thumbnailWidth={128}
                      onClick={(e) => {
                        e.stopPropagation()
                        updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url })
                      }}
                    />
                  ) : (
                    <video
                      src={r.url}
                      crossOrigin="anonymous"
                      className={`w-16 h-16 object-cover rounded-lg cursor-pointer transition-all ${
                        i === activeIndex ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation()
                        updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url })
                      }}
                      muted
                      playsInline
                    />
                  )}
                </div>
              ))}
            </div>
          ) : undefined
        }
      >
        {showInline ? (
          // Inline mode: aspect-locked preview on top, the inline prompt editor as
          // chrome below (measured via chromeRef → BaseNode chromeHeight). The run
          // controls stay on the original hover pill (rawToolbarContent) — shown on
          // hover or while editing — so the resting node stays clean (as before).
          // The preview sub-region carries `group/video` so the result hover
          // controls' `group-hover/video:opacity-100` still reveal on hover.
          <div className="flex flex-col h-full">
            <div className="relative flex-1 min-h-0 group/video">
              {renderPreview()}
            </div>
            <div ref={chromeRef} className="shrink-0">
              <InlineNodePrompt
                nodeId={id}
                nodeType="generate-video"
                data={nodeData as never}
                provider={provider}
                aspectRatio={nodeData.aspectRatio}
                onFocusChange={setPromptFocused}
              />
            </div>
          </div>
        ) : (
          <div className="relative w-full h-full group/video">
            {renderPreview()}
          </div>
        )}
      </BaseNode>

      {/* 11 typed input pips + 1 output pip — bottom-up clusters:
          text → image → audio → pickers. Colors mirror the source node's
          category color so the wire endpoint reads as the source's brand:
            prompt   → brand pink   (#ff0073, text producers)
            negative → red          (negation)
            startFrame/endFrame → cyan (location/image family)
            imgRefs/vidRefs → emerald/purple (images vs videos)
            audio/audioRefs → yellow (audio family)
            assets   → character pink (identity entities)
            look/elements → indigo (parameter pickers) */}
      <HandleWithPopover nodeId={id} nodeType="generate-video" handleId="prompt"          type="target" position={Position.Left}  label="Prompt"      color={TEXT_HANDLE_COLOR} icon={<Type />}      side="left"  top={handleTop(HANDLE_OFFSET.prompt)}          accepts={ACCEPTS_PROMPT} />
      <HandleWithPopover nodeId={id} nodeType="generate-video" handleId="negative"        type="target" position={Position.Left}  label="Negative"    color={HANDLE_COLORS.negative} icon={<Minus />}     side="left"  top={handleTop(HANDLE_OFFSET.negative)}        accepts={ACCEPTS_NEGATIVE} />
      <HandleWithPopover nodeId={id} nodeType="generate-video" handleId="startFrame"      type="target" position={Position.Left}  label="Start Frame" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="left"  top={handleTop(HANDLE_OFFSET.startFrame)}      accepts={ACCEPTS_STARTFRAME} disabled={disabledHandles.has("startFrame")} />
      <HandleWithPopover nodeId={id} nodeType="generate-video" handleId="endFrame"        type="target" position={Position.Left}  label="End Frame"   color={HANDLE_COLORS.endFrame} icon={<ImageIcon />} side="left"  top={handleTop(HANDLE_OFFSET.endFrame)}        accepts={ACCEPTS_ENDFRAME} disabled={disabledHandles.has("endFrame")} />
      <HandleWithPopover nodeId={id} nodeType="generate-video" handleId="imageReferences" type="target" position={Position.Left}  label="Image Refs"  color={HANDLE_COLORS.imageRef} icon={<Images />}    side="left"  top={handleTop(HANDLE_OFFSET.imageReferences)} orderMatters accepts={ACCEPTS_IMAGE_REFS} disabled={disabledHandles.has("imageReferences")} />
      <HandleWithPopover nodeId={id} nodeType="generate-video" handleId="videoReferences" type="target" position={Position.Left}  label="Video Refs"  color={HANDLE_COLORS.video} icon={<Film />}      side="left"  top={handleTop(HANDLE_OFFSET.videoReferences)} orderMatters accepts={ACCEPTS_VIDEO_REFS} disabled={disabledHandles.has("videoReferences")} />
      <HandleWithPopover nodeId={id} nodeType="generate-video" handleId="audio"           type="target" position={Position.Left}  label="Audio"       color={HANDLE_COLORS.audio} icon={<Volume2 />}   side="left"  top={handleTop(HANDLE_OFFSET.audio)}           accepts={ACCEPTS_AUDIO} disabled={disabledHandles.has("audio")} />
      <HandleWithPopover nodeId={id} nodeType="generate-video" handleId="audioReferences" type="target" position={Position.Left}  label="Audio Refs"  color={HANDLE_COLORS.audioRef} icon={<Music />}     side="left"  top={handleTop(HANDLE_OFFSET.audioReferences)} orderMatters accepts={ACCEPTS_AUDIO_REFS} disabled={disabledHandles.has("audioReferences")} />
      <HandleWithPopover nodeId={id} nodeType="generate-video" handleId="assets"          type="target" position={Position.Left}  label="Assets"      color={HANDLE_COLORS.identity} icon={<Users />}     side="left"  top={handleTop(HANDLE_OFFSET.assets)}          orderMatters accepts={ACCEPTS_ASSETS} />
      <HandleWithPopover nodeId={id} nodeType="generate-video" handleId="look"            type="target" position={Position.Left}  label="Look"        color={HANDLE_COLORS.look} icon={<Aperture />}  side="left"  top={handleTop(HANDLE_OFFSET.look)}            accepts={ACCEPTS_LOOK} />
      <HandleWithPopover nodeId={id} nodeType="generate-video" handleId="elements"        type="target" position={Position.Left}  label="Elements"    color={HANDLE_COLORS.look} icon={<Sparkles />}  side="left"  top={handleTop(HANDLE_OFFSET.elements)}        accepts={ACCEPTS_ELEMENTS} />
      {/* Output pip — video. Shares Film + purple (videoReferences color) for type identification. */}
      <HandleWithPopover nodeId={id} nodeType="generate-video" handleId="video"           type="source" position={Position.Right} label="Video"       color={HANDLE_COLORS.video} icon={<Film />}      side="right" top="24px" />

      {activeUrl && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type="video"
          url={activeUrl}
          results={results}
          initialIndex={activeIndex}
          onVideoStateChange={handleVideoStateChange}
          initialVideoPlayState={nodeData.videoPlayState as "loop" | "paused" | "stopped" | undefined}
          initialPausedAtTime={nodeData.pausedAtTime as number | undefined}
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

export const GenerateVideoNode = memo(GenerateVideoNodeComponent)
