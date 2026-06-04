"use client"

import { memo, useState, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Film, Type, Loader2, AlertCircle, X, Aperture } from "lucide-react"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { isValidExtendVideoConnection } from "@/lib/video-producer-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { NodeJobProgress } from "./node-job-progress"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { EditableNodeLabel } from "./editable-node-label"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { VideoResultOverlay } from "./video-result-overlay"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "./video-node-defaults"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { ExtendVideoData } from "@/types/nodes"

const isPickerType = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_VIDEO          = (t: string) => isValidExtendVideoConnection("video",          t, isPickerType)
const ACCEPTS_CINEMATOGRAPHY = (t: string) => isValidExtendVideoConnection("cinematography", t, isPickerType)
const ACCEPTS_PROMPT         = (t: string) => isValidExtendVideoConnection("prompt",         t, isPickerType)

function ExtendVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ExtendVideoData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [videoError, setVideoError] = useState(false)
  const extendProvider = nodeData.provider || "veo-extend"
  const credits = useModelCredits(extendProvider, extendProvider === "runway-extend" ? 32 : 40)

  // Result aspect drives node sizing — 16:9 until a result lands, then snaps to
  // the real video aspect (raw dims fed in via the overlay's onRawDimensions).
  const { aspectRatio: mediaAspectRatio, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)

  useEffect(() => {
    setVideoError(false)
  }, [activeUrl])

  const hasResult = status !== "running" && !!activeUrl && !videoError

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  return (
    <div className="relative group/node" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Film className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Film className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        {...videoNodeSizing(mediaAspectRatio)}
        className={hasResult ? "!border-0 !shadow-none !bg-transparent" : undefined}
        hideHeader
        topToolbarContent={
                      <NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} />
        }
        handles={[
          { id: "video",          type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
          { id: "cinematography", type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 56px)', left: '-29px' }, external: true },
          { id: "prompt",         type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 88px)', left: '-29px' }, external: true },
          { id: "video",          type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
        ]}
      >
        {hasResult ? null : (
          <div className="flex flex-col gap-1">
            {status === "running" && (
              <div className="flex flex-col items-center justify-center h-28 rounded-md bg-muted/30 gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <NodeJobProgress progress={nodeData.currentJobProgress} />
              </div>
            )}

            {status !== "running" && activeUrl && videoError && (
              <div className="relative group">
                <div className="w-full h-28 rounded-md bg-amber-500/10 border border-amber-500/30 flex flex-col items-center justify-center gap-1">
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                  <span className="text-[10px] text-amber-500">Video load failed</span>
                  <a href={activeUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 underline" onClick={(e) => e.stopPropagation()}>Open URL</a>
                </div>
                <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">Extended</div>
                {results.length > 0 && (
                  <button type="button" aria-label="Remove" className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}><X className="w-3 h-3" /></button>
                )}
              </div>
            )}

            {status === "failed" && !activeUrl && (
              <div className="flex flex-col items-center justify-center gap-1 h-28 rounded-md bg-red-500/5 text-red-500 p-2">
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

            {status !== "running" && !activeUrl && status !== "failed" && (
              <div className="flex items-center justify-center h-28 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
                <Film className="w-6 h-6" />
              </div>
            )}

            {results.length > 1 && (
              <div className="flex gap-1 overflow-x-auto">
                {results.slice(0, 5).map((r, i) => (
                  <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                    {r.thumbnailUrl ? (
                      <CachedImage
                        src={r.thumbnailUrl}
                        alt=""
                        className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${
                          i === activeIndex
                            ? "opacity-100 ring-2 ring-primary"
                            : "opacity-50 hover:opacity-80"
                        }`}
                        thumbnail
                        thumbnailWidth={80}
                        onClick={(e) => {
                          e.stopPropagation()
                          updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url })
                        }}
                      />
                    ) : (
                      <video
                        src={r.url}
                        crossOrigin="anonymous"
                        className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${
                          i === activeIndex
                            ? "opacity-100 ring-2 ring-primary"
                            : "opacity-50 hover:opacity-80"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation()
                          updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url })
                        }}
                        muted
                        playsInline
                      />
                    )}
                    <button
                      type="button"
                      aria-label="Remove"
                      className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteConfirm(i)
                      }}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-center text-muted-foreground text-xs">
              <span>{nodeData.provider === "runway-extend" ? "Runway" : "VEO"} Extend</span>
            </div>
          </div>
        )}
      </BaseNode>

      {hasResult && (
        <VideoResultOverlay
          url={activeUrl}
          onEdit={() => openFreeCut(id, activeUrl!, activeResult?.freecutProjectUrl)}
          videoAutoplay={videoAutoplay}
          label={nodeData.label}
          hasResults={results.length > 1}
          onExpand={() => setPreviewOpen(true)}
          onDelete={() => setDeleteConfirm(activeIndex)}
          onRawDimensions={handleLoadDimensions}
          onVideoError={() => setVideoError(true)}
          onVideoLoad={() => setVideoError(false)}
          onSettings={() => selectNode(isSettingsOpen ? null : id)}
          isSettingsOpen={isSettingsOpen}
        />
      )}

      <HandleWithPopover nodeId={id} nodeType="extend-video" handleId="video"          type="target" position={Position.Left}  label="Video"          color={HANDLE_COLORS.video} icon={<Film />}     side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_VIDEO} />
      <HandleWithPopover nodeId={id} nodeType="extend-video" handleId="cinematography" type="target" position={Position.Left}  label="Cinematography" color={HANDLE_COLORS.look} icon={<Aperture />} side="left"  top="calc(100% - 56px)" accepts={ACCEPTS_CINEMATOGRAPHY} />
      <HandleWithPopover nodeId={id} nodeType="extend-video" handleId="prompt"         type="target" position={Position.Left}  label="Prompt"         color={TEXT_HANDLE_COLOR} icon={<Type />}     side="left"  top="calc(100% - 88px)" accepts={ACCEPTS_PROMPT} />
      <HandleWithPopover nodeId={id} nodeType="extend-video" handleId="video"          type="source" position={Position.Right} label="Video"          color={HANDLE_COLORS.video} icon={<Film />}     side="right" top="24px" />
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

export const ExtendVideoNode = memo(ExtendVideoNodeComponent)
