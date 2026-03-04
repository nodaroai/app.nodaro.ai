import { useState } from "react"
import { X, Play } from "lucide-react"
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
}

export function VideoUploadCard({ label, url, nodeId, isFullscreen, inputValues, onUpdateInput }: VideoUploadCardProps) {
  const media = useMediaUpload({ mimePrefix: "video/", nodeId, isFullscreen, inputValues, onUpdateInput, url })
  const [previewOpen, setPreviewOpen] = useState(false)

  return (
    <GlassCard>
      <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        {label}
      </label>

      {media.effectiveUrl ? (
        <div className="relative group rounded-lg overflow-hidden">
          <video
            src={media.effectiveUrl}
            className="w-full max-h-48 rounded-lg bg-black/20 object-contain"
            muted
            playsInline
          />
          <div
            className="absolute inset-0 flex items-center justify-center cursor-pointer"
            onClick={() => setPreviewOpen(true)}
          >
            <div className="w-14 h-14 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center group-hover:bg-black/60 transition-all">
              <Play className="w-6 h-6 text-white ml-0.5" fill="white" />
            </div>
          </div>
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <GlassButton onClick={media.handleRemove} title="Remove">
              <X className="w-4 h-4" />
            </GlassButton>
          </div>
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
