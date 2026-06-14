import { X, Download, Copy } from "lucide-react"
import { WaveformAudioPlayer } from "@/components/audio-player"
import { MediaEditorModal } from "@/components/editor/media-editor"
import { GlassCard, GlassButton, copyUrl, downloadFile } from "../output-cards/shared"
import { ActionMenu } from "../output-cards/action-menu"
import { ActionBar } from "../output-cards/action-bar"
import { shareMedia } from "../output-cards/share-utils"
import { useMediaUpload, FileDropZone, UrlInputRow } from "./shared"

interface AudioUploadCardProps {
  label: string
  url?: string
  nodeId: string
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  readOnly?: boolean
  /** "composer" renders a compact player + drop button for the chat composer. */
  variant?: "composer"
}

export function AudioUploadCard({ label, url, nodeId, isFullscreen, inputValues, onUpdateInput, readOnly, variant }: AudioUploadCardProps) {
  const media = useMediaUpload({ mimePrefix: "audio/", nodeId, isFullscreen, inputValues, onUpdateInput, url })

  if (variant === "composer") {
    return (
      <>
        <div className="flex flex-col gap-1">
          <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground truncate">{label}</span>
          {media.effectiveUrl ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
              <WaveformAudioPlayer url={media.effectiveUrl} variant="compact" className="min-w-0 flex-1" />
              {!readOnly && (
                <button
                  type="button"
                  onClick={media.handleRemove}
                  aria-label="Remove audio"
                  className="shrink-0 rounded-full bg-background p-0.5 text-muted-foreground ring-1 ring-border hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          ) : readOnly ? (
            <span className="text-xs text-muted-foreground">No audio</span>
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
              label="Add audio"
              height="h-16"
              onShowUrl={() => media.setShowUrlInput(true)}
            />
          )}
          {media.showUrlInput && !media.effectiveUrl && (
            <UrlInputRow urlValue={media.urlValue} onChange={media.setUrlValue} onSubmit={media.handleUrlSubmit} />
          )}
        </div>
        <MediaEditorModal editor={media.mediaEditor} />
      </>
    )
  }

  return (
    <>
      <GlassCard>
        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          {label}
        </label>

        {media.effectiveUrl ? (
          <>
            <div className="relative group">
              <div className="flex items-center gap-3 bg-muted/30 rounded-lg p-3 border border-border">
                <WaveformAudioPlayer url={media.effectiveUrl} variant="compact" className="flex-1" />
                {/* Desktop inline actions */}
                <div className="hidden md:flex gap-1.5 flex-shrink-0">
                  <GlassButton onClick={() => downloadFile(media.effectiveUrl!, `${label.replace(/\s+/g, "-").toLowerCase()}.mp3`)} title="Download">
                    <Download className="w-3.5 h-3.5" />
                  </GlassButton>
                  <GlassButton onClick={() => copyUrl(media.effectiveUrl!)} title="Copy URL">
                    <Copy className="w-3.5 h-3.5" />
                  </GlassButton>
                  <ActionMenu
                    mediaType="audio"
                    onShare={() => shareMedia({ url: media.effectiveUrl!, title: label, type: "audio" })}
                  />
                </div>
              </div>
              {!readOnly && (
                <div className="media-overlay-controls absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <GlassButton onClick={media.handleRemove} title="Remove">
                    <X className="w-3.5 h-3.5" />
                  </GlassButton>
                </div>
              )}
            </div>
            {/* Mobile action bar */}
            <ActionBar
              mediaType="audio"
              url={media.effectiveUrl}
              label={label}
              onShare={() => shareMedia({ url: media.effectiveUrl!, title: label, type: "audio" })}
            />
          </>
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
