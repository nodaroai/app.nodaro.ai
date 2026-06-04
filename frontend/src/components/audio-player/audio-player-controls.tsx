// frontend/src/components/audio-player/audio-player-controls.tsx
//
// Transport row, rendered purely from a preset's controls config. Holds no
// audio logic of its own — it calls back up to WaveformAudioPlayer, which owns
// the wavesurfer instance. This is the only place the transport UI is defined,
// so a fix or restyle here applies to every audio surface in the app.

import { memo } from "react"
import { Play, Pause, Square, Download } from "lucide-react"
import type { AudioPlayerControlsConfig } from "./types"

function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const m = Math.floor(s / 60)
  const rem = Math.floor(s % 60)
  return `${m}:${rem.toString().padStart(2, "0")}`
}

interface AudioPlayerControlsProps {
  config: AudioPlayerControlsConfig
  isPlaying: boolean
  currentTime: number
  totalTime: number
  showDownload: boolean
  /** Render a linear progress bar (used by "no waveform" looks). */
  showProgressBar: boolean
  /** 0..1 — only used when showProgressBar is true. */
  progress: number
  onPlayPause: () => void
  onStop: () => void
  onDownload: () => void
  onSeek: (fraction: number) => void
}

const BTN = "shrink-0 flex items-center justify-center transition-colors"

function AudioPlayerControlsComponent({
  config,
  isPlaying,
  currentTime,
  totalTime,
  showDownload,
  showProgressBar,
  progress,
  onPlayPause,
  onStop,
  onDownload,
  onSeek,
}: AudioPlayerControlsProps) {
  return (
    <div className="flex w-full items-center gap-2">
      {config.playPause && (
        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={(e) => { e.stopPropagation(); onPlayPause() }}
          className={`${BTN} w-7 h-7 rounded-full bg-[#ff0073] text-white hover:bg-[#ff0073]/90`}
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 translate-x-px" />}
        </button>
      )}

      {config.stop && (
        <button
          type="button"
          aria-label="Stop"
          onClick={(e) => { e.stopPropagation(); onStop() }}
          className={`${BTN} w-6 h-6 rounded-md bg-black/10 dark:bg-white/10 text-foreground/70 hover:text-foreground hover:bg-black/20 dark:hover:bg-white/20`}
        >
          <Square className="w-3 h-3" />
        </button>
      )}

      {showProgressBar && (
        <div
          className="flex-1 min-w-[40px] h-1.5 rounded-full bg-foreground/15 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            const rect = e.currentTarget.getBoundingClientRect()
            onSeek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)))
          }}
        >
          <div
            className="h-full rounded-full bg-[#ff0073]"
            style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
          />
        </div>
      )}

      {config.time && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">
          {formatTime(currentTime)} / {formatTime(totalTime)}
        </span>
      )}

      {!showProgressBar && <div className="flex-1" />}

      {showDownload && (
        <button
          type="button"
          aria-label="Download"
          onClick={(e) => { e.stopPropagation(); onDownload() }}
          className={`${BTN} w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10`}
        >
          <Download className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

export const AudioPlayerControls = memo(AudioPlayerControlsComponent)
