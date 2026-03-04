import { Download, Music } from "lucide-react"
import { StatusBadge, GlassCard, GlassButton, downloadFile, type OutputStatus } from "./shared"
import { WaveformBars } from "../input-cards/shared"

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
}

export function AudioOutputCard({ label, status, url }: AudioOutputCardProps) {
  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-white/50 uppercase tracking-wider">{label}</span>
        <StatusBadge status={status} />
      </div>

      {status === "running" ? (
        <div className="flex items-center justify-center h-20 rounded-lg bg-white/[0.03]">
          <div className="flex items-center gap-1">
            {LOADING_WAVEFORM_STYLES.map((style, i) => (
              <div key={i} className="w-1 bg-[#ff0073]/50 rounded-full" style={style} />
            ))}
          </div>
        </div>
      ) : url ? (
        <div className="flex items-center gap-3 bg-white/[0.03] rounded-lg p-3 border border-white/5">
          <WaveformBars />
          <audio src={url} controls className="flex-1 h-8 [&::-webkit-media-controls-panel]:bg-transparent" />
          <GlassButton onClick={() => downloadFile(url, `${label.replace(/\s+/g, "-").toLowerCase()}.mp3`)} title="Download">
            <Download className="w-3.5 h-3.5" />
          </GlassButton>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-20 rounded-lg bg-gradient-to-br from-white/[0.03] to-white/[0.01] text-white/20">
          <Music className="w-8 h-8 mb-1 animate-pulse" />
          <span className="text-xs">
            {status === "failed" ? "Generation failed" : "Awaiting generation"}
          </span>
        </div>
      )}
    </GlassCard>
  )
}
