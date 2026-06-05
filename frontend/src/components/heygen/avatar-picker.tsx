"use client"

// frontend/src/components/heygen/avatar-picker.tsx
//
// Rich, virtualized avatar tile grid for the HeyGen avatar catalog.
// Consumed by:
//   • the ai-avatar node config panel (inline within the config drawer)
//   • published-app input cards (AvatarPickerInputCard)
//
// Design constraints:
//   • Virtualized via use-virtual-grid — the catalog can be large (hundreds of
//     looks) and we never want them all in the DOM at once inside a modal.
//   • Images are lazy-mounted via use-lazy-mount — avoids a burst of parallel
//     image fetches when the picker first opens.
//   • Selected tile highlighted with brand pink ring.
//   • On tile click the FULL HeygenAvatar object is passed to `onSelect` so
//     callers can pre-fill defaultVoiceId and preferredOrientation.

import { memo, useCallback, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, User, AlertCircle } from "lucide-react"
import {
  getHeygenAvatars,
  type HeygenAvatar,
} from "@/lib/api"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useVirtualGrid, rowItems } from "@/hooks/use-virtual-grid"
import { useLazyMount } from "@/components/audio-player/use-lazy-mount"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Breakpoints — a 2-col grid at narrow, up to 4-col at wider panels.
// The picker typically renders inside a config drawer (~340 px) so the narrower
// breakpoints matter most. An explicit scrollElementRef is passed in so the
// virtualizer knows its scroll container.
// ---------------------------------------------------------------------------
const AVATAR_BREAKPOINTS = [
  { min: 0, cols: 2 },
  { min: 480, cols: 3 },
  { min: 720, cols: 4 },
] as const

const GRID_GAP = 8 // gap-2

// ---------------------------------------------------------------------------
// AvatarTile — a single tile in the grid. Lazy-mounts the image via
// IntersectionObserver so off-screen tiles don't load eagerly.
// ---------------------------------------------------------------------------
interface AvatarTileProps {
  readonly avatar: HeygenAvatar
  readonly selected: boolean
  readonly onSelect: (a: HeygenAvatar) => void
}

const AvatarTile = memo(function AvatarTile({
  avatar,
  selected,
  onSelect,
}: AvatarTileProps) {
  const { ref, mounted } = useLazyMount("400px")

  return (
    // The div wrapper acts as the IntersectionObserver root for lazy mount.
    // The button is nested so we get proper :focus-visible ring + aria props.
    <div ref={ref}>
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={avatar.name}
      onClick={() => onSelect(avatar)}
      className={cn(
        "relative group flex flex-col w-full overflow-hidden rounded-lg border text-left transition-colors cursor-pointer",
        selected
          ? "border-[#ff0073] ring-1 ring-[#ff0073]/60 bg-[#ff0073]/5"
          : "border-gray-200 dark:border-[#2D2D2D] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
      )}
    >
      {/* Thumbnail */}
      <div className="aspect-[3/4] w-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        {mounted ? (
          <img
            src={avatar.previewImageUrl}
            alt={avatar.name}
            loading="lazy"
            className="w-full h-full object-cover object-top transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full animate-pulse bg-zinc-200 dark:bg-zinc-700" />
        )}
      </div>

      {/* Name + gender chip */}
      <div className="px-1.5 py-1.5 flex flex-col gap-0.5 min-w-0">
        <span
          className={cn(
            "text-[10.5px] font-semibold leading-tight truncate",
            selected ? "text-[#ff0073]" : "text-foreground",
          )}
        >
          {avatar.name}
        </span>
        <span className="text-[9.5px] text-muted-foreground capitalize leading-tight">
          {avatar.gender}
        </span>
      </div>

      {/* Selection indicator dot */}
      {selected && (
        <span
          aria-hidden
          className="absolute top-1.5 right-1.5 w-3 h-3 rounded-full bg-[#ff0073] border-2 border-white dark:border-[#1E1E1E] shadow-sm"
        />
      )}
    </button>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Pure helpers — extracted so tests can cover them without mounting the grid
// ---------------------------------------------------------------------------

/** Derive the sorted list of unique genders present in the catalog. */
export function deriveGenders(avatars: readonly HeygenAvatar[]): string[] {
  const seen = new Set<string>()
  for (const a of avatars) {
    if (a.gender) seen.add(a.gender.toLowerCase())
  }
  return Array.from(seen).sort()
}

/** Return `true` when `groupId` distinguishes stock vs. custom avatars. */
export function hasGroupSegmentation(avatars: readonly HeygenAvatar[]): boolean {
  return avatars.some((a) => a.groupId != null && a.groupId !== "")
}

/** Filter the avatar list by the active search + gender + segment controls. */
export function filterAvatars(
  avatars: readonly HeygenAvatar[],
  query: string,
  gender: string,
  segment: "all" | "stock" | "custom",
): HeygenAvatar[] {
  const q = query.trim().toLowerCase()
  return avatars.filter((a) => {
    if (q && !a.name.toLowerCase().includes(q)) return false
    if (gender !== "all" && a.gender.toLowerCase() !== gender) return false
    if (segment === "stock" && a.groupId) return false
    if (segment === "custom" && !a.groupId) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface AvatarPickerProps {
  /** Currently selected avatarId. */
  readonly value?: string
  /** Called with the full avatar object on selection. */
  readonly onSelect: (avatar: HeygenAvatar) => void
  readonly className?: string
}

export const AvatarPicker = memo(function AvatarPicker({
  value,
  onSelect,
  className,
}: AvatarPickerProps) {
  const { data: avatars = [], isLoading, isError } = useQuery({
    queryKey: ["heygen-avatars"],
    queryFn: getHeygenAvatars,
    staleTime: 5 * 60 * 1000, // avatars change rarely
  })

  const [query, setQuery] = useState("")
  const [gender, setGender] = useState("all")
  const [segment, setSegment] = useState<"all" | "stock" | "custom">("all")

  const genders = useMemo(() => deriveGenders(avatars), [avatars])
  const showSegment = useMemo(() => hasGroupSegmentation(avatars), [avatars])

  const filtered = useMemo(
    () => filterAvatars(avatars, query, gender, segment),
    [avatars, query, gender, segment],
  )

  // Scroll container for the virtualizer.
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // useVirtualGrid requires fetchNextPage / hasNextPage. The heygen catalog is
  // fetched in one shot (no pagination), so we provide no-ops.
  const fetchNextPage = useCallback(() => {}, [])

  const {
    gridRef,
    virtualRows,
    totalSize,
    columns,
    scrollMargin,
    gridTemplateColumns,
  } = useVirtualGrid({
    itemCount: filtered.length,
    breakpoints: AVATAR_BREAKPOINTS,
    squareTiles: true,
    // 3:4 portrait tile ≈ width * (4/3) + 36px label strip.
    extraRowHeight: 36,
    estimateRowHeight: 180,
    gap: GRID_GAP,
    overscan: 4,
    scrollElementRef: scrollRef,
    fetchNextPage,
    hasNextPage: false,
    isFetchingNextPage: false,
  })

  // -------------------------------------------------------------------------
  // Loading skeleton
  // -------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <div className="h-8 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[3/4] bg-zinc-200 dark:bg-zinc-800 rounded-lg animate-pulse"
            />
          ))}
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------
  if (isError) {
    return (
      <div className={cn("flex flex-col items-center gap-2 py-8 text-center", className)}>
        <AlertCircle className="size-8 text-destructive/60" />
        <p className="text-sm text-muted-foreground">Failed to load avatars</p>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Empty catalog — HeyGen API key not configured
  // -------------------------------------------------------------------------
  if (avatars.length === 0) {
    return (
      <div
        className={cn("flex flex-col items-center gap-3 py-10 text-center px-4", className)}
        data-testid="avatar-picker-empty"
      >
        <User className="size-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">No HeyGen avatars</p>
        <p className="text-xs text-muted-foreground/70">
          Configure the HeyGen API key in Settings to browse available avatars.
        </p>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------
  return (
    <div className={cn("flex flex-col gap-2 min-h-0", className)}>
      {/* Controls row: search + gender + segment */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            aria-label="Search avatars"
            placeholder="Search avatars…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>

        <Select value={gender} onValueChange={setGender}>
          <SelectTrigger
            aria-label="Filter by gender"
            className="h-8 text-xs w-[90px] shrink-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All genders</SelectItem>
            {genders.map((g) => (
              <SelectItem key={g} value={g} className="text-xs capitalize">
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {showSegment && (
          <Select
            value={segment}
            onValueChange={(v) => setSegment(v as "all" | "stock" | "custom")}
          >
            <SelectTrigger
              aria-label="Filter by type"
              className="h-8 text-xs w-[90px] shrink-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All types</SelectItem>
              <SelectItem value="stock" className="text-xs">Stock</SelectItem>
              <SelectItem value="custom" className="text-xs">Custom</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Virtualized grid */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        style={{ maxHeight: 380 }}
      >
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="text-xs text-muted-foreground">
              No avatars match your filters
            </p>
          </div>
        ) : (
          <div
            role="radiogroup"
            aria-label="HeyGen avatars"
            ref={gridRef}
            style={{ height: totalSize, position: "relative" }}
          >
            {virtualRows.map((virtualRow) => (
              <div
                key={virtualRow.key}
                className="absolute top-0 left-0 w-full"
                style={{
                  transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                  display: "grid",
                  gridTemplateColumns,
                  gap: GRID_GAP,
                }}
              >
                {rowItems(filtered, virtualRow.index, columns).map(({ item: avatar }) => (
                  <AvatarTile
                    key={avatar.avatarId}
                    avatar={avatar}
                    selected={value === avatar.avatarId}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Item count */}
      {filtered.length > 0 && (
        <p className="text-[10px] text-muted-foreground text-right px-0.5">
          {filtered.length} avatar{filtered.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  )
})
