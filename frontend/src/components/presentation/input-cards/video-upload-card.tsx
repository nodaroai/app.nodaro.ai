import { useState } from "react"
import { X, Play, Maximize2 } from "lucide-react"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { GlassCard, GlassButton } from "../output-cards/shared"
import { useMediaUpload, FileDropZone, UrlInputRow } from "./shared"

interface VideoUploadCardProps {
  label: string
  url?: string
  nodeId: string
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  readOnly?: boolean
}

export function VideoUploadCard({ label, url, nodeId, isFullscreen, inputValues, onUpdateInput, readOnly }: VideoUploadCardProps) {
  const media = useMediaUpload({ mimePrefix: "video/", nodeId, isFullscreen, inputValues, onUpdateInput, url })
  const [previewOpen, setPreviewOpen] = useState(false)

  return (
    <GlassCard>
      <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        {label}
      </label>

      {media.effectiveUrl ? (
        <div className="relative group rounded-lg overflow-hidden cursor-pointer" onClick={() => setPreviewOpen(true)}>
          <video
            src={media.effectiveUrl}
            className="w-full rounded-lg bg-black/20 object-contain"
            muted
            playsInline
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-black/50 flex items-center justify-center group-hover:bg-black/60 group-hover:scale-110 transition-all duration-200">
              <Play className="w-7 h-7 text-white ml-1" fill="white" />
            </div>
          </div>
          {/* Hover toolbar — top-right, no blur overlay */}
          <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <GlassButton onClick={() => setPreviewOpen(true)} title="Fullscreen">
              <Maximize2 className="w-3.5 h-3.5" />
            </GlassButton>
            {!readOnly && (
              <GlassButton onClick={media.handleRemove} title="Remove">
                <X className="w-3.5 h-3.5" />
              </GlassButton>
            )}
          </div>
        </div>
      ) : readOnly ? (
        <div className="flex items-center justify-center h-32 bg-muted/30 rounded-lg border border-border text-sm text-muted-foreground">
          No video
        </div>
      ) : (
        <FileDropZone
          isDragOver={media.isDragOver}
          setIsDragOver={media.setIsDragOver}
          onDrop={media.handleDrop}
          onClick={() => media.fileInputRef.current?.click()}
          isUploading={media.isUploading}
          accept="video/*"
          fileInputRef={media.fileInputRef}
          onFileChange={media.handleFile}
          label="Drop video or click to upload"
          onShowUrl={() => media.setShowUrlInput(true)}
        />
      )}

      {media.showUrlInput && !media.effectiveUrl && (
        <UrlInputRow
          urlValue={media.urlValue}
          onChange={media.setUrlValue}
          onSubmit={media.handleUrlSubmit}
        />
      )}

      {media.effectiveUrl && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type="video"
          url={media.effectiveUrl}
        />
      )}
    </GlassCard>
  )
}
