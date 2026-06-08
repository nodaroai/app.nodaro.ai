"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import {
  LayoutGrid,
  Loader2,
  AlertCircle,
  X,
  Image as ImageIcon,
  Expand,
  Settings,
} from "lucide-react"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { ACCEPTS_ENTITY_REF } from "@/lib/target-handle-registry"
import { NodeJobProgress } from "./node-job-progress"
import { BaseNode } from "./base-node"
import { imageNodeSizing, videoNodeSizing } from "./video-node-defaults"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { useUpstreamImageAspect } from "@/hooks/use-upstream-image-aspect"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { NodeQuickStrip } from "./node-quick-strip"
import { ResultsThumbnailsPanel } from "./results-thumbnails-panel"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { EditableNodeLabel } from "./editable-node-label"
import { referenceSheetCreditId } from "@nodaro/shared"
import type { GeneratedResult, ReferenceSheetData } from "@/types/nodes"

function ReferenceSheetNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ReferenceSheetData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)

  const status = nodeData.executionStatus ?? "idle"
  const results: ReadonlyArray<GeneratedResult> = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeImageUrl = activeResult?.url ?? nodeData.generatedImageUrl
  const panelCount = nodeData.panelUrls?.length ?? 0

  // Flavour-aware so the Run button shows the same price the route reserves
  // (routes/reference-sheet.ts::sheetCreditId): motion → 6cr, still → 4cr.
  // Credit-id via the shared single source of truth; fallback NUMBER stays local.
  const isMotionFlavour = nodeData.flavour?.outputFormat === "motion"
  const credits = useModelCredits(
    referenceSheetCreditId(nodeData.flavour),
    isMotionFlavour ? 6 : 4,
  )

  const [previewOpen, setPreviewOpen] = useState(false)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const { aspectRatio, onLoadDimensions } = useResultAspectRatio(id, results, activeIndex)
  const upstreamImageAspect = useUpstreamImageAspect(id)
  // Zoom-aware: serve the full-res transcode (not the 400px thumbnail) once the
  // node is rendered large/zoomed-in, so a detailed sheet stays crisp (mirrors
  // generate-image-node). A reference sheet is a dense poster users zoom into.
  const useFull = useFullResolution(id)

  // Motion sheets render a video (the chrome PNG with motion clips overlaid → MP4).
  // Drive off the configured flavour, with the active URL's .mp4 extension as a
  // fallback signal for results produced before flavour was persisted.
  const isMotion =
    nodeData.flavour?.outputFormat === "motion" ||
    (typeof activeImageUrl === "string" && activeImageUrl.toLowerCase().endsWith(".mp4"))

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
      generatedImageUrl: pointer?.url,
    })
  }

  const hasResult = !!activeImageUrl

  return (
    <div className="relative" style={{ width: "100%", height: "100%" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<LayoutGrid className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<LayoutGrid className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        {...(isMotion ? videoNodeSizing(aspectRatio) : imageNodeSizing(aspectRatio, upstreamImageAspect))}
        hideHeader
        topToolbarContent={
          <NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} />
        }
        bottomToolbarContent={
          showThumbnails && results.length > 1 ? (
            <ResultsThumbnailsPanel
              results={results}
              activeIndex={activeIndex}
              nodeSelected={!!selected || isSettingsOpen}
              mediaType={isMotion ? "video" : "image"}
              onSelect={(i) =>
                updateNodeData(id, { activeResultIndex: i, generatedImageUrl: results[i].url })
              }
              onDelete={(i) => setDeleteConfirm(i)}
            />
          ) : undefined
        }
        handles={[
          { id: "in",     type: "target", position: Position.Left,  customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
          { id: "sheet",  type: "source", position: Position.Right, customStyle: { top: "24px",              right: "-29px" }, external: true },
          { id: "panels", type: "source", position: Position.Right, customStyle: { top: "56px",              right: "-29px" }, external: true },
        ]}
      >
        <div className="relative w-full h-full group/sheet flex flex-col">
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
                <LayoutGrid className="w-10 h-10" />
                <span className="text-[10px] leading-tight">
                  Connect a character, object, or location with a main image
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
                  <p className="text-[10px] text-center text-red-400 line-clamp-3" title={nodeData.errorMessage}>
                    {nodeData.errorMessage}
                  </p>
                )}
              </div>
            )}

            {/* Result + preview */}
            {status !== "running" && hasResult && activeImageUrl && (
              <>
                {results.length > 1 && (
                  <button
                    type="button"
                    className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-md z-10 opacity-0 group-hover/sheet:opacity-100 transition-opacity"
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

                {isMotion ? (
                  <video
                    src={activeImageUrl}
                    crossOrigin="anonymous"
                    controls
                    loop
                    muted
                    className="w-full h-full object-cover rounded-xl bg-black"
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget
                      if (v.videoWidth > 0) onLoadDimensions({ width: v.videoWidth, height: v.videoHeight })
                    }}
                  />
                ) : (
                  <CachedImage
                    src={activeImageUrl}
                    alt="Reference sheet"
                    className="w-full h-full object-cover rounded-xl"
                    thumbnail={!useFull}
                    thumbnailWidth={400}
                    onLoadDimensions={onLoadDimensions}
                  />
                )}

                {/* Panels-count badge — the `panels` output carries this many
                    clean reference images downstream. */}
                {panelCount > 0 && (
                  <div
                    className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/50 backdrop-blur-sm border border-white/10 text-white/90 rounded-md text-[10px] font-medium"
                    title={`${panelCount} clean panels available on the panels output`}
                  >
                    <LayoutGrid className="w-3 h-3" />
                    {panelCount} panels
                  </div>
                )}

                {/* Bottom-left: expand */}
                <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/sheet:opacity-100 transition-opacity">
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
                </div>

                {/* Bottom-right: delete + settings */}
                <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover/sheet:opacity-100 transition-opacity">
                  <button
                    type="button"
                    aria-label="Remove result"
                    className="w-7 h-7 flex items-center justify-center bg-black/50 hover:bg-black/70 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteConfirm(activeIndex)
                    }}
                    title="Delete this sheet"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
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

          {/* Bottom config summary — read-only; full editing in the config panel. */}
          <div className="shrink-0 px-2 py-1.5 border-t border-white/5 bg-black/20 flex items-center gap-2 text-[10px]">
            <span className="flex-1 truncate text-muted-foreground capitalize" title={`${nodeData.type} · ${nodeData.skin}`}>
              {nodeData.type?.replace(/-/g, " ") ?? "full reference"}
            </span>
            <span className="font-mono text-muted-foreground/80 shrink-0 capitalize">{nodeData.skin ?? "studio"}</span>
          </div>
        </div>
      </BaseNode>

      <HandleWithPopover nodeId={id} nodeType="reference-sheet" handleId="in"     type="target" position={Position.Left}  label="Subject" color={HANDLE_COLORS.identity}  icon={<ImageIcon />}  side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_ENTITY_REF} alwaysShowLabel />
      <HandleWithPopover nodeId={id} nodeType="reference-sheet" handleId="sheet"  type="source" position={Position.Right} label="Sheet"   color={HANDLE_COLORS.image}     icon={<ImageIcon />}  side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="reference-sheet" handleId="panels" type="source" position={Position.Right} label="Panels"  color={HANDLE_COLORS.reference} icon={<LayoutGrid />} side="right" top="56px" />

      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
        }}
      />

      {activeImageUrl && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type={isMotion ? "video" : "image"}
          url={activeImageUrl}
          results={results.map((r) => ({ url: r.url }))}
          initialIndex={activeIndex}
        />
      )}
    </div>
  )
}

export const ReferenceSheetNode = memo(ReferenceSheetNodeComponent)
