"use client"

import { useT, type MessageKey } from "@/lib/i18n"
import { memo, useState, useEffect, useMemo, useCallback } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Music4, Loader2, AlertCircle, X, Film, Music, LayoutGrid, AudioLines } from "lucide-react"
import { replaceAudioMode, replaceAudioMusicSource, replaceAudioNodeCreditId } from "@nodaro/render-rules"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { ResultsThumbnailsPanel } from "./results-thumbnails-panel"
import { useUnitNodeKit } from "./use-unit-node-kit"
import { VideoResultOverlay } from "./video-result-overlay"
import { videoNodeSizing } from "./video-node-defaults"
import { WaveformAudioPlayer } from "@/components/audio-player"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { FFMPEG_COLORS } from "@/lib/ffmpeg-handles"
import { REPLACE_AUDIO_MUSIC_HANDLE, REPLACE_AUDIO_TARGET_HANDLES, REPLACE_AUDIO_VIDEO_HANDLE } from "@/lib/replace-audio-handles"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { GeneratedResult, ReplaceAudioNodeData } from "@/types/nodes"

const acceptsOf = (handleId: string) => REPLACE_AUDIO_TARGET_HANDLES.find((h) => h.handleId === handleId)?.accepts

/** The tracks a take carries beside its video, in the order the node lists them. */
const TRACKS: ReadonlyArray<{ readonly field: "speechUrl" | "musicUrl" | "mixUrl"; readonly labelKey: MessageKey }> = [
  { field: "speechUrl", labelKey: "replaceAudio.trackSpeech" },
  { field: "musicUrl", labelKey: "replaceAudio.trackMusic" },
  { field: "mixUrl", labelKey: "replaceAudio.trackMix" },
]

/** The tracks of `result` that are there (a replace-all take has no speech). */
function replaceAudioTracksOf(result: GeneratedResult | undefined): ReadonlyArray<{ readonly url: string; readonly labelKey: MessageKey }> {
  if (!result) return []
  return TRACKS.flatMap(({ field, labelKey }) => {
    const url = result[field]
    return typeof url === "string" && url.length > 0 ? [{ url, labelKey }] : []
  })
}

const MODE_KEYS: Readonly<Record<"keep-speech" | "replace-all", MessageKey>> = {
  "keep-speech": "replaceAudio.modeKeepSpeech",
  "replace-all": "replaceAudio.modeReplaceAll",
}
const SOURCE_KEYS: Readonly<Record<"input" | "prompt", MessageKey>> = {
  input: "replaceAudio.musicFromInput",
  prompt: "replaceAudio.musicFromPrompt",
}

// Replace Audio (Nodaro Cloud): a video in `in`, the new music in `music` (or a
// prompt it is made from) → the video with its sound replaced on `video-out`.
// Laid out like merge-video-audio-node; the take's speech / music / mix play
// from a tracks panel over the video's lower part.
function ReplaceAudioNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as ReplaceAudioNodeData
  const kit = useUnitNodeKit(id)
  const { updateNodeData, isSettingsOpen, videoAutoplay } = kit
  // The row the node's settings quote (the panel's Run button reads the same).
  const credits = useModelCredits(replaceAudioNodeCreditId(nodeData))
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const tracks = replaceAudioTracksOf(activeResult)
  const [previewOpen, setPreviewOpen] = useState(false)
  // jobId of the result pending deletion — stable across poll prepends.
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [videoError, setVideoError] = useState(false)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [showTracks, setShowTracks] = useState(false)

  useEffect(() => {
    setVideoError(false)
  }, [activeUrl])

  // Result aspect drives node sizing — 16:9 until a result lands, then the real
  // video aspect (raw dims fed in via the overlay's onRawDimensions).
  const { aspectRatio: mediaAspectRatio, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)
  const hasResult = status !== "running" && !!activeUrl && !videoError
  const canBrowseAlternates = !!activeUrl && results.length > 1

  const thumbResults = useMemo(
    () => results.map((r) => ({ url: r.thumbnailUrl ?? r.url, jobId: r.jobId })),
    [results],
  )
  const handleSelectResult = useCallback(
    (i: number) => updateNodeData({ activeResultIndex: i, generatedVideoUrl: results[i].url }),
    [updateNodeData, results],
  )
  const requestDelete = useCallback(
    (i: number) => {
      const jobId = results[i]?.jobId
      if (jobId) setDeleteConfirm(jobId)
    },
    [results],
  )
  const activeJobId = activeResult?.jobId

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  const mode = replaceAudioMode(nodeData.mode)
  const musicSource = replaceAudioMusicSource(nodeData.musicSource)

  return (
    <div className="relative group/node" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      <EditableNodeLabel label={nodeData.label} icon={<Music4 className="w-3.5 h-3.5" />} onSave={(newLabel) => updateNodeData({ label: newLabel })} />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Music4 className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        {...videoNodeSizing(mediaAspectRatio)}
        className={hasResult ? "!border-0 !shadow-none !bg-transparent" : undefined}
        topToolbarContent={(<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={() => kit.run()} />)}
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
          { id: REPLACE_AUDIO_VIDEO_HANDLE, type: "target", position: Position.Left, customStyle: { top: "calc(100% - 56px)", left: "-29px" }, external: true },
          { id: REPLACE_AUDIO_MUSIC_HANDLE, type: "target", position: Position.Left, customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
          { id: "video-out", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
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

            {status !== "running" && activeUrl && videoError && (
              <div className="relative group">
                <div className="w-full h-28 rounded-md bg-amber-500/10 border border-amber-500/30 flex flex-col items-center justify-center gap-1">
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                  <span className="text-[11px] text-amber-500">{t("node.videoLoadFailed")}</span>
                  <a href={activeUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-500 underline" onClick={(e) => e.stopPropagation()}>{t("node.openUrl")}</a>
                </div>
                {results.length > 0 && (
                  <button type="button" aria-label={t("common.remove")} className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); if (activeJobId) setDeleteConfirm(activeJobId) }}><X className="w-3 h-3" /></button>
                )}
              </div>
            )}

            {status === "failed" && !activeUrl && (
              <div className="flex flex-col items-center justify-center gap-1 h-16 rounded-md bg-red-500/5 text-red-500 p-2">
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="font-medium">{t("node.failed")}</span>
                </div>
                {nodeData.errorMessage && (
                  <p className="text-[11px] text-center text-red-400 line-clamp-2" title={nodeData.errorMessage}>
                    {nodeData.errorMessage}
                  </p>
                )}
              </div>
            )}

            {status !== "running" && !activeUrl && status !== "failed" && (
              <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground">
                <Music4 className="w-5 h-5" />
              </div>
            )}

            <div className="flex justify-between gap-2 text-muted-foreground text-[11px]">
              <span className="truncate">{t(MODE_KEYS[mode])}</span>
              <span className="truncate">{t(SOURCE_KEYS[musicSource])}</span>
            </div>
          </div>
        )}
      </BaseNode>

      {canBrowseAlternates && (
        <button
          type="button"
          className={`absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 backdrop-blur-sm border rounded-md z-20 transition-opacity ${
            showThumbnails
              ? "bg-cta hover:bg-cta-hover border-[#ff0073] text-white opacity-100"
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
          onEdit={() => kit.openFreeCut(activeUrl!, activeResult?.freecutProjectUrl)}
          videoAutoplay={videoAutoplay}
          label={nodeData.label}
          hasResults={results.length > 0}
          onExpand={() => setPreviewOpen(true)}
          onDelete={() => { if (activeJobId) setDeleteConfirm(activeJobId) }}
          onRawDimensions={handleLoadDimensions}
          onVideoError={() => setVideoError(true)}
          onVideoLoad={() => setVideoError(false)}
          onSettings={() => kit.toggleSettings()}
          isSettingsOpen={isSettingsOpen}
        />
      )}
      {hasResult && tracks.length > 0 && (
        <button
          type="button"
          className={`absolute top-2 ${canBrowseAlternates ? "left-12" : "left-2"} flex items-center gap-1 px-1.5 py-0.5 backdrop-blur-sm border rounded-md z-20 transition-opacity ${
            showTracks
              ? "bg-cta hover:bg-cta-hover border-[#ff0073] text-white opacity-100"
              : "bg-black/40 hover:bg-black/60 border-white/10 text-white opacity-0 group-hover/node:opacity-100"
          }`}
          onClick={(e) => { e.stopPropagation(); setShowTracks((v) => !v) }}
          title={showTracks ? t("replaceAudio.hideTracks") : t("replaceAudio.showTracks")}
          aria-pressed={showTracks}
          data-testid="replace-audio-tracks-toggle"
        >
          <AudioLines className="w-3 h-3" />
          <span className="text-[11px] font-medium">{t("replaceAudio.tracks")}</span>
        </button>
      )}
      {hasResult && showTracks && tracks.length > 0 && (
        <div
          className="absolute left-2 right-2 bottom-11 z-20 flex flex-col gap-1.5 rounded-md bg-black/70 backdrop-blur-sm p-2 nodrag nopan nowheel"
          onClick={(e) => e.stopPropagation()}
          data-testid="replace-audio-tracks"
        >
          {tracks.map((track) => (
            <div key={track.labelKey} className="flex flex-col gap-0.5">
              <span className="text-[11px] text-white/80">{t(track.labelKey)}</span>
              <WaveformAudioPlayer url={track.url} variant="mini" isInsideCanvas className="w-full" />
            </div>
          ))}
        </div>
      )}

      <HandleWithPopover nodeId={id} nodeType="replace-audio" handleId="in"        type="target" position={Position.Left}  label="Video" color={FFMPEG_COLORS.video} icon={<Film />}  side="left"  top="calc(100% - 56px)" accepts={acceptsOf(REPLACE_AUDIO_VIDEO_HANDLE)} />
      <HandleWithPopover nodeId={id} nodeType="replace-audio" handleId="music"     type="target" position={Position.Left}  label="Music" color={FFMPEG_COLORS.media} icon={<Music />} side="left"  top="calc(100% - 24px)" accepts={acceptsOf(REPLACE_AUDIO_MUSIC_HANDLE)} />
      <HandleWithPopover nodeId={id} nodeType="replace-audio" handleId="video-out" type="source" position={Position.Right} label="Video" color={FFMPEG_COLORS.video} icon={<Film />}  side="right" top="24px" />
      {activeUrl && (
        <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type="video" url={activeUrl} results={results} initialIndex={activeIndex} />
      )}
      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm === null) return
          const currentIndex = results.findIndex((r) => r.jobId === deleteConfirm)
          if (currentIndex >= 0) handleDeleteResult(currentIndex)
        }}
      />
    </div>
  )
}

export const ReplaceAudioNode = memo(ReplaceAudioNodeComponent)
