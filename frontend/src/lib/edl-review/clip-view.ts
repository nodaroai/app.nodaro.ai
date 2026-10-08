/**
 * What the Clip Pack inspector's grid shows of its cards (§4.2 of the
 * inspectors design, A4-2): the All / Kept / Dropped filter (R15 a) and the
 * header's "8 clips · 6 kept · 6:41" summary. Pure.
 */
import type { ClipCard } from "./build-clip-cards"

export type ClipFilter = "all" | "kept" | "dropped"

export const CLIP_FILTERS: readonly ClipFilter[] = ["all", "kept", "dropped"]

export function filterClipCards(cards: readonly ClipCard[], filter: ClipFilter): readonly ClipCard[] {
  return filter === "all" ? cards : cards.filter((c) => (filter === "kept" ? c.keep : !c.keep))
}

/** How many cards each filter shows. */
export function clipFilterCounts(cards: readonly ClipCard[]): Record<ClipFilter, number> {
  const kept = cards.filter((c) => c.keep).length
  return { all: cards.length, kept, dropped: cards.length - kept }
}
