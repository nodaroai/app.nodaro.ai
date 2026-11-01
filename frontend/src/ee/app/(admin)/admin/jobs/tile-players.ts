// The Jobs Gallery's two player slots, one per kind of playback:
// - "hover": the muted video preview under the pointer. Pointer events can
//   arrive out of order (the next tile's enter before the last one's leave),
//   so the slot, not the leave handler, keeps it to one at a time.
// - "audio": a track the admin started with a tile's play button.
// Claiming a slot stops (and rewinds) only what held that same slot, so a
// hover preview never interrupts the audio someone chose to play.

export type PlayerSlot = "hover" | "audio"

const current: Record<PlayerSlot, HTMLMediaElement | null> = { hover: null, audio: null }

export function claimPlayer(el: HTMLMediaElement, slot: PlayerSlot): void {
  const prev = current[slot]
  if (prev && prev !== el) {
    prev.pause()
    prev.currentTime = 0
  }
  current[slot] = el
}

export function releasePlayer(el: HTMLMediaElement, slot: PlayerSlot): void {
  if (current[slot] === el) current[slot] = null
}
