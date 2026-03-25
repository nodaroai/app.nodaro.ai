import { useMemo, useRef } from "react"
import { createPortal } from "react-dom"
import { X, Loader2, ArrowRight } from "lucide-react"
import { AspectRatioSelector } from "../config-panels/aspect-ratio-selector"
import { CropPanel } from "./crop-panel"
import { TrimPanel } from "./trim-panel"
import { FormatPanel } from "./format-panel"
import { ASPECT_RATIO_OPTIONS, type MediaEditorState } from "./utils"
import type { useMediaEditor } from "./use-media-editor"

type MediaEditorReturn = ReturnType<typeof useMediaEditor>

interface MediaEditorModalProps {
  editor: MediaEditorReturn
}

export function MediaEditorModal({ editor }: MediaEditorModalProps) {
  const {
    isOpen,
    currentFile,
    currentIndex,
    totalFiles,
    editorState,
    setEditorState,
    isProcessing,
    isConverting,
    allSameType,
    handleUploadCurrent,
    handleApplyAll,
    handleCancel,
    handleReset,
  } = editor

  const videoRef = useRef<HTMLVideoElement>(null)

  if (!isOpen || !currentFile) return null

  const { mediaType } = currentFile
  const isMultiFile = totalFiles > 1
  const isLastFile = currentIndex === totalFiles - 1

  const mediaUrl = currentFile.convertedUrl ?? currentFile.objectUrl

  const title =
    mediaType === "image"
      ? "Adjust Image"
      : mediaType === "video"
        ? "Adjust Video"
        : "Adjust Audio"

  const originalFormat =
    currentFile.file.name.split(".").pop()?.toLowerCase() ??
    currentFile.file.type.split("/").pop() ??
    "unknown"

  const updateState = (partial: Partial<MediaEditorState>) => {
    setEditorState((prev: MediaEditorState) => ({ ...prev, ...partial }))
  }

  // Compute output info
  const outputInfo = useMemo(() => {
    const dw = editorState.displayWidth
    const dh = editorState.displayHeight
    const { crop } = editorState
    const nw = currentFile.naturalWidth
    const nh = currentFile.naturalHeight

    // Output dimensions
    let outW = nw
    let outH = nh
    if (crop && dw > 0 && dh > 0) {
      const scaleX = nw / dw
      const scaleY = nh / dh
      outW = Math.round(crop.width * scaleX)
      outH = Math.round(crop.height * scaleY)
    }
    const isCropped = outW !== nw || outH !== nh

    // Output format
    const outFormat = (editorState.format ?? originalFormat).toUpperCase()

    // Output duration (video/audio)
    const trim = editorState.trim
    const origDuration = currentFile.duration
    const outDuration = trim ? trim.endTime - trim.startTime : origDuration
    const isTrimmed = trim && (trim.startTime > 0.05 || trim.endTime < origDuration - 0.05)

    // File size estimate (rough — assume proportional to pixel count × duration ratio)
    const origSize = currentFile.file.size
    const pixelRatio = (outW * outH) / Math.max(nw * nh, 1)
    const durationRatio = origDuration > 0 ? outDuration / origDuration : 1
    const estimatedSize = mediaType === "audio"
      ? Math.round(origSize * durationRatio)
      : Math.round(origSize * pixelRatio * durationRatio)

    return { outW, outH, outFormat, outDuration, isCropped, isTrimmed, origSize, estimatedSize, nw, nh, origDuration }
  }, [editorState, currentFile, originalFormat, mediaType])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm">
      {/* Dialog — sizes to content, capped at viewport */}
      <div className="flex flex-col bg-[#0d0d0d] border border-white/10 rounded-2xl shadow-2xl max-h-[90vh] max-w-[90vw] w-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-white">{title}</h2>
            {isMultiFile && (
              <span className="text-xs text-white/50 bg-white/10 px-2.5 py-0.5 rounded-full">
                {currentIndex + 1} of {totalFiles}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="text-white/50 hover:text-white transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body — scrollable, content drives width */}
        <div className="flex-1 overflow-y-auto px-6 py-5 min-w-[320px]">
          {isConverting ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 className="w-10 h-10 animate-spin text-[#ff0073]" />
              <span className="text-sm text-white/60">Converting video...</span>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Crop panel (image + video) */}
              {(mediaType === "image" || mediaType === "video") && (
                <CropPanel
                  mediaUrl={mediaUrl}
                  mediaType={mediaType}
                  naturalWidth={currentFile.naturalWidth}
                  naturalHeight={currentFile.naturalHeight}
                  aspectRatio={editorState.aspectRatio}
                  crop={editorState.crop}
                  onCropChange={(crop) => updateState({ crop })}
                  onDisplaySizeChange={(w, h) => updateState({ displayWidth: w, displayHeight: h })}
                  onAspectRatioChange={(ratio) => updateState({ aspectRatio: ratio })}
                  videoRef={videoRef}
                />
              )}

              {/* Trim panel (video + audio) */}
              {(mediaType === "video" || mediaType === "audio") && currentFile.duration > 0 && (
                <TrimPanel
                  mediaUrl={mediaUrl}
                  mediaType={mediaType}
                  duration={currentFile.duration}
                  trim={editorState.trim ?? { startTime: 0, endTime: currentFile.duration }}
                  onTrimChange={(trim) => updateState({ trim })}
                  videoRef={videoRef}
                />
              )}

              {/* Aspect ratio (image + video) */}
              {(mediaType === "image" || mediaType === "video") && (
                <div>
                  <div className="text-xs text-white/50 mb-2">Aspect Ratio</div>
                  <AspectRatioSelector
                    options={ASPECT_RATIO_OPTIONS}
                    value={editorState.aspectRatio}
                    onValueChange={(v) => updateState({ aspectRatio: v })}
                  />
                </div>
              )}

              {/* Format panel (all types) */}
              <FormatPanel
                mediaType={mediaType}
                format={editorState.format}
                onFormatChange={(format) => updateState({ format })}
                originalFormat={originalFormat}
              />

              {/* Output info bar */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-2 text-[11px] text-white/40 border-t border-white/5 mt-1">
                {/* Dimensions (image + video) */}
                {(mediaType === "image" || mediaType === "video") && (
                  <span className="flex items-center gap-1.5">
                    <span>{outputInfo.nw} × {outputInfo.nh}</span>
                    {outputInfo.isCropped && (
                      <>
                        <ArrowRight className="w-3 h-3 text-white/25" />
                        <span className="text-[#ff0073]">{outputInfo.outW} × {outputInfo.outH}</span>
                      </>
                    )}
                  </span>
                )}

                {/* Duration (video + audio) */}
                {(mediaType === "video" || mediaType === "audio") && outputInfo.origDuration > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span>{formatDuration(outputInfo.origDuration)}</span>
                    {outputInfo.isTrimmed && (
                      <>
                        <ArrowRight className="w-3 h-3 text-white/25" />
                        <span className="text-[#ff0073]">{formatDuration(outputInfo.outDuration)}</span>
                      </>
                    )}
                  </span>
                )}

                {/* Format */}
                <span>{outputInfo.outFormat}</span>

                {/* File size */}
                <span className="flex items-center gap-1.5">
                  <span>{formatBytes(outputInfo.origSize)}</span>
                  {(outputInfo.isCropped || outputInfo.isTrimmed) && (
                    <>
                      <ArrowRight className="w-3 h-3 text-white/25" />
                      <span className="text-white/50">~{formatBytes(outputInfo.estimatedSize)}</span>
                    </>
                  )}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 shrink-0">
          <button
            type="button"
            onClick={handleReset}
            disabled={isProcessing || isConverting}
            className="px-4 py-2 text-sm text-white/50 border border-white/20 rounded-lg hover:text-white hover:border-white/40 transition-colors disabled:opacity-40"
          >
            Reset
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isProcessing}
              className="px-4 py-2 text-sm text-white border border-white/20 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>

            {isMultiFile && !isLastFile && allSameType && (
              <button
                type="button"
                onClick={handleApplyAll}
                disabled={isProcessing || isConverting}
                className="px-4 py-2 text-sm text-[#ff0073] border border-[#ff0073]/50 rounded-lg hover:bg-[#ff0073]/10 transition-colors disabled:opacity-40"
              >
                {isProcessing && <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" />}
                Apply & Upload All
              </button>
            )}

            <button
              type="button"
              onClick={handleUploadCurrent}
              disabled={isProcessing || isConverting}
              className="px-5 py-2 text-sm text-white bg-[#ff0073] rounded-lg hover:bg-[#ff0073]/80 transition-colors disabled:opacity-40 font-medium"
            >
              {isProcessing && <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" />}
              {isMultiFile && !isLastFile ? "Upload \u2192" : "Upload"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
