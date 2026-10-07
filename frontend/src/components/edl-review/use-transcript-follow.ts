/**
 * Follow playback (§2.3 of the inspectors design): the word the player is
 * playing, and the transcript kept on it.
 *
 * The word is read from the player's time outside React state
 * (`useSyncExternalStore` over `ReviewPlayback`), so a `timeupdate` re-renders
 * the pane only when the word playing changes, and then only the rows that
 * held or now hold it re-render (their `active` prop). When the word changes
 * and follow is on, its row scrolls into view if it is not on screen
 * (`align: "auto"`); a collapsed run hiding it expands first (R11: follow
 * playback expands it automatically). -1 while nothing known plays, and
 * always with follow off.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import type { Virtualizer } from "@tanstack/react-virtual"
import type { ReviewPlayback } from "@/hooks/use-review-playback"
import { wordAt, wordClock } from "@/lib/edl-review/playhead"
import { collapsedRunOfWord, rowOfWord, type ReviewRow } from "@/lib/edl-review/review-rows"
import type { TranscriptWords } from "./use-transcript-view"

const NO_SUBSCRIPTION = () => () => undefined

export interface TranscriptFollowOptions {
  readonly playback: ReviewPlayback | undefined
  readonly words: TranscriptWords
  readonly offsetMs: number
  readonly rows: readonly ReviewRow[]
  readonly virtualizer: Virtualizer<HTMLDivElement, Element>
  /** Expand the collapsed run `run` (the reviewer's). */
  readonly expand: (run: string) => void
}

export function useTranscriptFollow({ playback, words, offsetMs, rows, virtualizer, expand }: TranscriptFollowOptions): number {
  const clock = useMemo(() => wordClock(words, offsetMs), [words, offsetMs])
  const follow = !!playback?.follow
  const active = useSyncExternalStore(
    playback?.subscribe ?? NO_SUBSCRIPTION,
    () => (follow && playback ? wordAt(clock, playback.masterMs()) : -1),
  )

  // Once per word: an edit while it plays must not pull the transcript back to it.
  const shownFor = useRef(-1)
  useEffect(() => {
    if (active < 0 || shownFor.current === active) return
    const run = collapsedRunOfWord(rows, active)
    if (run) {
      // Scrolled to once the run's rows are in.
      expand(run)
      return
    }
    shownFor.current = active
    virtualizer.scrollToIndex(rowOfWord(rows, active), { align: "auto" })
  }, [active, rows, virtualizer, expand])

  return active
}
