import { X } from "lucide-react"
import { GlassCard, GlassButton } from "../output-cards/shared"
import { useMediaUpload, FileDropZone, UrlInputRow, WaveformBars } from "./shared"

interface AudioUploadCardProps {
  label: string
  url?: string
  nodeId: string
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
}

export function AudioUploadCard({ label, url, nodeId, isFullscreen, inputValues, onUpdateInput }: AudioUploadCardProps) {
  const media = useMediaUpload({ mimePrefix: "audio/", nodeId, isFullscreen, inputValues, onUpdateInput, url })

  return (
    <GlassCard>
      <label className="block text-xs font-medium text-white/50 uppercase tracking-wider mb-2">
        {label}
      </label>

      {media.effectiveUrl ? (
        <div className="relative group">
          <div className="flex items-center gap-3 bg-white/[0.03] rounded-lg p-3 border border-white/5">
            <WaveformBars />
            <audio src={media.effectiveUrl} controls className="flex-1 h-8 [&::-webkit-media-controls-panel]:bg-transparent" />
            <GlassButton onClick={media.handleRemove} title="Remove">
              <X className="w-3.5 h-3.5" />
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
          accept="audio/*"
          fileInputRef={media.fileInputRef}
          onFileChange={media.handleFile}
          label="Upload audio"
          height="h-24"
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
    </GlassCard>
  )
}
