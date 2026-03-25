import { useRef } from "react"
import { X, Loader2 } from "lucide-react"
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm">
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

      {/* Body — fills remaining space */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {isConverting ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <Loader2 className="w-10 h-10 animate-spin text-[#ff0073]" />
            <span className="text-sm text-white/60">Converting video...</span>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-5">
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
  )
}
