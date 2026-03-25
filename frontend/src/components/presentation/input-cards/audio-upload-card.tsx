import { X } from "lucide-react"
import { MediaEditorModal } from "@/components/editor/media-editor"
import { GlassCard, GlassButton } from "../output-cards/shared"
import { useMediaUpload, FileDropZone, UrlInputRow, WaveformBars } from "./shared"

interface AudioUploadCardProps {
  label: string
  url?: string
  nodeId: string
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  readOnly?: boolean
}

export function AudioUploadCard({ label, url, nodeId, isFullscreen, inputValues, onUpdateInput, readOnly }: AudioUploadCardProps) {
  const media = useMediaUpload({ mimePrefix: "audio/", nodeId, isFullscreen, inputValues, onUpdateInput, url })

  return (
    <>
      <GlassCard>
        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          {label}
        </label>

        {media.effectiveUrl ? (
          <div className="relative group">
            <div className="flex items-center gap-3 bg-muted/30 rounded-lg p-3 border border-border">
              <WaveformBars />
              <audio src={media.effectiveUrl} controls className="flex-1 h-8 [&::-webkit-media-controls-panel]:bg-transparent" />
            </div>
            {!readOnly && (
              <div className="media-overlay-controls absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <GlassButton onClick={media.handleRemove} title="Remove">
                  <X className="w-3.5 h-3.5" />
                </GlassButton>
              </div>
            )}
          </div>
        ) : readOnly ? (
          <div className="flex items-center justify-center h-24 bg-muted/30 rounded-lg border border-border text-sm text-muted-foreground">
            No audio
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
      <MediaEditorModal editor={media.mediaEditor} />
    </>
  )
}
