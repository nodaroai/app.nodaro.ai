"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { AlertCircle, Film, LayoutGrid, Loader2, Scissors } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { NodeJobProgress } from "./node-job-progress"
import { NodeQuickStrip } from "./node-quick-strip"
import { ResultsThumbnailsPanel } from "./results-thumbnails-panel"
import { UgcInputPips, ugcNodeHandles, ugcPipTop } from "./ugc-node-pips"
import { VideoResultOverlay } from "./video-result-overlay"
import { videoNodeSizing } from "./video-node-defaults"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useT } from "@/lib/i18n"
import { computeDeleteResultUpdates } from "@/lib/utils"
import { ugcNodeMessageText } from "@/lib/ugc-copy"
import type { UgcFinishClipsData } from "@/types/nodes"

const OUTPUTS = ["video-out"] as const

/**
 * UGC Finish: every clip of a UGC video at once, handed on in order, ready to join. A video node: it shows the
 * finished clips (its carousel steps through them), the first one by default.
 */
function UgcFinishClipsNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const d = data as UgcFinishClipsData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const status = d.executionStatus ?? "idle"
  const running = status === "running"
  const results = d.generatedResults ?? []
  const activeIndex = d.activeResultIndex ?? 0
  // Result aspect drives node sizing — 16:9 until a clip lands, then the clip's own.
  const { aspectRatio: mediaAspectRatio, onLoadDimensions } = useResultAspectRatio(id, results, activeIndex)
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? d.generatedVideoUrl

  const [previewOpen, setPreviewOpen] = useState(false)
  // The jobId of the result pending deletion: stable while a run prepends results.
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [videoError, setVideoError] = useState(false)
  const [showThumbnails, setShowThumbnails] = useState(false)
  useEffect(() => {
    setVideoError(false)
  }, [activeUrl])

  const hasResult = !running && !!activeUrl && !videoError
  const canBrowseAlternates = !!activeUrl && results.length > 1
  const thumbResults = useMemo(() => results.map((r) => ({ url: r.thumbnailUrl ?? r.url, jobId: r.jobId })), [results])
  const handleSelectResult = useCallback(
    (i: number) => updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: results[i]!.url }),
    [id, updateNodeData, results],
  )
  const requestDelete = useCallback((i: number) => {
    const jobId = results[i]?.jobId
    if (jobId) setDeleteConfirm(jobId)
  }, [results])
  const activeJobId = activeResult?.jobId

  return (
    <div className="relative group/node" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      <EditableNodeLabel
        label={d.label}
        icon={<Scissors className="w-3.5 h-3.5" />}
        onSave={(label) => updateNodeData(id, { label })}
      />
      <BaseNode
        id={id}
        label={d.label}
        icon={<Scissors className="h-4 w-4" />}
        category="ai"
        selected={selected}
        isRunning={running}
        hideHeader
        {...videoNodeSizing(mediaAspectRatio)}
        className={hasResult ? "!border-0 !shadow-none !bg-transparent" : undefined}
        topToolbarContent={<NodeQuickStrip nodeId={id} isRunning={running} />}
        bottomToolbarContent={
          showThumbnails && canBrowseAlternates ? (
            <ResultsThumbnailsPanel
              results={thumbResults}
              activeIndex={activeIndex}
              nodeSelected={!!selected || isSettingsOpen}
              onSelect={handleSelectResult}
              mediaType="video"
              onDelete={requestDelete}
            />
          ) : undefined
        }
        handles={ugcNodeHandles("ugc-finish-clips", OUTPUTS)}
      >
        {hasResult ? null : (
          <div className="flex flex-col gap-1">
            {running && (
              <div className="flex flex-col items-center justify-center gap-2 h-28 rounded-md bg-muted/30">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <NodeJobProgress progress={d.currentJobProgress} />
              </div>
            )}
            {!running && activeUrl && videoError && (
              <div className="w-full h-28 rounded-md bg-amber-500/10 border border-amber-500/30 flex flex-col items-center justify-center gap-1">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                <span className="text-[10px] text-amber-500">{t("node.videoLoadFailed")}</span>
                <a href={activeUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 underline" onClick={(e) => e.stopPropagation()}>{t("node.openUrl")}</a>
              </div>
            )}
            {status === "failed" && !activeUrl && (
              <div className="flex flex-col items-center justify-center gap-1 rounded-md bg-red-500/5 text-red-500 p-2">
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="font-medium">{t("node.failed")}</span>
                </div>
                {d.errorMessage && (
                  <p dir="auto" className="text-[10px] text-center text-red-400 line-clamp-3" title={ugcNodeMessageText(d.errorMessage)}>
                    {ugcNodeMessageText(d.errorMessage)}
                  </p>
                )}
              </div>
            )}
            {!running && !activeUrl && status !== "failed" && (
              <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
                <Scissors className="w-5 h-5" />
              </div>
            )}
          </div>
        )}
      </BaseNode>
      {canBrowseAlternates && (
        <button
          type="button"
          className={`absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 backdrop-blur-sm border rounded-md z-20 transition-opacity ${
            showThumbnails
              ? "bg-[#ff0073] hover:bg-[#ff0073]/90 border-[#ff0073] text-white opacity-100"
              : "bg-black/40 hover:bg-black/60 border-white/10 text-white opacity-0 group-hover/node:opacity-100"
          }`}
          onClick={(e) => { e.stopPropagation(); setShowThumbnails((v) => !v) }}
          title={showThumbnails ? t("node.hideVersions") : t("node.showVersions")}
          aria-pressed={showThumbnails}
        >
          <LayoutGrid className="w-3 h-3" />
          <span className="text-[11px] font-medium">{results.length}</span>
        </button>
      )}
      {hasResult && (
        <VideoResultOverlay
          url={activeUrl}
          videoAutoplay={videoAutoplay}
          label={d.label}
          hasResults={results.length > 0}
          onExpand={() => setPreviewOpen(true)}
          onDelete={() => { if (activeJobId) setDeleteConfirm(activeJobId) }}
          onRawDimensions={onLoadDimensions}
          onVideoError={() => setVideoError(true)}
          onVideoLoad={() => setVideoError(false)}
          onSettings={() => selectNode(isSettingsOpen ? null : id)}
          isSettingsOpen={isSettingsOpen}
        />
      )}

      <UgcInputPips nodeId={id} nodeType="ugc-finish-clips" />
      <HandleWithPopover nodeId={id} nodeType="ugc-finish-clips" handleId="video-out" type="source" position={Position.Right} label="Video" color={HANDLE_COLORS.video} icon={<Film />} side="right" top={ugcPipTop(0)} />

      {activeUrl && <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type="video" url={activeUrl} results={results} initialIndex={activeIndex} />}
      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          // The stored jobId back to its CURRENT index; a stale one no-ops.
          if (deleteConfirm === null) return
          const currentIndex = results.findIndex((r) => r.jobId === deleteConfirm)
          if (currentIndex >= 0) updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, currentIndex, "generatedVideoUrl"))
        }}
      />
    </div>
  )
}

export const UgcFinishClipsNode = memo(UgcFinishClipsNodeComponent)
