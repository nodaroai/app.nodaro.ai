// frontend/src/components/audio-player/active-player.ts
//
// App-wide "only one audio plays at a time" coordination. When any
// WaveformAudioPlayer starts playing, the previously-playing one is paused —
// like SoundCloud. This prevents overlapping playback when more than one player
// is mounted at once (e.g. a gallery grid card and the preview modal).

export interface ActivePlayerHandle {
  pause: () => void
}

let current: ActivePlayerHandle | null = null

/** Mark `player` as the one playing; pause whoever was playing before. */
export function setActivePlayer(player: ActivePlayerHandle): void {
  if (current && current !== player) current.pause()
  current = player
}

/** Drop `player` as the active one (on unmount), without pausing anyone else. */
export function releaseActivePlayer(player: ActivePlayerHandle): void {
  if (current === player) current = null
}
