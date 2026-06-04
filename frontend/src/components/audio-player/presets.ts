// frontend/src/components/audio-player/presets.ts
//
// THE single source of truth for how the audio player looks, everywhere.
// To restyle every audio player in the app, edit this file. To give one
// surface a different look, add a variant here and point that call site at it.

import type { AudioPlayerPreset, AudioPlayerVariant } from "./types"

/**
 * Brand colours for the waveform. Concrete colour strings (not CSS vars) because
 * wavesurfer paints to <canvas>, whose fillStyle does not resolve CSS variables.
 * The neutral wave colour is a mid-slate at low alpha so it stays legible on both
 * light and dark surfaces; the played portion uses the Nodaro accent.
 */
export const AUDIO_PLAYER_THEME = {
  /** Unplayed portion of the waveform. */
  waveColor: "rgba(148, 163, 184, 0.45)",
  /** Played portion — Nodaro accent pink (frontend/CLAUDE.md). */
  progressColor: "#ff0073",
  /** Playhead cursor. */
  cursorColor: "rgba(148, 163, 184, 0.9)",
} as const

const STD_BAR = { width: 2, gap: 1, radius: 2 }
const FINE_BAR = { width: 2, gap: 1, radius: 1 }

export const AUDIO_PLAYER_PRESETS: Record<AudioPlayerVariant, AudioPlayerPreset> = {
  // Fullscreen modal / gallery lightbox / presentation fullscreen — room to breathe.
  full: {
    waveHeight: 64,
    showWaveform: true,
    channels: "merged",
    controls: { playPause: true, stop: true, time: true, download: true },
    bar: STD_BAR,
  },
  // Default — canvas nodes, config-panel previews, app cards, admin, panels.
  compact: {
    waveHeight: 44,
    showWaveform: true,
    channels: "merged",
    controls: { playPause: true, stop: true, time: true, download: true },
    bar: STD_BAR,
  },
  // Genuinely tiny cells (list/table grid cells, split-media) — waveform + play only.
  mini: {
    waveHeight: 24,
    showWaveform: true,
    channels: "merged",
    controls: { playPause: true, stop: false, time: false, download: false },
    bar: FINE_BAR,
  },
}
