"use client"

import { memo, useState, useMemo, useEffect, useCallback } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { incomingSourcesFingerprint } from "@/lib/node-fingerprint"
import { Volume2, Loader2, AlertCircle, X, Film, Mic, Music, AudioWaveform, LayoutGrid } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { ResultsThumbnailsPanel } from "./results-thumbnails-panel"
import { ACCEPTS_MEDIA, FFMPEG_COLORS } from "@/lib/ffmpeg-handles"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { VideoResultOverlay } from "./video-result-overlay"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { MergeVideoAudioData } from "@/types/nodes"

const VIDEO_TYPES = new Set([
  "image-to-video", "video-to-video", "text-to-video", "generate-video",
  "lip-sync", "motion-transfer", "video-upscale",
  "combine-videos", "add-captions", "resize-video", "trim-video",
  "upload-video", "youtube-video",
])

function getSourceIcon(nodeType: string) {
  if (VIDEO_TYPES.has(nodeType)) return Film
  if (nodeType === "text-to-speech") return Mic
  if (nodeType === "generate-music") return Music
  if (nodeType === "text-to-audio") return AudioWaveform
  return Volume2
}

function MergeVideoAudioNodeComponent({ id, data, selected }: NodeProps) {
  const currentNodeData = useWorkflowStore((s) => s.nodes.find((n) => n.id === id)?.data) as MergeVideoAudioData | undefined
  const nodeData = currentNodeData ?? (data as MergeVideoAudioData)
  // Narrow subscription: a primitive fingerprint of the incoming connections
  // (source id + type + label) instead of whole-array `s.nodes` / `s.edges`.
  // `connectedSources` is the only consumer, so re-render only when an
  // incoming connection (or upstream label) changes — not on every unrelated
  // mutation that mints a fresh nodes array.
  const connectedFingerprint = useWorkflowStore((s) =>
    incomingSourcesFingerprint(s.nodes, s.edges, id, "label"),
  )
  const credits = useModelCredits("ffmpeg", 1)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const [previewOpen, setPreviewOpen] = useState(false)
  // jobId of the result pending deletion. STABLE across poll-job prepends
  // (poll-job.ts:144 unshifts new results into the array), unlike a
  // captured index which would point at the wrong result if the user
  // confirmed the dialog after a background poll completed.
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null)
  const [showThumbnails, setShowThumbnails] = useState(false)

  useEffect(() => { setVideoDimensions(null) }, [activeUrl])

  const hasResult = status !== "running" && !!activeUrl
  const canBrowseAlternates = !!activeUrl && results.length > 1

  const thumbResults = useMemo(
    () => results.map((r) => ({ url: r.thumbnailUrl ?? r.url, jobId: r.jobId })),
    [results],
  )
  const handleSelectResult = useCallback(
    (i: number) => updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: results[i].url }),
    [id, updateNodeData, results],
  )
  const requestDelete = useCallback(
    (i: number) => {
      const jobId = results[i]?.jobId
      if (jobId) setDeleteConfirm(jobId)
    },
    [results],
  )
  const activeJobId = activeResult?.jobId

  // Collect connected source info for display. Reads live arrays from
  // getState() at compute time; memoized on the incoming-connection
  // fingerprint so it only recomputes when that changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const connectedSources = useMemo(() => {
    const { nodes, edges } = useWorkflowStore.getState()
    const incoming = edges.filter((e) => e.target === id)
    return incoming
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter((n): n is typeof nodes[number] => n !== undefined)
      .map((n) => ({
        id: n.id,
        type: n.type,
        label: (n.data as Record<string, unknown>).label as string ?? n.type,
        isVideo: VIDEO_TYPES.has(n.type),
      }))
  }, [id, connectedFingerprint])

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  return (
    <div
      className="relative group/node"
      style={{
        width: hasResult ? (videoDimensions?.width ?? 220) : 220,
        height: hasResult ? (videoDimensions?.height ?? 160) : undefined,
        overflow: 'visible',
      }}
    >
      <EditableNodeLabel label={nodeData.label} icon={<Volume2 className="w-3.5 h-3.5" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Volume2 className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={220}
        className={hasResult ? "!border-0 !shadow-none !bg-transparent" : undefined}
        topToolbarContent={(<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />)}
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
        handles={[
          { id: "in", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
          { id: "video-out", type: "source", position: Position.Right, customStyle: { top: '24px', right: '-29px' }, external: true },
        ]}
      >
        {hasResult ? null : (
          <div className="flex flex-col gap-1">
            {status === "running" && (
              <div className="flex flex-col items-center justify-center gap-2 h-28 rounded-md bg-muted/30">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <NodeJobProgress progress={nodeData.currentJobProgress} />
              </div>
            )}

            {status === "failed" && !activeUrl && (
              <div className="flex flex-col items-center justify-center gap-1 h-16 rounded-md bg-red-500/5 text-red-500 p-2">
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="font-medium">Failed</span>
                </div>
                {nodeData.errorMessage && (
                  <p className="text-[10px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>
                    {nodeData.errorMessage}
                  </p>
                )}
              </div>
            )}

            {status !== "running" && !activeUrl && status !== "failed" && (
              <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
                <Volume2 className="w-5 h-5" />
              </div>
            )}

            {/* Connected sources display */}
            {connectedSources.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {connectedSources.map((src) => {
                  const Icon = getSourceIcon(src.type)
                  return (
                    <div
                      key={src.id}
                      className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] ${src.isVideo ? "bg-blue-500/10 text-blue-400" : "bg-purple-500/10 text-purple-400"}`}
                      title={src.label}
                    >
                      <Icon className="w-2.5 h-2.5" />
                      <span className="truncate max-w-[50px]">{src.label}</span>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="flex justify-between text-muted-foreground text-[10px]">
              <span>{nodeData.keepOriginalAudio !== false ? "Keep orig audio" : "No orig audio"}</span>
              {Object.keys(nodeData.trackSettings ?? {}).length > 0 && (
                <span>{Object.keys(nodeData.trackSettings ?? {}).length} tracks</span>
              )}
            </div>
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
          title={showThumbnails ? "Hide versions" : "Show versions"}
          aria-pressed={showThumbnails}
        >
          <LayoutGrid className="w-3 h-3" />
          <span className="text-[11px] font-medium">{results.length}</span>
        </button>
      )}
      {hasResult && (
        <VideoResultOverlay
          url={activeUrl}
          onEdit={() => openFreeCut(id, activeUrl!, activeResult?.freecutProjectUrl)}
          videoAutoplay={videoAutoplay}
          label={nodeData.label}
          hasResults={results.length > 0}
          onExpand={() => setPreviewOpen(true)}
          onDelete={() => { if (activeJobId) setDeleteConfirm(activeJobId) }}
          onDimensionsChange={setVideoDimensions}
          onSettings={() => selectNode(isSettingsOpen ? null : id)}
          isSettingsOpen={isSettingsOpen}
        />
      )}
      <HandleWithPopover nodeId={id} nodeType="merge-video-audio" handleId="in"        type="target" position={Position.Left}  label="Media" color={FFMPEG_COLORS.media} icon={<Film />} side="left"  top="calc(100% - 24px)" orderMatters accepts={ACCEPTS_MEDIA} />
      <HandleWithPopover nodeId={id} nodeType="merge-video-audio" handleId="video-out" type="source" position={Position.Right} label="Video" color={FFMPEG_COLORS.video} icon={<Film />} side="right" top="24px" />
      {activeUrl && (
        <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type="video" url={activeUrl} results={results} initialIndex={activeIndex} />
      )}
      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          // Resolve the stored jobId back to its CURRENT index in the
          // (possibly-shifted) results array. Stale jobId (e.g., the
          // result was deleted by another action while the dialog was
          // open) safely no-ops via the findIndex === -1 guard.
          if (deleteConfirm === null) return
          const currentIndex = results.findIndex((r) => r.jobId === deleteConfirm)
          if (currentIndex >= 0) handleDeleteResult(currentIndex)
        }}
      />
    </div>
  )
}

export const MergeVideoAudioNode = memo(MergeVideoAudioNodeComponent)
