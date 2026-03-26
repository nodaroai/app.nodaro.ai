import { Download, Music } from "lucide-react"
import { StatusBadge, GlassCard, GlassButton, downloadFile, UnhideBanner, resolveCardActions, type OutputStatus, type OutputCardActions } from "./shared"
import { ActionMenu } from "./action-menu"
import { ActionBar } from "./action-bar"
import { shareMedia } from "./share-utils"
import { WaveformBars } from "../input-cards/shared"
import { ELEMENT_SIZES } from "@/lib/presentation-display"

/** Heights for the 7-bar loading waveform */
const LOADING_WAVEFORM_HEIGHTS = [14, 18, 12, 20, 16, 22, 14]
const LOADING_WAVEFORM_STYLES = LOADING_WAVEFORM_HEIGHTS.map((h, i) => ({
  animation: `waveform-bar ${0.5 + i * 0.12}s ease-in-out infinite`,
  animationDelay: `${i * 0.08}s`,
  height: `${h}px`,
}))

interface AudioOutputCardProps {
  label: string
  status: OutputStatus
  url?: string
  nodeId?: string
  elementSize?: "sm" | "md" | "lg"
  actions?: OutputCardActions
}

export function AudioOutputCard({ label, status, url, nodeId, elementSize, actions }: AudioOutputCardProps) {
  const heightClass = ELEMENT_SIZES.audioOutput[elementSize ?? "md"]
  const bound = resolveCardActions(actions, nodeId, "audio", url)
  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          {url && (
            <div className="hidden md:block">
              <ActionMenu
                mediaType="audio"
                onShare={() => shareMedia({ url, title: label, type: "audio" })}
                onEdit={bound.onEdit}
                onHide={bound.onHide}
              />
            </div>
          )}
        </div>
      </div>

      {status === "running" || status === "waiting" ? (
        <div className={`flex items-center justify-center ${heightClass} rounded-lg bg-muted/30`}>
          <div className="flex items-center gap-1">
            {LOADING_WAVEFORM_STYLES.map((style, i) => (
              <div key={i} className="w-1 bg-[#ff0073]/50 rounded-full" style={style} />
            ))}
          </div>
        </div>
      ) : url ? (
        <>
          <div className={`flex items-center gap-3 bg-muted/30 rounded-lg p-3 border border-border ${heightClass}`}>
            <WaveformBars />
            <audio src={url} controls className="flex-1 h-8 [&::-webkit-media-controls-panel]:bg-transparent" />
            <GlassButton onClick={() => downloadFile(url, `${label.replace(/\s+/g, "-").toLowerCase()}.mp3`)} title="Download">
              <Download className="w-3.5 h-3.5" />
            </GlassButton>
          </div>
          <ActionBar
            mediaType="audio"
            url={url}
            label={label}
            onShare={() => shareMedia({ url, title: label, type: "audio" })}
            onEdit={bound.onEdit}
            onHide={bound.onHide}
          />
          {bound.isRevealed && bound.onUnhide && (
            <UnhideBanner onUnhide={bound.onUnhide} />
          )}
        </>
      ) : (
        <div className={`flex flex-col items-center justify-center ${heightClass} rounded-lg bg-muted/30 text-muted-foreground`}>
          <Music className="w-8 h-8 mb-1 animate-pulse" />
          <span className="text-xs">
            {status === "failed" ? "Generation failed" : "Awaiting generation"}
          </span>
        </div>
      )}
    </GlassCard>
  )
}
