"use client"

// Empty state of the AI Avatar node (catalog source): "START WITH AN AVATAR" —
// a row of featured looks to pick from right on the card, a search box that
// filters the whole catalog in place (the same search the settings panel
// runs), a link to browse the full catalog with filters in the settings
// panel, and the alternative of animating your own portrait instead. Also
// serves as the in-place "Change avatar" view once an avatar is set (the
// current one is ring-highlighted and ✕ goes back).

import { useCallback, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react"
import { AlertCircle, Image as ImageIcon, Search, User, X, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import type { HeygenAvatar } from "@/lib/api"
import { CachedImage } from "@/components/ui/cached-image"
import {
  useHeygenAvatars,
  keylessCatalogHint,
  avatarSupportsV,
  filterAvatars,
} from "@/components/heygen/heygen-catalog"
import { pickFeaturedAvatars, splitLookName } from "./catalog-helpers"
import { GHOST_BUTTON, KICKER, PINK_LINK } from "./styles"

/** How many looks the on-node row shows when nothing is searched. */
export const FEATURED_AVATAR_COUNT = 5

/** Search results rendered on the card at most (5 per row); beyond that the
 *  count says so and "Browse all" has the full, filterable catalog. */
export const SEARCH_RESULT_CAP = 60

interface AvatarQuickPickProps {
  /** The look currently stored on the node (highlighted), if any. */
  readonly currentAvatarId?: string
  readonly onPick: (avatar: HeygenAvatar) => void
  /** Open the settings panel (full catalog with search + filters). */
  readonly onBrowseAll: () => void
  /** Switch the node to image-source mode. */
  readonly onUseImage: () => void
  /** Present when this view was opened from "Change avatar" — ✕ returns. */
  readonly onCancel?: () => void
}

function stop(e: MouseEvent | KeyboardEvent) {
  e.stopPropagation()
}

interface LookTileProps {
  readonly avatar: HeygenAvatar
  readonly selected: boolean
  readonly onPick: (avatar: HeygenAvatar) => void
}

/** One look: portrait (fills the tile), Avatar-V badge, person / scene lines. */
function LookTile({ avatar, selected, onPick }: LookTileProps) {
  const { person, scene } = splitLookName(avatar.name)
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={avatar.name}
      title={avatar.name}
      className={cn(
        "nodrag nopan group/tile flex flex-col min-w-0 min-h-0 rounded-lg border p-1 text-left transition-colors cursor-pointer",
        selected
          ? "border-[#ff0073] ring-1 ring-[#ff0073]/50 bg-[#ff0073]/5"
          : "border-border/60 hover:border-[#ff0073]/60 hover:bg-muted/40",
      )}
      onClick={(e) => { stop(e); onPick(avatar) }}
    >
      <div className="relative flex-1 min-h-0 overflow-hidden rounded-md bg-muted/40">
        <CachedImage
          src={avatar.previewImageUrl}
          alt=""
          thumbnail
          thumbnailWidth={256}
          className="w-full h-full object-cover object-top transition-transform duration-200 group-hover/tile:scale-105"
        />
        {avatarSupportsV(avatar) && (
          <span
            aria-label="Supports Avatar V"
            title="Supports Avatar V"
            className="absolute top-1 left-1 grid place-items-center w-4 h-4 rounded bg-violet-600/90 text-white"
          >
            <Zap className="size-2.5" aria-hidden />
          </span>
        )}
      </div>
      <span className={cn("mt-1 px-0.5 text-[11px] leading-tight truncate", selected ? "text-[#ff0073]" : "text-foreground")}>
        {person}
      </span>
      <span className="px-0.5 text-[10px] leading-tight text-muted-foreground truncate">
        {scene || <span className="capitalize">{avatar.gender}</span>}
      </span>
    </button>
  )
}

export function AvatarQuickPick({
  currentAvatarId,
  onPick,
  onBrowseAll,
  onUseImage,
  onCancel,
}: AvatarQuickPickProps) {
  // The catalog streams in (see heygen-catalog.ts): the first page shows at
  // once, later pages only ever ADD persons after the ones already featured,
  // so the row fills up without reshuffling. `complete` false → count is a floor.
  const { data: avatars, isLoading, isError, complete } = useHeygenAvatars()
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)
  const searching = query.trim().length > 0

  const featured = useMemo(() => pickFeaturedAvatars(avatars, FEATURED_AVATAR_COUNT), [avatars])
  // The SAME filter the settings-panel picker applies to its search box.
  const matches = useMemo(
    () => (searching ? filterAvatars(avatars, query, "all", "all") : []),
    [avatars, query, searching],
  )
  const shown = searching ? matches.slice(0, SEARCH_RESULT_CAP) : featured

  const handleBrowse = useCallback((e: MouseEvent) => { stop(e); onBrowseAll() }, [onBrowseAll])
  const handleUseImage = useCallback((e: MouseEvent) => { stop(e); onUseImage() }, [onUseImage])
  const handleCancel = useCallback((e: MouseEvent) => { stop(e); onCancel?.() }, [onCancel])
  const handleQuery = useCallback((e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value), [])
  const handleQueryKey = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    stop(e)
    if (e.key === "Escape") setQuery("")
  }, [])

  const countLabel = searching
    ? `${matches.length.toLocaleString("en-US")}${complete ? "" : "+"} match${matches.length === 1 ? "" : "es"}${matches.length > SEARCH_RESULT_CAP ? ` · first ${SEARCH_RESULT_CAP} shown` : ""}`
    : null

  return (
    <div className="flex flex-col gap-3 h-full min-h-0 px-3.5 pt-3.5 pb-3" data-testid="ai-avatar-quick-pick">
      {/* Head: kicker — rule — search — Browse all — (✕) */}
      <div className="flex items-center gap-2.5 shrink-0">
        <span className={KICKER}>{currentAvatarId ? "Change avatar" : "Start with an avatar"}</span>
        <span className="flex-1 h-px bg-border/60 min-w-2" />
        {avatars.length > 0 && (
          // A div, not a <label>: the box also holds the Clear button, and a
          // label may wrap only one labelable control. The input carries its
          // own aria-label; clicking the frame focuses it.
          <div
            className={cn(
              "nodrag nopan flex items-center gap-1.5 h-6 pl-2 pr-1 rounded-md border border-border/60 bg-background/60 text-muted-foreground cursor-text",
              "focus-within:border-[#ff0073]/60 transition-colors w-[170px] shrink-0",
            )}
            onClick={(e) => { stop(e); searchRef.current?.focus() }}
          >
            <Search className="size-3 shrink-0 opacity-70" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={handleQuery}
              onKeyDown={handleQueryKey}
              placeholder="Search avatars…"
              aria-label="Search avatars"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/60 outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {searching && (
              <button
                type="button"
                aria-label="Clear search"
                className="grid place-items-center w-4 h-4 rounded text-muted-foreground hover:text-foreground"
                onClick={(e) => { stop(e); setQuery("") }}
              >
                <X className="size-2.5" />
              </button>
            )}
          </div>
        )}
        {avatars.length > 0 && (
          <button type="button" className={PINK_LINK} onClick={handleBrowse}>
            Browse all {avatars.length.toLocaleString("en-US")}{complete ? "" : "+"} ›
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            aria-label="Keep the current avatar"
            title="Keep the current avatar"
            className="nodrag nopan w-5 h-5 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
            onClick={handleCancel}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Featured looks, or the search results */}
      <div className="flex-1 min-h-0 flex flex-col gap-1.5">
        {countLabel && (
          <span className="shrink-0 text-[10px] font-mono text-muted-foreground/70" data-testid="ai-avatar-search-count">
            {countLabel}
          </span>
        )}
        {isLoading ? (
          <div className="grid grid-cols-5 gap-2 flex-1 min-h-0" aria-busy>
            {Array.from({ length: FEATURED_AVATAR_COUNT }).map((_, i) => (
              <div key={i} className="rounded-lg bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center gap-1.5 flex-1 text-center">
            <AlertCircle className="size-6 text-destructive/60" />
            <p className="text-[11px] text-muted-foreground">Failed to load avatars</p>
          </div>
        ) : avatars.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center gap-1.5 flex-1 text-center px-6"
            data-testid="ai-avatar-quick-pick-empty"
          >
            <User className="size-7 text-muted-foreground/40" />
            <p className="text-[11px] font-medium text-muted-foreground">No HeyGen avatars</p>
            <p className="text-[10px] text-muted-foreground/70 leading-snug">{keylessCatalogHint("avatars")}</p>
          </div>
        ) : searching && shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 flex-1 text-center px-6" data-testid="ai-avatar-search-empty">
            <p className="text-[11px] text-muted-foreground">No avatars match “{query.trim()}”</p>
            <button type="button" className={PINK_LINK} onClick={handleBrowse}>Browse all with filters ›</button>
          </div>
        ) : searching ? (
          // Search results: same tiles, 5 per row, the next row peeking so the
          // grid reads as scrollable. `nowheel` keeps the wheel on the grid, not
          // the canvas zoom.
          <div
            role="radiogroup"
            aria-label="Matching avatars"
            className="nowheel nodrag flex-1 min-h-0 overflow-y-auto grid grid-cols-5 gap-2 pr-0.5"
            style={{ gridAutoRows: "62%" }}
            data-testid="ai-avatar-search-results"
          >
            {shown.map((a) => (
              <LookTile key={a.avatarId} avatar={a} selected={!!currentAvatarId && a.avatarId === currentAvatarId} onPick={onPick} />
            ))}
          </div>
        ) : (
          <div role="radiogroup" aria-label="Featured avatars" className="grid grid-cols-5 gap-2 flex-1 min-h-0">
            {shown.map((a) => (
              <LookTile key={a.avatarId} avatar={a} selected={!!currentAvatarId && a.avatarId === currentAvatarId} onPick={onPick} />
            ))}
          </div>
        )}
      </div>

      {/* Alt: your own portrait */}
      <div className="flex items-center gap-2.5 shrink-0">
        <span className="text-[11px] text-muted-foreground">Have your own portrait?</span>
        <button type="button" className={GHOST_BUTTON} onClick={handleUseImage}>
          <ImageIcon className="size-3 opacity-70" />
          Use an image instead
        </button>
      </div>
    </div>
  )
}
