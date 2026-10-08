/**
 * One clip plays at a time in the Clip Pack grid (§4.2 of the inspectors
 * design, A4-2): a card shows its poster until its play button is pressed, and
 * only the card named here mounts a `<video>`. Starting another clip unmounts
 * the first, so no more than one video element ever holds a connection (a grid
 * of 40 clips would otherwise open 40), and each loads with `preload="none"`.
 */
import { useCallback, useState } from "react"

export interface SinglePlayback {
  /** The card (its `clipKey`) whose video is mounted; null when none. */
  readonly active: string | null
  readonly play: (clipKey: string) => void
  readonly stop: () => void
}

export function useSinglePlayback(): SinglePlayback {
  const [active, setActive] = useState<string | null>(null)
  const play = useCallback((clipKey: string) => setActive(clipKey), [])
  const stop = useCallback(() => setActive(null), [])
  return { active, play, stop }
}
