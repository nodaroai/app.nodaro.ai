"use client"

import { memo, useEffect, useRef, useState, useCallback } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Video, Upload, Link, Loader2, AlertCircle, X, Play, Expand, Download, Scissors, LayoutGrid } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { Film } from "lucide-react"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useUpstreamUrl } from "@/hooks/use-upstream-url"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { copyToClipboard } from "@/lib/utils"
import { useFileUpload } from "@/hooks/use-file-upload"
import { useMediaEditor, MediaEditorModal } from "@/components/editor/media-editor"
import { StorageExceededModal } from "@/ee/components/credits/StorageExceededModal"
import { CachedImage } from "@/components/ui/cached-image"
import type { UploadVideoData, GeneratedResult } from "@/types/nodes"

const HANDLES = [
  { id: "in",    type: "target" as const, position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
  { id: "video", type: "source" as const, position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
] as const


function UploadVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as UploadVideoData
  const [mode, setMode] = useState<"upload" | "url">(nodeData.externalUrl ? "url" : "upload")
  const [previewOpen, setPreviewOpen] = useState(false)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const uploadVideoRef = useRef<HTMLVideoElement>(null)
  const playState = nodeData.videoPlayState ?? "loop"
  const shouldPlay = videoAutoplay && playState === "loop"
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const { isUploading, uploadError, clearError, storageExceeded, clearStorageExceeded } = useFileUpload()
  const mediaEditor = useMediaEditor({
    onComplete: async (uploadResults) => {
      const result = uploadResults[0]
      if (!result) return
      const url = result.processedUrl ?? result.uploadResult.url
      const thumb = result.processedThumbnailUrl ?? result.uploadResult.thumbnailUrl ?? ""
      const meta = result.uploadResult.metadata
      const newResult: GeneratedResult = {
        url,
        thumbnailUrl: thumb || undefined,
        jobId: `upload-${Date.now()}`,
        timestamp: new Date().toISOString(),
        ...(meta?.width && meta?.height ? { width: meta.width, height: meta.height } : {}),
        ...(meta?.durationSeconds !== undefined ? { duration: meta.durationSeconds } : {}),
      }
      updateNodeData(id, {
        assetId: result.uploadResult.assetId ?? "",
        url,
        r2Url: url,
        thumbnailUrl: thumb,
        filename: result.uploadResult.filename,
        fileSize: result.uploadResult.sizeBytes,
        mimeType: result.uploadResult.mimeType,
        metadata: result.uploadResult.metadata ?? {},
        isUploading: false,
        uploadError: "",
        externalUrl: "",
        generatedResults: [...(nodeData.generatedResults ?? []), newResult],
        activeResultIndex: (nodeData.generatedResults ?? []).length,
      })
    },
  })
  useUpstreamUrl(id, nodeData.externalUrl, updateNodeData)

  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const videoUrl = activeResult?.url ?? nodeData.r2Url ?? nodeData.url
  const thumbnailUrl = activeResult?.thumbnailUrl ?? nodeData.thumbnailUrl
  const hasFile = Boolean(videoUrl) && !nodeData.externalUrl
  const [isDragOver, setIsDragOver] = useState(false)
  // Result-stored dimensions are preferred (synchronous on switch). Legacy
  // path (externalUrl) gets a local-state fallback populated by the rendered
  // <video> below via onLoadedMetadata.
  const { aspectRatio: resultRatio, onLoadDimensions: onResultLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)
  const [legacyRatio, setLegacyRatio] = useState<number | undefined>()
  const mediaAspectRatio = resultRatio ?? legacyRatio
  const handleLoadDimensions = ({ width, height }: { width: number; height: number }) => {
    onResultLoadDimensions({ width, height })
    if (!resultRatio && width > 0) setLegacyRatio(width / height)
  }

  useEffect(() => {
    const v = uploadVideoRef.current
    if (!v || !videoUrl) return
    if (playState === "paused") {
      v.pause()
      if (nodeData.pausedAtTime !== undefined) v.currentTime = nodeData.pausedAtTime
    } else if (playState === "stopped") {
      v.pause()
      v.currentTime = 0
    } else if (shouldPlay) {
      v.play().catch(() => {})
    }
  }, [playState, shouldPlay, videoUrl, nodeData.pausedAtTime])

  const handleVideoStateChange = useCallback((state: { playState: "loop" | "paused" | "stopped"; currentTime: number }) => {
    updateNodeData(id, { videoPlayState: state.playState, pausedAtTime: state.currentTime })
  }, [id, updateNodeData])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    clearError()
    mediaEditor.openEditor([file])
    e.target.value = ""
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith("video/")) {
      clearError()
      mediaEditor.openEditor([file])
    }
  }

  const handleUrlChange = (url: string) => {
    updateNodeData(id, {
      externalUrl: url,
      url: url,
      r2Url: "",
      thumbnailUrl: "",
      assetId: "",
      filename: "",
      fileSize: 0,
      mimeType: "",
      metadata: {},
    })
  }

  const handleClear = () => {
    updateNodeData(id, {
      assetId: "",
      url: "",
      r2Url: "",
      thumbnailUrl: "",
      filename: "",
      fileSize: 0,
      mimeType: "",
      externalUrl: "",
      metadata: {},
      uploadError: "",
    })
  }

  return (
    <>
    <div className="relative max-w-[220px]">
      {/* Floating label above node */}
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Video className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Video className="h-4 w-4" />}
        category="input"
        credits={0}
        selected={selected}
        minWidth={220}
        imageAspectRatio={mediaAspectRatio}
        hideHeader
        handles={HANDLES}
        bottomToolbarContent={
          showThumbnails && results.length > 1 ? (
            <div className="flex gap-2 px-2 py-1.5 bg-black/60 backdrop-blur-sm rounded-xl border border-white/10">
              {results.slice(0, 8).map((r, i) => (
                r.thumbnailUrl ? (
                  <CachedImage
                    key={`${r.jobId}-${i}`}
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
                    key={`${r.jobId}-${i}`}
                    src={r.url}
                    crossOrigin="anonymous"
                    muted
                    className={`w-16 h-16 object-cover rounded-lg cursor-pointer transition-all ${
                      i === activeIndex ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url })
                    }}
                  />
                )
              ))}
            </div>
          ) : undefined
        }
      >
        <input
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/x-msvideo"
          onChange={handleFileSelect}
          className="hidden"
          ref={fileInputRef}
        />
        {/* Flush: video result display (when hasFile=true and not uploading) */}
        {!isUploading && !nodeData.isUploading && hasFile && mode === "upload" && (
          <div className="relative w-full h-full group">
            {results.length > 1 && (
              <button
                type="button"
                className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-md z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); setShowThumbnails(v => !v) }}
                title="Show versions"
              >
                <LayoutGrid className="w-3 h-3" />
                <span className="text-[11px] font-medium">{results.length}</span>
              </button>
            )}
            <video
              ref={uploadVideoRef}
              src={videoUrl}
              crossOrigin="anonymous"
              poster={thumbnailUrl || undefined}
              autoPlay={shouldPlay}
              loop={shouldPlay}
              muted
              playsInline
              className="w-full h-full object-cover rounded-xl"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                if (v.videoWidth > 0) handleLoadDimensions({ width: v.videoWidth, height: v.videoHeight })
              }}
            />
            {!shouldPlay && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
                  <Play className="w-5 h-5 text-white ml-0.5" />
                </div>
              </div>
            )}
            {/* Top-right: delete */}
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button type="button" aria-label="Remove video"
                className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-red-600/80 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => { e.stopPropagation(); handleClear() }}
                title="Remove">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {/* Bottom-left: action buttons */}
            <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button type="button" aria-label="Upload another video" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }} title="Upload another">
                <Upload className="w-3.5 h-3.5" />
              </button>
              <button type="button" aria-label="Expand video" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }} title="Expand">
                <Expand className="w-3.5 h-3.5" />
              </button>
              <button type="button" aria-label="Download" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  const a = document.createElement('a')
                  a.href = '/v1/image-proxy?url=' + encodeURIComponent(videoUrl) + '&download=1'
                  a.download = (nodeData.label || 'video') + '.mp4'
                  a.click()
                }} title="Download">
                <Download className="w-3.5 h-3.5" />
              </button>
              <button type="button" aria-label="Copy URL" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  copyToClipboard(videoUrl, "URL copied")
                }} title="Copy URL">
                <Link className="w-3.5 h-3.5" />
              </button>
              <button type="button" aria-label="Edit in FreeCut" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => { e.stopPropagation(); openFreeCut(id, videoUrl, undefined) }} title="Edit in FreeCut">
                <Scissors className="w-3.5 h-3.5" />
              </button>
              <SaveToLibraryButton url={videoUrl} type="video" />
            </div>
          </div>
        )}

        {/* Padded: all other states (uploading, error, empty upload, URL mode) */}
        {(isUploading || nodeData.isUploading || !hasFile || mode !== "upload") && (
          <div className="p-3">
            {/* Uploading state */}
            {(isUploading || nodeData.isUploading) && (
              <div className="flex flex-col items-center gap-2 py-3">
                <Loader2 className="w-5 h-5 animate-spin text-[#38BDF8]" />
                <p className="text-xs text-muted-foreground">Uploading...</p>
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-[#38BDF8] rounded-full animate-pulse" style={{ width: "60%" }} />
                </div>
              </div>
            )}

            {/* Error state */}
            {!isUploading && !nodeData.isUploading && (uploadError || nodeData.uploadError) && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-red-500/10 text-red-400 text-xs">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{uploadError || nodeData.uploadError}</span>
              </div>
            )}

            {/* Upload mode - empty state */}
            {!isUploading && !nodeData.isUploading && mode === "upload" && !hasFile && (
              <>
                <button
                  type="button"
                  className={`w-full flex items-center justify-center gap-2 h-16 rounded-md border-2 border-dashed transition-colors cursor-pointer ${
                    isDragOver
                      ? "border-[#38BDF8] bg-[#38BDF8]/10 text-[#38BDF8]"
                      : "border-muted-foreground/20 hover:border-[#38BDF8]/50 hover:bg-[#38BDF8]/5 text-muted-foreground/60 hover:text-[#38BDF8]"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    fileInputRef.current?.click()
                  }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true) }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                >
                  <Upload className="w-4 h-4" />
                  <span className="text-xs">{isDragOver ? "Drop Video" : "Choose Video"}</span>
                </button>
                <button
                  type="button"
                  className="w-full text-center text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors mt-1"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMode("url")
                  }}
                >
                  or use URL
                </button>
              </>
            )}

            {/* URL mode */}
            {!isUploading && !nodeData.isUploading && mode === "url" && (
              <>
                <div className="flex items-center gap-1.5">
                  <Link className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                  <input
                    type="text"
                    value={nodeData.externalUrl || nodeData.url || ""}
                    onChange={(e) => {
                      e.stopPropagation()
                      handleUrlChange(e.target.value)
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="https://..."
                    className="w-full bg-transparent border-b border-muted-foreground/20 text-xs py-1 outline-none focus:border-[#38BDF8] transition-colors placeholder:text-muted-foreground/30"
                  />
                </div>
                <button
                  type="button"
                  className="w-full text-center text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors mt-1"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMode("upload")
                  }}
                >
                  or upload file
                </button>
              </>
            )}
          </div>
        )}
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="upload-video" handleId="in"    type="target" position={Position.Left}  label="URL"   color={TEXT_HANDLE_COLOR} icon={<Video />} side="left"  top="calc(100% - 24px)" />
      <HandleWithPopover nodeId={id} nodeType="upload-video" handleId="video" type="source" position={Position.Right} label="Video" color={HANDLE_COLORS.video} icon={<Film />}  side="right" top="24px" />
    </div>
    {videoUrl && (
      <MediaPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        type="video"
        url={videoUrl}
        onVideoStateChange={handleVideoStateChange}
        initialVideoPlayState={nodeData.videoPlayState}
        initialPausedAtTime={nodeData.pausedAtTime}
      />
    )}

    <StorageExceededModal
      open={storageExceeded.exceeded}
      onClose={clearStorageExceeded}
      usedBytes={storageExceeded.usedBytes}
      quotaBytes={storageExceeded.quotaBytes}
      tier={storageExceeded.tier}
    />

    <MediaEditorModal editor={mediaEditor} />
    </>
  )
}

export const UploadVideoNode = memo(UploadVideoNodeComponent)
