// frontend/src/components/audio-player/audio-player-placeholder.tsx
//
// Lightweight, zero-cost stand-in shown while the real wavesurfer waveform is
// being lazy-mounted / decoded. Pure CSS bars — no audio fetch or decode.

import { memo } from "react"

// Deterministic bar envelope so the placeholder reads as a plausible waveform
// without any randomness (which would re-shuffle on every render).
const BARS = [
  0.30, 0.50, 0.65, 0.80, 0.55, 0.40, 0.70, 0.85, 0.95, 0.70, 0.50, 0.35,
  0.55, 0.75, 0.88, 0.62, 0.45, 0.30, 0.42, 0.58, 0.72, 0.85, 0.60, 0.48,
  0.66, 0.80, 0.70, 0.52, 0.38, 0.50, 0.68, 0.58, 0.44, 0.34, 0.52, 0.66,
  0.78, 0.60, 0.46, 0.36, 0.50, 0.62, 0.74, 0.55, 0.40, 0.60, 0.70, 0.50,
]

interface AudioPlayerPlaceholderProps {
  height: number
  bar: { width: number; gap: number }
}

function AudioPlayerPlaceholderComponent({ height, bar }: AudioPlayerPlaceholderProps) {
  return (
    <div
      className="flex w-full items-center"
      style={{ height, gap: bar.gap }}
      aria-hidden
    >
      {BARS.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm bg-foreground/15"
          style={{ height: `${Math.max(8, Math.round(h * 100))}%`, minWidth: bar.width }}
        />
      ))}
    </div>
  )
}

export const AudioPlayerPlaceholder = memo(AudioPlayerPlaceholderComponent)
