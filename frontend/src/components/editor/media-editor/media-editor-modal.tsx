// frontend/src/components/editor/media-editor/media-editor-modal.tsx
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            {isMultiFile && (
              <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {currentIndex + 1} of {totalFiles}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {isConverting ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-[#ff0073]" />
              <span className="text-sm text-muted-foreground">Converting video...</span>
            </div>
          ) : (
            <>
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
                  <div className="text-[11px] text-muted-foreground mb-1.5 px-1">
                    Aspect Ratio
                  </div>
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
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <button
            type="button"
            onClick={handleReset}
            disabled={isProcessing || isConverting}
            className="px-3 py-1.5 text-xs text-muted-foreground border border-border rounded-md hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
          >
            Reset
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isProcessing}
              className="px-3 py-1.5 text-xs text-foreground border border-border rounded-md hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>

            {/* Apply & Upload All — only for multi-file, not last, same type */}
            {isMultiFile && !isLastFile && allSameType && (
              <button
                type="button"
                onClick={handleApplyAll}
                disabled={isProcessing || isConverting}
                className="px-3 py-1.5 text-xs text-[#ff0073] border border-[#ff0073] rounded-md hover:bg-[#ff0073]/10 transition-colors disabled:opacity-50"
              >
                {isProcessing ? (
                  <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
                ) : null}
                Apply & Upload All
              </button>
            )}

            <button
              type="button"
              onClick={handleUploadCurrent}
              disabled={isProcessing || isConverting}
              className="px-3 py-1.5 text-xs text-white bg-[#ff0073] rounded-md hover:bg-[#ff0073]/80 transition-colors disabled:opacity-50"
            >
              {isProcessing ? (
                <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
              ) : null}
              {isMultiFile && !isLastFile ? "Upload \u2192" : "Upload"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
