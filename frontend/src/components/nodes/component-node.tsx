"use client"

import { memo, useMemo, useEffect, useState } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Puzzle, ImageIcon, Video, AudioLines, FileText, Expand, Download, Link, Scissors, Copy, Loader2 } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { NodeJobProgress } from "./node-job-progress"
import { CachedImage } from "@/components/ui/cached-image"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { copyToClipboard } from "@/lib/utils"
import { isImageUrl, isVideoUrl, isAudioUrl } from "@/lib/media-type"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { ComponentNodeData } from "@/types/nodes"
import type { ComponentHandle } from "@nodaro-shared/component-types"

const HANDLE_TYPE_ICON: Record<ComponentHandle["type"], React.ReactNode> = {
  image: <ImageIcon />,
  video: <Video />,
  audio: <AudioLines />,
  text: <FileText />,
}

const BTN_CLASS = "w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"

/**
 * Build handles matching the standard node layout:
 *  - Outputs at the top-right, starting from 20px downward
 *  - Inputs at the bottom-left, starting from bottom (calc(100% - 20px)) upward
 */
function buildHandles(
  inputs: ReadonlyArray<ComponentHandle>,
  outputs: ReadonlyArray<ComponentHandle>,
) {
  // --- Output handles: top-right, 20px per slot downward ---
  const sources = outputs.map((h, i) => {
    const top = `${20 + i * 28}px`
    return {
      id: `out_${h.id}`,
      type: "source" as const,
      position: Position.Right,
      top,
      hideHandle: true,
      customStyle: { top, right: "-29px" },
      handleType: h.type,
      handleName: h.name,
    }
  })

  // --- Input handles: bottom-left, starting from calc(100% - 20px) upward ---
  const targets = inputs.map((h, i) => {
    const bottom = 20 + i * 28
    const top = `calc(100% - ${bottom}px)`
    return {
      id: `in_${h.id}`,
      type: "target" as const,
      position: Position.Left,
      top,
      hideHandle: true,
      customStyle: { top, left: "-29px" },
      handleType: h.type,
      handleName: h.name,
    }
  })

  // Fallback handles if no metadata
  if (targets.length === 0 && sources.length === 0) {
    return [
      { id: "in", type: "target" as const, position: Position.Left, top: "calc(100% - 20px)", hideHandle: true, customStyle: { top: "calc(100% - 20px)", left: "-29px" }, handleType: "text" as const, handleName: "In" },
      { id: "out", type: "source" as const, position: Position.Right, top: "20px", hideHandle: true, customStyle: { top: "20px", right: "-29px" }, handleType: "text" as const, handleName: "Out" },
    ]
  }

  return [...targets, ...sources]
}

function ComponentNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ComponentNodeData
  const metadata = nodeData.componentMetadata ?? { inputs: [], outputs: [], exposedSettings: [] }
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const updateNodeInternals = useUpdateNodeInternals()
  const useFull = useFullResolution(id)
  const status = nodeData.executionStatus ?? "idle"

  const inputHandles = metadata.inputs ?? []
  // Deduplicate outputs by node ID (same node can be input+output, show once)
  const outputHandles = useMemo(() => {
    const seen = new Set<string>()
    return (metadata.outputs ?? []).filter((h) => {
      if (seen.has(h.id)) return false
      seen.add(h.id)
      return true
    })
  }, [metadata.outputs])
  const handleKey = [...inputHandles, ...outputHandles].map((h) => h.id).join(",")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handles = useMemo(() => buildHandles(inputHandles, outputHandles), [handleKey])

  const maxPorts = Math.max(inputHandles.length, outputHandles.length, 1)
  const nodeMinHeight = Math.max(150, maxPorts * 28 + 60)

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, inputHandles.length, outputHandles.length, updateNodeInternals])

  // Find the mediaPreview output for result display
  const previewHandle = outputHandles.find((o) => o.mediaPreview)
  const previewValue = previewHandle && nodeData.outputResults?.[previewHandle.id]

  const isImage = typeof previewValue === "string" && isImageUrl(previewValue)
  const isVideo = typeof previewValue === "string" && isVideoUrl(previewValue)
  const isAudio = typeof previewValue === "string" && isAudioUrl(previewValue) && !isVideo

  const [previewOpen, setPreviewOpen] = useState(false)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)

  // Aspect ratio captured from the rendered <img>'s onLoad — synchronous
  // with the actual element rather than racing a side-channel preload.
  // Reset when previewValue changes so we don't apply stale dims to a new
  // image; the new onLoad will populate it.
  const [imgAspectRatio, setImgAspectRatio] = useState<number | undefined>()
  useEffect(() => { setImgAspectRatio(undefined) }, [previewValue, isImage])
  const handleLoadDimensions = ({ width, height }: { width: number; height: number }) => {
    if (width > 0) setImgAspectRatio(width / height)
  }

  const handleDownload = () => {
    if (!previewValue || typeof previewValue !== "string") return
    const a = document.createElement("a")
    a.href = `/v1/image-proxy?url=${encodeURIComponent(previewValue)}&download=1`
    a.download = ""
    a.click()
  }

  return (
    <div className="relative group/component" style={{ maxWidth: "220px" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Puzzle className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label || "Component"}
        icon={<Puzzle className="h-4 w-4" />}
        category="component"
        credits={nodeData.estimatedCredits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={200}
        minHeight={imgAspectRatio ? Math.round(200 / imgAspectRatio) : nodeMinHeight}
        topToolbarContent={
          <RunNodeButton
            nodeId={id}
            credits={nodeData.estimatedCredits ?? 0}
            isRunning={status === "running"}
            onRun={(nid) => runSingleNode?.(nid)}
          />
        }
        handles={handles}
        imageAspectRatio={imgAspectRatio}
      >
        <div className="relative w-full h-full group">
          {!nodeData.appSlug ? (
            <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px]">
              <Puzzle className="w-10 h-10" />
            </div>
          ) : (
            <>
              {/* Running state */}
              {status === "running" && (
                <div className="flex flex-col items-center justify-center gap-2 bg-muted/30 rounded-xl h-[180px]">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  <NodeJobProgress progress={nodeData.currentJobProgress as number | undefined} />
                </div>
              )}

              {/* Result state — fills full node space like generate-image */}
              {status !== "running" && previewValue && (
                <>
                  {isImage ? (
                    <CachedImage
                      src={previewValue}
                      alt="Result"
                      className="w-full h-full object-cover rounded-xl"
                      thumbnail={!useFull}
                      thumbnailWidth={320}
                      onLoadDimensions={handleLoadDimensions}
                    />
                  ) : isVideo ? (
                    <video
                      src={previewValue}
                      crossOrigin="anonymous"
                      className="w-full h-full object-cover rounded-xl"
                      muted
                      onLoadedMetadata={(e) => {
                        const v = e.currentTarget
                        if (v.videoWidth > 0) handleLoadDimensions({ width: v.videoWidth, height: v.videoHeight })
                      }}
                    />
                  ) : isAudio ? (
                    <div className="flex items-center justify-center rounded-xl bg-muted/10 h-[120px] px-2">
                      <audio
                        src={previewValue}
                        crossOrigin="anonymous"
                        controls
                        className="w-full"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center rounded-xl bg-muted/10 p-3 h-[120px]">
                      <p className="text-xs text-muted-foreground line-clamp-4">
                        {previewValue}
                      </p>
                    </div>
                  )}

                  {/* Action buttons overlay */}
                  <div className="absolute bottom-2 left-2 opacity-0 group-hover/component:opacity-100 transition-opacity flex gap-1">
                    {(isImage || isVideo) && (
                      <button type="button" className={BTN_CLASS} onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }}>
                        <Expand className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button type="button" className={BTN_CLASS} onClick={(e) => { e.stopPropagation(); handleDownload() }}>
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" className={BTN_CLASS} onClick={(e) => { e.stopPropagation(); copyToClipboard(previewValue as string, "URL copied") }}>
                      <Link className="w-3.5 h-3.5" />
                    </button>
                    {isVideo && (
                      <button type="button" className={BTN_CLASS} onClick={(e) => { e.stopPropagation(); openFreeCut(id, previewValue as string) }}>
                        <Scissors className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {!isImage && !isVideo && !isAudio && (
                      <button type="button" className={BTN_CLASS} onClick={(e) => { e.stopPropagation(); copyToClipboard(previewValue as string, "Text copied") }}>
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* Failed state */}
              {status === "failed" && !previewValue && (
                <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-red-500/5 text-red-500 p-2 h-[160px]">
                  <span className="font-medium text-sm">Failed</span>
                  {nodeData.errorMessage && (
                    <p className="text-[10px] text-red-400 text-center line-clamp-2" title={nodeData.errorMessage}>
                      {nodeData.errorMessage}
                    </p>
                  )}
                </div>
              )}

              {/* Idle/empty state */}
              {status !== "running" && !previewValue && status !== "failed" && (
                <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px]">
                  <Puzzle className="w-10 h-10" />
                </div>
              )}

            </>
          )}
        </div>
      </BaseNode>

      {previewOpen && previewValue && typeof previewValue === "string" && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type={isImage ? "image" : isVideo ? "video" : "audio"}
          url={previewValue}
        />
      )}

      {/* Handle icons + labels — outputs top-right, inputs bottom-left */}
      {handles.filter((h) => h.type === "target").map((h) => (
        <div key={h.id}>
          <HandleIcon
            icon={HANDLE_TYPE_ICON[h.handleType as ComponentHandle["type"]] ?? <FileText />}
            color="purple"
            side="left"
            top={h.top ?? "calc(100% - 20px)"}
          />
          {h.handleName && (
            <span
              className="absolute text-[8px] font-medium text-muted-foreground/70 pointer-events-none select-none whitespace-nowrap"
              style={{ top: h.top ?? "calc(100% - 20px)", left: "6px", transform: "translateY(-50%)" }}
            >
              {h.handleName}
            </span>
          )}
        </div>
      ))}
      {handles.filter((h) => h.type === "source").map((h) => (
        <div key={h.id}>
          <HandleIcon
            icon={HANDLE_TYPE_ICON[h.handleType as ComponentHandle["type"]] ?? <FileText />}
            color="purple"
            top={h.top ?? "20px"}
          />
          {h.handleName && (
            <span
              className="absolute text-[8px] font-medium text-muted-foreground/70 pointer-events-none select-none whitespace-nowrap"
              style={{ top: h.top ?? "20px", right: "6px", transform: "translateY(-50%)" }}
            >
              {h.handleName}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

export const ComponentNode = memo(ComponentNodeComponent)
