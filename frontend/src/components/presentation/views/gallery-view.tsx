import { useState, useMemo } from "react"
import { ImageIcon, VideoIcon, Music, FileText, Play } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { getOutputType } from "@/lib/presentation-utils"
import { GlassCard, StatusBadge, type OutputStatus } from "../output-cards/shared"
import { WaveformBars } from "../input-cards/shared"
import type { ViewProps } from "./types"

type Tab = "all" | "outputs" | "inputs"

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "inputs", label: "Inputs" },
  { key: "outputs", label: "Outputs" },
]

export function GalleryView({
  orderedInputNodes,
  orderedOutputNodes,
  getNodeStatus,
  getResult,
  getCardTitle,
  onOpenMedia,
}: ViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>("all")
  const [textPreview, setTextPreview] = useState<{ title: string; text: string } | null>(null)

  const outputItems = useMemo(() => {
    return orderedOutputNodes.map((node) => {
      const outputType = getOutputType(node.type)
      const status = getNodeStatus(node.id)
      const result = getResult(node.id)
      return { node, outputType, status, result, title: getCardTitle(node) }
    })
  }, [orderedOutputNodes, getNodeStatus, getResult, getCardTitle])

  const inputItems = useMemo(() => {
    return orderedInputNodes.map((node) => {
      const result = getResult(node.id)
      return { node, result, title: getCardTitle(node) }
    })
  }, [orderedInputNodes, getResult, getCardTitle])

  const showOutputs = activeTab === "all" || activeTab === "outputs"
  const showInputs = activeTab === "all" || activeTab === "inputs"

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Tab toggle */}
        <div className="flex items-center justify-center mb-6">
          <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeTab === tab.key
                    ? "bg-[#ff0073]/10 text-[#ff0073]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Inputs section */}
        {showInputs && (
          <>
            {activeTab === "all" && inputItems.length > 0 && (
              <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Inputs</h3>
            )}
            {inputItems.length === 0 && activeTab !== "all" ? (
              <div className="text-sm text-muted-foreground text-center py-16">No inputs configured</div>
            ) : inputItems.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
                {inputItems.map(({ node, result, title }) => (
                  <GlassCard key={node.id}>
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-2 truncate">
                      {title}
                    </span>
                    <div className="flex items-center justify-center h-24 rounded-lg bg-muted/30 text-muted-foreground">
                      {result.url ? (
                        <CachedImage
                          src={result.url}
                          alt=""
                          thumbnail
                          className="w-full h-full object-cover rounded-lg cursor-pointer"
                          onClick={() => onOpenMedia?.(node.id)}
                        />
                      ) : result.text ? (
                        <p className="text-xs px-2 line-clamp-4">{result.text}</p>
                      ) : (
                        <span className="text-xs">Input</span>
                      )}
                    </div>
                  </GlassCard>
                ))}
              </div>
            ) : null}
          </>
        )}

        {/* Outputs section */}
        {showOutputs && (
          <>
            {activeTab === "all" && outputItems.length > 0 && (
              <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Outputs</h3>
            )}
            {outputItems.length === 0 && activeTab !== "all" ? (
              <div className="text-sm text-muted-foreground text-center py-16">No outputs configured</div>
            ) : outputItems.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {outputItems.map(({ node, outputType, status, result, title }) => (
                  <GalleryCard
                    key={node.id}
                    nodeId={node.id}
                    title={title}
                    outputType={outputType}
                    status={status}
                    url={result.url}
                    text={result.text}
                    onClickMedia={onOpenMedia}
                    onClickText={(text) => setTextPreview({ title, text })}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

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
  nodeId,
  title,
  outputType,
  status,
  url,
  text,
  onClickMedia,
  onClickText,
}: {
  nodeId: string
  title: string
  outputType: string
  status: OutputStatus
  url?: string
  text?: string
  onClickMedia?: (nodeId: string) => void
  onClickText: (text: string) => void
}) {
  const handleClick = () => {
    if ((outputType === "image" || outputType === "video" || outputType === "audio") && url) {
      onClickMedia?.(nodeId)
    } else if (text) {
      onClickText(text)
    }
  }

  const hasContent = url || text

  return (
    <GlassCard className={hasContent ? "cursor-pointer hover:border-[#ff0073]/30 transition-colors" : ""}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider truncate">{title}</span>
        <StatusBadge status={status} />
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
