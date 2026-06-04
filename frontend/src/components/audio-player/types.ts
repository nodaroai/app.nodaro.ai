// frontend/src/components/audio-player/types.ts
//
// Shared types for the single canonical audio player (WaveformAudioPlayer).
// The *look* of every audio surface in the app is driven by a named preset
// (see presets.ts). Call sites only ever choose a `variant` — never raw styling —
// so the appearance can be changed in one place, and a place can be given a
// different look (split stereo, no waveform, …) by pointing it at another preset.

/**
 * Named look presets. Add a new variant here + in AUDIO_PLAYER_PRESETS to
 * introduce a new look without touching any call site.
 */
export type AudioPlayerVariant = "full" | "compact" | "mini"

export interface AudioPlayerControlsConfig {
  playPause: boolean
  stop: boolean
  /** "0:12 / 0:30" time readout */
  time: boolean
  download: boolean
}

export interface AudioPlayerPreset {
  /** Height of the waveform canvas in px (per channel when channels === "split"). */
  waveHeight: number
  /**
   * When false the waveform canvas is hidden and a linear progress bar is shown
   * instead — the "no wave display" look. Playback/seek behaviour is identical.
   */
  showWaveform: boolean
  /**
   * "merged" → one waveform summarising both channels (default, SoundCloud-style).
   * "split"  → one waveform per channel (stereo L/R). Playback is always full stereo.
   */
  channels: "merged" | "split"
  /** Which transport controls render for this look. */
  controls: AudioPlayerControlsConfig
  /** wavesurfer bar geometry. */
  bar: { width: number; gap: number; radius: number }
}

export interface WaveformAudioPlayerProps {
  url: string
  /** Look preset. Defaults to "compact". */
  variant?: AudioPlayerVariant
  /** Known total duration (s); shown before decode completes. */
  duration?: number
  /** Pre-computed peaks (e.g. from the backend) to skip the client-side decode. */
  peaks?: (Float32Array | number[])[]
  autoPlay?: boolean
  /** Used for the download filename and aria labels. */
  label?: string
  /** Override the preset's download button (e.g. when a wrapper supplies its own). */
  download?: boolean
  /** Inside a React Flow node: adds nodrag/nopan/nowheel + isolates pointer events. */
  isInsideCanvas?: boolean
  className?: string
}
