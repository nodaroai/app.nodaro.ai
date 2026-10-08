"use client"

/**
 * The card grid (§4.2 of the inspectors design, A4-2; M17): 1, 2, 3 or 4
 * columns at 640 / 1024 / 1440 px. Up to VIRTUAL_FROM cards it is a plain CSS
 * grid; past that the rows are windowed (`useVirtualGrid`, fixed-height cards),
 * so a hundred clips mount a screenful of videos' worth of DOM.
 */
import { memo } from "react"
import { rowItems, useVirtualGrid, type GridBreakpoint } from "@/hooks/use-virtual-grid"
import type { ClipCard } from "@/lib/edl-review/build-clip-cards"
import { useT } from "@/lib/i18n"
import { ClipCardTile, type ClipCardProps } from "./clip-card"
import { FIXED_CARD_HEIGHT } from "./clip-card-layout"

/** Past this many cards the grid is windowed. */
export const VIRTUAL_FROM = 40
export const CLIP_GRID_BREAKPOINTS: readonly GridBreakpoint[] = [
  { min: 0, cols: 1 },
  { min: 640, cols: 2 },
  { min: 1024, cols: 3 },
  { min: 1440, cols: 4 },
]
const GAP = 12
const ROW_HEIGHT = FIXED_CARD_HEIGHT + GAP
const NO_PAGES = () => undefined

type TileProps = Omit<ClipCardProps, "card" | "playing" | "fixedHeight">

export interface ClipGridProps extends TileProps {
  readonly cards: readonly ClipCard[]
  /** The card whose video is mounted. */
  readonly active: string | null
}

function PlainGrid({ cards, active, ...tile }: ClipGridProps) {
  const t = useT()
  return (
    <div
      data-testid="clip-grid"
      role="list"
      aria-label={t("clipReview.grid")}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[1440px]:grid-cols-4"
    >
      {cards.map((card) => (
        <div key={card.clipKey} role="listitem" className="min-w-0">
          <ClipCardTile card={card} playing={active === card.clipKey} {...tile} />
        </div>
      ))}
    </div>
  )
}

function VirtualGrid({ cards, active, ...tile }: ClipGridProps) {
  const t = useT()
  const grid = useVirtualGrid({
    itemCount: cards.length,
    breakpoints: CLIP_GRID_BREAKPOINTS,
    estimateRowHeight: ROW_HEIGHT - GAP,
    gap: GAP,
    overscan: 2,
    fetchNextPage: NO_PAGES,
    hasNextPage: false,
    isFetchingNextPage: false,
  })
  return (
    <div
      ref={grid.gridRef}
      data-testid="clip-grid"
      data-virtual
      role="list"
      aria-label={t("clipReview.grid")}
      className="relative w-full"
      style={{ height: grid.totalSize }}
    >
      {grid.virtualRows.map((row) => (
        <div
          key={row.index}
          className="absolute start-0 top-0 grid w-full"
          style={{ gridTemplateColumns: grid.gridTemplateColumns, gap: GAP, transform: `translateY(${row.start - grid.scrollMargin}px)` }}
        >
          {rowItems(cards, row.index, grid.columns).map(({ item }) => (
            <div key={item.clipKey} role="listitem" className="min-w-0">
              <ClipCardTile card={item} playing={active === item.clipKey} fixedHeight {...tile} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export const ClipGrid = memo(function ClipGrid(props: ClipGridProps) {
  return props.cards.length > VIRTUAL_FROM ? <VirtualGrid {...props} /> : <PlainGrid {...props} />
})
