// frontend/src/components/audio-player/index.ts
//
// Public surface of the canonical audio player. Import from here everywhere:
//   import { WaveformAudioPlayer } from "@/components/audio-player"

export { WaveformAudioPlayer } from "./waveform-audio-player"
export { AUDIO_PLAYER_PRESETS, AUDIO_PLAYER_THEME } from "./presets"
export type {
  AudioPlayerVariant,
  AudioPlayerPreset,
  WaveformAudioPlayerProps,
} from "./types"
