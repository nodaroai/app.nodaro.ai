"use client"

import { memo, useState, useCallback } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import {
  Layers,
  Loader2,
  AlertCircle,
  X,
  Image as ImageIcon,
  Expand,
  Download,
  Link,
  Settings,
  LayoutGrid,
} from "lucide-react"
import { NodeJobProgress } from "./node-job-progress"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useConnectionCount } from "@/hooks/use-connection-count"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { EditableNodeLabel } from "./editable-node-label"
import { copyToClipboard } from "@/lib/utils"
import type { GenerateMaskData } from "@/types/nodes"

type PreviewMode = "overlay" | "mask" | "source"

type MaskResult = { readonly imageUrl: string; readonly maskUrl: string }

function GenerateMaskNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as GenerateMaskData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const inConnectionCount = useConnectionCount(id, "image")

  const status = nodeData.executionStatus ?? "idle"
  const results: ReadonlyArray<MaskResult> = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeImageUrl = activeResult?.imageUrl ?? nodeData.generatedImageUrl
  const activeMaskUrl = activeResult?.maskUrl ?? nodeData.generatedMaskUrl

  const credits = useModelCredits("generate-mask", 2)

  const [previewOpen, setPreviewOpen] = useState(false)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [previewMode, setPreviewMode] = useState<PreviewMode>("overlay")
  // Component-local aspect ratio — results use a bespoke {imageUrl, maskUrl}
  // shape (not GeneratedResult[]), so we can't use useResultAspectRatio.
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined)

  const handleLoadDimensions = useCallback((dim: { width: number; height: number }) => {
    if (dim.width > 0 && dim.height > 0) {
      setAspectRatio(dim.width / dim.height)
    }
  }, [])

  function handleDeleteResult(indexToDelete: number) {
    const next = results.filter((_, i) => i !== indexToDelete)
    let nextActive = activeIndex
    if (indexToDelete < activeIndex) {
      nextActive = Math.max(0, activeIndex - 1)
    } else if (indexToDelete === activeIndex) {
      nextActive = Math.min(activeIndex, Math.max(0, next.length - 1))
    }
    const pointer = next[nextActive]
    updateNodeData(id, {
      generatedResults: next,
      activeResultIndex: nextActive,
      generatedImageUrl: pointer?.imageUrl,
      generatedMaskUrl: pointer?.maskUrl,
    })
  }

  // Pick which URL to render in the image area based on preview mode.
  const displayUrl =
    previewMode === "source" ? activeImageUrl
    : previewMode === "mask"   ? activeMaskUrl
    : activeMaskUrl // overlay: show the mask PNG (red tint applied via blend mode overlay)

  const hasResult = !!(activeImageUrl && activeMaskUrl)

  return (
    <div className="relative" style={{ width: "100%", height: "100%" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Layers className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Layers className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        minWidth={200}
        minHeight={aspectRatio ? Math.round(200 / aspectRatio) : 150}
        imageAspectRatio={aspectRatio}
        hideHeader
        topToolbarContent={
          <RunNodeButton
            nodeId={id}
            credits={credits}
            isRunning={status === "running"}
            onRun={(nid) => runSingleNode?.(nid)}
          />
        }
        bottomToolbarContent={
          showThumbnails && results.length > 1 ? (
            <div className="flex gap-1.5 px-2 py-1.5 bg-black/60 backdrop-blur-sm rounded-xl border border-white/10">
              {results.slice(0, 8).map((r, i) => (
                <CachedImage
                  key={`${r.maskUrl}-${i}`}
                  src={r.imageUrl}
                  alt={`Result ${i + 1}`}
                  className={`w-12 h-12 object-cover rounded-lg cursor-pointer transition-all ${
                    i === activeIndex ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"
                  }`}
                  thumbnail
                  thumbnailWidth={96}
                  onClick={(e) => {
                    e.stopPropagation()
                    updateNodeData(id, {
                      activeResultIndex: i,
                      generatedImageUrl: r.imageUrl,
                      generatedMaskUrl: r.maskUrl,
                    })
                  }}
                />
              ))}
            </div>
          ) : undefined
        }
        handles={[
          {
            id: "image",
            type: "target",
            position: Position.Left,
            customStyle: { top: "calc(100% - 20px)", left: "-29px" },
            hideHandle: true,
          },
          {
            id: "image",
            type: "source",
            position: Position.Right,
            customStyle: { top: "20px", right: "-29px" },
            hideHandle: true,
          },
          {
            id: "mask",
            type: "source",
            position: Position.Right,
            customStyle: { top: "50px", right: "-29px" },
            hideHandle: true,
          },
        ]}
      >
        <div className="relative w-full h-full group/mask flex flex-col">
          {/* Image preview area */}
          <div className="relative flex-1 min-h-0">
            {/* Running */}
            {status === "running" && (
              <div className="flex flex-col items-center justify-center gap-2 bg-muted/30 rounded-xl w-full h-full min-h-[120px]">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                <NodeJobProgress progress={nodeData.currentJobProgress} />
              </div>
            )}

            {/* Idle / empty */}
            {status !== "running" && !hasResult && status !== "failed" && (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px] px-3 text-center">
                <Layers className="w-10 h-10" />
                <span className="text-[10px] leading-tight">
                  Connect an image and describe what to mask
                </span>
              </div>
            )}

            {/* Failed */}
            {status === "failed" && !hasResult && (
              <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-red-500/5 text-red-500 h-[160px] p-2">
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

            {/* Result + preview */}
            {status !== "running" && hasResult && displayUrl && (
              <>
                {results.length > 1 && (
                  <button
                    type="button"
                    className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-md z-10 opacity-0 group-hover/mask:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowThumbnails((v) => !v)
                    }}
                    title="Show versions"
                  >
                    <LayoutGrid className="w-3 h-3" />
                    <span className="text-[11px] font-medium">{results.length}</span>
                  </button>
                )}

                <CachedImage
                  src={displayUrl}
                  alt={previewMode === "source" ? "Source image" : previewMode === "mask" ? "Mask" : "Mask overlay"}
                  className="w-full h-full object-cover rounded-xl"
                  thumbnail
                  thumbnailWidth={320}
                  onLoadDimensions={handleLoadDimensions}
                />

                {/* Subtle red tint in overlay mode to hint that this is the mask */}
                {previewMode === "overlay" && (
                  <div
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{ backgroundColor: "rgba(255, 0, 115, 0.35)", mixBlendMode: "multiply" }}
                  />
                )}

                {/* Top-right action buttons */}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/mask:opacity-100 transition-opacity">
                  {results.length > 0 && (
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
                  )}
                </div>

                {/* Bottom-left action cluster */}
                <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/mask:opacity-100 transition-opacity">
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
                    aria-label="Download mask"
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!activeMaskUrl) return
                      const a = document.createElement("a")
                      a.href = `/v1/image-proxy?url=${encodeURIComponent(activeMaskUrl)}&download=1`
                      a.download = `${nodeData.label || "mask"}.png`
                      a.click()
                    }}
                    title="Download mask"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Copy mask URL"
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (activeMaskUrl) copyToClipboard(activeMaskUrl, "Mask URL copied")
                    }}
                    title="Copy mask URL"
                  >
                    <Link className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Bottom-right: settings + 3-state preview toggle */}
                <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover/mask:opacity-100 transition-opacity">
                  <div className="flex bg-black/50 backdrop-blur-sm border border-white/10 rounded-full overflow-hidden text-white text-[10px] font-medium">
                    {(["overlay", "mask", "source"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`px-2 py-1 transition-colors ${
                          previewMode === mode ? "bg-white/20 text-white" : "hover:bg-white/10 text-white/70"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setPreviewMode(mode)
                        }}
                        title={`Show ${mode}`}
                      >
                        {mode === "overlay" ? "Overlay" : mode === "mask" ? "Mask" : "Source"}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    aria-label="Settings"
                    className={`w-7 h-7 flex items-center justify-center bg-black/50 hover:bg-black/70 border border-white/10 text-white rounded-full shadow-sm${isSettingsOpen ? " ring-1 ring-white/30" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      selectNode(isSettingsOpen ? null : id)
                    }}
                    title="Settings"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Bottom config bar — read-only summary; full editing is in the
              config panel (Task 9). Mirrors generate-image's compact bottom row. */}
          <div className="shrink-0 px-2 py-1.5 border-t border-white/5 bg-black/20 flex items-center gap-2 text-[10px]">
            <span className="flex-1 truncate text-muted-foreground" title={nodeData.prompt || "No prompt set"}>
              {nodeData.prompt ? nodeData.prompt : <span className="italic opacity-60">No prompt</span>}
            </span>
            <span className="font-mono text-muted-foreground/80 shrink-0">
              t={typeof nodeData.threshold === "number" ? nodeData.threshold.toFixed(2) : "0.30"}
            </span>
          </div>
        </div>
      </BaseNode>

      {/* Input handle icon: image (pink, bottom-left) */}
      <div
        className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
        style={{ top: "calc(100% - 20px)", left: "-29px", transform: "translateY(-50%)" }}
      >
        <ImageIcon className="w-3.5 h-3.5 text-white" />
        <div className="absolute top-1/2 -translate-y-1/2 -left-[9px] w-[12px] h-[12px] rounded-full bg-[#111827] border border-[#ff0073] text-[#ff0073] text-[8px] font-black flex items-center justify-center">+</div>
        {inConnectionCount >= 2 && (
          <div className="absolute top-1/2 -translate-y-1/2 -right-[9px] w-[13px] h-[13px] rounded-full bg-white text-[#ff0073] text-[8px] font-black flex items-center justify-center">
            {inConnectionCount}
          </div>
        )}
      </div>

      {/* Output handle icon: image passthrough (pink, top-right) */}
      <div
        className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30"
        style={{ top: "20px", right: "-29px", transform: "translateY(-50%)" }}
      >
        <ImageIcon className="w-3.5 h-3.5 text-white" />
      </div>

      {/* Output handle icon: mask (purple, below image output) */}
      <div
        className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#a855f7] shadow-lg shadow-purple-500/30"
        style={{ top: "50px", right: "-29px", transform: "translateY(-50%)" }}
      >
        <Layers className="w-3.5 h-3.5 text-white" />
      </div>

      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
        }}
      />

      {displayUrl && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type="image"
          url={displayUrl}
          results={results.map((r) => ({
            url: previewMode === "source" ? r.imageUrl : r.maskUrl,
          }))}
          initialIndex={activeIndex}
        />
      )}
    </div>
  )
}

export const GenerateMaskNode = memo(GenerateMaskNodeComponent)
