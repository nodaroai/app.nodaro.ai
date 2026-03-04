import { useState, useMemo } from "react"
import { ImageIcon, VideoIcon, Music, FileText, Play } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { getOutputType } from "@/lib/presentation-utils"
import { GlassCard, StatusBadge } from "../output-cards/shared"
import { WaveformBars } from "../input-cards/shared"
import type { ViewProps } from "./types"

type Tab = "outputs" | "inputs"

export function GalleryView({
  orderedInputNodes,
  orderedOutputNodes,
  getNodeStatus,
  getResult,
  getCardTitle,
}: ViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>("outputs")
  const [previewItem, setPreviewItem] = useState<{ type: "image" | "video" | "audio"; url: string } | null>(null)
  const [textPreview, setTextPreview] = useState<{ title: string; text: string } | null>(null)

  const outputItems = useMemo(() => {
    return orderedOutputNodes.map((node) => {
      const outputType = getOutputType(node.type)
      const status = getNodeStatus(node.id)
      const result = getResult(node.id)
      return { node, outputType, status, result, title: getCardTitle(node) }
    })
  }, [orderedOutputNodes, getNodeStatus, getResult, getCardTitle])

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Tab toggle */}
        <div className="flex items-center justify-center mb-6">
          <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab("outputs")}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === "outputs"
                  ? "bg-[#ff0073]/10 text-[#ff0073]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Outputs
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("inputs")}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === "inputs"
                  ? "bg-[#ff0073]/10 text-[#ff0073]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Inputs
            </button>
          </div>
        </div>

        {activeTab === "outputs" ? (
          outputItems.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-16">No outputs configured</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {outputItems.map(({ node, outputType, status, result, title }) => (
                <GalleryCard
                  key={node.id}
                  title={title}
                  outputType={outputType}
                  status={status}
                  url={result.url}
                  text={result.text}
                  onClickImage={(url) => setPreviewItem({ type: "image", url })}
                  onClickVideo={(url) => setPreviewItem({ type: "video", url })}
                  onClickAudio={(url) => setPreviewItem({ type: "audio", url })}
                  onClickText={(text) => setTextPreview({ title, text })}
                />
              ))}
            </div>
          )
        ) : (
          orderedInputNodes.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-16">No inputs configured</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {orderedInputNodes.map((node) => {
                const result = getResult(node.id)
                return (
                  <GlassCard key={node.id}>
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-2 truncate">
                      {getCardTitle(node)}
                    </span>
                    <div className="flex items-center justify-center h-24 rounded-lg bg-muted/30 text-muted-foreground">
                      {result.url ? (
                        <CachedImage src={result.url} alt="" thumbnail className="w-full h-full object-cover rounded-lg" />
                      ) : result.text ? (
                        <p className="text-xs px-2 line-clamp-4">{result.text}</p>
                      ) : (
                        <span className="text-xs">Input</span>
                      )}
                    </div>
                  </GlassCard>
                )
              })}
            </div>
          )
        )}
      </div>

      {/* Media preview modal */}
      {previewItem && (
        <MediaPreviewModal
          isOpen
          onClose={() => setPreviewItem(null)}
          type={previewItem.type}
          url={previewItem.url}
        />
      )}

      {/* Text preview dialog */}
      {textPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setTextPreview(null)}
        >
          <div
            className="bg-card border border-border rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-medium text-foreground mb-3">{textPreview.title}</h3>
            <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{textPreview.text}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function GalleryCard({
  title,
  outputType,
  status,
  url,
  text,
  onClickImage,
  onClickVideo,
  onClickAudio,
  onClickText,
}: {
  title: string
  outputType: string
  status: string
  url?: string
  text?: string
  onClickImage: (url: string) => void
  onClickVideo: (url: string) => void
  onClickAudio: (url: string) => void
  onClickText: (text: string) => void
}) {
  const handleClick = () => {
    if (outputType === "image" && url) onClickImage(url)
    else if (outputType === "video" && url) onClickVideo(url)
    else if (outputType === "audio" && url) onClickAudio(url)
    else if (text) onClickText(text)
  }

  const hasContent = url || text

  return (
    <GlassCard className={hasContent ? "cursor-pointer hover:border-[#ff0073]/30 transition-colors" : ""}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider truncate">{title}</span>
        <StatusBadge status={status as "idle" | "running" | "completed" | "failed"} />
      </div>
      <div className="aspect-square rounded-lg overflow-hidden bg-muted/30 flex items-center justify-center" onClick={handleClick}>
        {status === "running" ? (
          <div className="w-6 h-6 border-2 border-[#ff0073]/40 border-t-[#ff0073] rounded-full animate-spin" />
        ) : outputType === "image" && url ? (
          <CachedImage src={url} alt={title} thumbnail className="w-full h-full object-cover" />
        ) : outputType === "video" && url ? (
          <div className="relative w-full h-full">
            <video src={url} className="w-full h-full object-cover" muted playsInline />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
                <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
              </div>
            </div>
          </div>
        ) : outputType === "audio" && url ? (
          <div className="flex flex-col items-center gap-2">
            <WaveformBars />
            <Music className="w-6 h-6 text-muted-foreground/60" />
          </div>
        ) : text ? (
          <p className="text-xs text-muted-foreground/80 px-3 line-clamp-6 text-center">{text}</p>
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground/40">
            {outputType === "image" ? <ImageIcon className="w-8 h-8" /> :
             outputType === "video" ? <VideoIcon className="w-8 h-8" /> :
             outputType === "audio" ? <Music className="w-8 h-8" /> :
             <FileText className="w-8 h-8" />}
            <span className="text-[10px]">
              {status === "failed" ? "Failed" : "Pending"}
            </span>
          </div>
        )}
      </div>
    </GlassCard>
  )
}
