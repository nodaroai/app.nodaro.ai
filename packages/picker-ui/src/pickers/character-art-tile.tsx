"use client"

import { memo, useState, type CSSProperties, type ReactNode } from "react"
import { Check } from "lucide-react"
import { cn } from "../lib/cn"
import {
  CHARACTER_THUMB_POSITION,
  characterArtUrl,
  type CharacterArtFamily,
  type CharacterArtShape,
} from "../icons/character-art"

interface CharacterArtProps {
  readonly family: CharacterArtFamily
  readonly id: string
  /** Size / radius classes; the picture always covers its box. */
  readonly className?: string
  /** CSS object-position — where the crop sits. Defaults to the top centre. */
  readonly position?: string
  /** What to show without a photo, or when it fails to load. */
  readonly fallback: ReactNode
}

// `width: 0; min-width: 100%` (the canvas nodes' idiom): the picture fills the
// width its box has but never widens it, whatever the file's own size.
const FILL_NOT_GROW: CSSProperties = { width: 0, minWidth: "100%" }

/**
 * The ONE way a character option is pictured: the picker tile, the picked
 * chip, the canvas card and the published-app card all render this, so the
 * picture a user picks is the picture they see everywhere.
 */
export const CharacterArt = memo(function CharacterArt({ family, id, className, position, fallback }: CharacterArtProps) {
  const url = characterArtUrl(family, id)
  // Keyed by URL, so moving to another option retries instead of sticking to the fallback.
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined)
  if (!url || url === failedUrl) return <>{fallback}</>
  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailedUrl(url)}
      // The photos' own dark ground, on the image itself: it shows through their
      // soft edges, and goes away with the image if it fails to load.
      className={cn("block bg-[#0e1424] object-cover", className)}
      style={{ ...FILL_NOT_GROW, objectPosition: position ?? "50% 0%" }}
    />
  )
})

interface CharacterThumbProps {
  readonly family: CharacterArtFamily
  readonly id: string
  readonly shape?: CharacterArtShape
  /** Size + radius, e.g. "size-[22px] rounded-full". */
  readonly className?: string
  /** Shown centred in the thumbnail when the option has no photo. */
  readonly fallback?: ReactNode
}

/** A small square crop of an option's photo — the picked chip, the canvas card. */
export function CharacterThumb({ family, id, shape = "square", className, fallback }: CharacterThumbProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("relative flex shrink-0 items-center justify-center overflow-hidden bg-[#f1f1f4] dark:bg-[#1c1c21]", className)}
    >
      <CharacterArt
        family={family}
        id={id}
        className="absolute inset-0 size-full"
        position={CHARACTER_THUMB_POSITION[shape]}
        fallback={fallback ?? null}
      />
    </span>
  )
}

/** Picture box of a tile, per shape. Literal strings: Tailwind reads the built package. */
const ASPECT: Readonly<Record<CharacterArtShape, string>> = {
  square: "aspect-square",
  portrait: "aspect-[3/4]",
  wide: "aspect-[9/4]",
  strip: "aspect-[10/3]",
}

/**
 * Grid of photo tiles, per shape: the column floor follows the picture's shape
 * (a strip needs a wide column), `min(…, 100%)` keeps a single column inside
 * a narrow popover, and at 520px of container width the square/portrait
 * columns widen. The enclosing picker must carry `@container`.
 */
const GRID: Readonly<Record<CharacterArtShape, string>> = {
  square: "grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(100px,100%),1fr))] @min-[520px]:grid-cols-[repeat(auto-fill,minmax(120px,1fr))]",
  portrait: "grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(100px,100%),1fr))] @min-[520px]:grid-cols-[repeat(auto-fill,minmax(120px,1fr))]",
  wide: "grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))]",
  strip: "grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]",
}

export function characterArtGridClass(shape: CharacterArtShape): string {
  return GRID[shape]
}

export interface CharacterArtTileProps {
  readonly family: CharacterArtFamily
  readonly id: string
  readonly shape: CharacterArtShape
  /** Localized label, shown under the photo — and the accessible name unless `ariaLabel` is set. */
  readonly label: string
  /** The accessible name when the visible label is shortened (e.g. "any" for "Asian (any)"). */
  readonly ariaLabel?: string
  /** Tooltip. */
  readonly title?: string
  readonly selected: boolean
  /** Multi-capable dimension → checkbox semantics, else radio. */
  readonly multi: boolean
  readonly onPick: () => void
  /** Drawn icon / swatch / emoji shown in the picture box when there is no photo. */
  readonly fallback?: ReactNode
  /**
   * The MultiPickBadge of a selected tile in a multi-capable dimension. Rendered
   * as a SIBLING of the button (never nested interactive elements) and replaces
   * the check mark in the same corner.
   */
  readonly badge?: ReactNode
  /**
   * Keep a double-click on this tile from reaching the full-screen settings,
   * which close on a double-click on any option tile. Only the Person tiles
   * set it: their Compact popover renders through a portal, and a double-click
   * there must not close the panel behind it.
   */
  readonly stopDoubleClick?: boolean
}

/**
 * One option tile of the character pickers: the photo on top (cropped to the
 * dimension's shape), the label under it, a check in the corner when picked.
 * The tile stays a native `<button role=radio|checkbox>` with `aria-checked` —
 * the config panel's delegated arrow-key navigation and the fullscreen
 * double-click-to-close both select exactly that.
 */
export function CharacterArtTile({
  family,
  id,
  shape,
  label,
  ariaLabel,
  title,
  selected,
  multi,
  onPick,
  fallback,
  badge,
  stopDoubleClick = false,
}: CharacterArtTileProps) {
  const hasArt = characterArtUrl(family, id) !== undefined
  // No photo and no drawn icon: a soft pink ground, so the box reads as
  // intentional rather than as a picture that failed to load. (A photo brings
  // its own dark ground, see CharacterArt.)
  const ground =
    hasArt || fallback
      ? "bg-[#f1f1f4] dark:bg-[#1c1c21]"
      : "bg-[linear-gradient(135deg,#fff0f6,#ffdcec)] dark:bg-[linear-gradient(135deg,rgba(255,0,115,.18),rgba(255,0,115,.04))]"
  return (
    <div className="relative min-w-0 transition-transform duration-150 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <button
        type="button"
        role={multi ? "checkbox" : "radio"}
        aria-checked={selected}
        aria-label={ariaLabel ?? label}
        title={title}
        onClick={onPick}
        onDoubleClick={stopDoubleClick ? (e) => e.stopPropagation() : undefined}
        className={cn(
          "flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-xl border-[1.5px] px-1.5 pt-2 pb-[9px] text-center transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0073]/60",
          selected
            ? "border-[#ff0073] bg-[#fff0f6] dark:bg-[#ff0073]/[.13]"
            : "border-[#ececf0] bg-[#fbfbfc] hover:border-[#f4a6c8] dark:border-[#26262c] dark:bg-[#0b0b0d] dark:hover:border-[#ff3f93]/50",
        )}
      >
        <span
          aria-hidden="true"
          className={cn("relative flex w-full items-center justify-center overflow-hidden rounded-[9px]", ASPECT[shape], ground)}
        >
          <CharacterArt family={family} id={id} className="absolute inset-0 size-full" fallback={fallback ?? null} />
        </span>
        <span
          className={cn(
            "line-clamp-2 max-w-full break-words text-[11.5px] font-semibold leading-[1.2]",
            selected ? "text-[#c8105f] dark:text-[#ff6aa9]" : "text-[#16161a] dark:text-[#ededf0]",
          )}
        >
          {label}
        </span>
      </button>
      {badge ??
        (selected && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-[5px] right-[5px] flex size-4 items-center justify-center rounded-full bg-[#ff0073]"
          >
            <Check className="size-2.5 text-white" strokeWidth={3} />
          </span>
        ))}
    </div>
  )
}
