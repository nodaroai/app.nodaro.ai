"use client"

import { useState, type ReactNode } from "react"
import { Check } from "lucide-react"
import { cn } from "../lib/cn"
import type { SoundArt } from "../icons/sound-art"
import { LookArt, useLookPreviewUrl } from "../look-previews"

export interface SoundArtTileProps {
  /** Localized label — also the tile's accessible name. */
  readonly label: string
  /** Localized description: the tooltip, and a line under the label in the wide layout. */
  readonly description: string
  /** The option's picture; undefined renders the label alone. */
  readonly art: SoundArt | undefined
  /**
   * Where this option's rendered picture is registered (the music / voice
   * pickers on Nodaro Cloud — see SOUND_RENDER_SETS). When one is, it fills the tile's
   * width in place of the small emoji, which stays as its fallback.
   */
  readonly render?: { readonly pickerKey: string; readonly id: string }
  readonly selected: boolean
  /** The section's switch — off keeps the tile clickable but says so in the tooltip. */
  readonly checked: boolean
  readonly sectionLabel: string
  /** Multi-capable section → checkbox semantics, else radio. */
  readonly multi: boolean
  readonly onPick: () => void
  /**
   * The MultiPickBadge for a selected tile in a multi-capable section. Rendered
   * as a SIBLING of the button (never nested interactive elements) and replaces
   * the check mark in the same corner.
   */
  readonly badge?: ReactNode
}

/**
 * One option tile of the music / voice pickers: picture on a soft floor
 * shadow, label, and (only when the picker is at least 520px wide) the
 * description. The tile stays a native `<button role=radio|checkbox>` with
 * `aria-checked` — the config panel's delegated arrow-key navigation and the
 * fullscreen double-click-to-close both select exactly that.
 *
 * The enclosing picker root must carry `@container`; the tile reads its width
 * through the `@min-[520px]:` variants (class strings stay literal so Tailwind
 * finds them in the built package).
 */
export function SoundArtTile({
  label,
  description,
  art,
  render,
  selected,
  checked,
  sectionLabel,
  multi,
  onPick,
  badge,
}: SoundArtTileProps) {
  const renderUrl = useLookPreviewUrl(render?.pickerKey ?? "", render?.id ?? "")
  const photo = render !== undefined && renderUrl !== undefined
  // A file that fails to load (the server's SPA fallback answers a missing
  // file with HTML) degrades to the label alone instead of a broken image.
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined)
  const shownArt = art && art.url !== failedUrl ? art : undefined
  const descriptionText = description.trim()
  const showDescription =
    descriptionText.length > 0 && descriptionText.toLowerCase() !== label.trim().toLowerCase()

  return (
    <div className="relative transition-transform duration-200 hover:-translate-y-[3px] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <button
        type="button"
        role={multi ? "checkbox" : "radio"}
        aria-checked={selected}
        aria-label={label}
        title={checked ? description : `${description} (toggle on ${sectionLabel} to pick)`}
        onClick={onPick}
        className={cn(
          "flex h-full w-full cursor-pointer flex-col items-center gap-[5px] border-[1.5px] text-center transition-[border-color,background-color,box-shadow]",
          photo
            ? "rounded-xl p-1 pb-2 @min-[520px]:rounded-2xl @min-[520px]:p-1.5 @min-[520px]:pb-[11px]"
            : "rounded-xl px-1 pt-[9px] pb-2 @min-[520px]:rounded-2xl @min-[520px]:px-2 @min-[520px]:pt-3 @min-[520px]:pb-[11px]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0073]/60",
          selected
            ? "border-[#ff0073] bg-[#fff0f6] shadow-[0_0_0_3px_rgba(255,0,115,.12),0_10px_24px_-10px_rgba(255,0,115,.35)] dark:bg-[#ff0073]/[.13] dark:shadow-[0_0_0_3px_rgba(255,0,115,.16),0_10px_28px_-10px_rgba(255,0,115,.55)]"
            : "border-[#ececf1] bg-white shadow-[0_1px_2px_rgba(0,0,0,.04)] hover:border-[#d9d9e2] dark:border-white/[.07] dark:bg-white/[.035] dark:shadow-[inset_0_1px_0_rgba(255,255,255,.03)] dark:hover:border-white/[.14]",
        )}
      >
        {photo && render ? (
          <LookArt
            pickerKey={render.pickerKey}
            id={render.id}
            width={240}
            className="w-full aspect-square rounded-lg @min-[520px]:rounded-xl"
            fallback={
              // Same square box as the render, so a failed render keeps the tile's size.
              <span className="flex w-full aspect-square items-center justify-center">
                <EmojiArt art={shownArt} onFail={setFailedUrl} />
              </span>
            }
          />
        ) : (
          <EmojiArt art={shownArt} onFail={setFailedUrl} />
        )}
        <span
          className={cn(
            "line-clamp-2 max-w-full break-words text-[11px] font-semibold leading-[1.25] @min-[520px]:text-[12.5px]",
            selected ? "text-[#c8105f] dark:text-[#ff6aa9]" : "text-[#1c1c22] dark:text-[#f1f1f4]",
          )}
        >
          {label}
        </span>
        {showDescription && (
          <span
            aria-hidden="true"
            className="hidden text-[10.5px] leading-[1.3] text-[#6b6b75] [text-wrap:pretty] @min-[520px]:block dark:text-[#9a9aa6]"
          >
            {descriptionText}
          </span>
        )}
      </button>
      {badge ??
        (selected && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-[#ff0073]"
          >
            <Check className="size-2.5 text-white" strokeWidth={3} />
          </span>
        ))}
    </div>
  )
}

/** The small 3D emoji / flag the tile shows without a rendered picture. */
function EmojiArt({ art: shownArt, onFail }: { readonly art: SoundArt | undefined; readonly onFail: (url: string) => void }) {
  return (
    <span
      aria-hidden="true"
      className="relative flex size-10 shrink-0 items-center justify-center @min-[520px]:size-[58px]"
    >
      {shownArt && (
        <span className="absolute inset-x-[18%] bottom-0.5 h-1.5 rounded-[50%] bg-[rgba(20,20,40,.14)] blur-[4px] dark:bg-black/60" />
      )}
      {shownArt?.kind === "flag" && (
        <span className="relative aspect-[10/7] w-[86%] overflow-hidden rounded-md shadow-[0_6px_14px_-4px_rgba(0,0,0,.4),inset_0_0_0_1px_rgba(0,0,0,.06)]">
          <img
            src={shownArt.url}
            alt=""
            width={120}
            height={90}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => onFail(shownArt.url)}
            className="block size-full object-cover"
          />
          <span className="absolute inset-0 bg-[linear-gradient(160deg,rgba(255,255,255,.45)_0%,rgba(255,255,255,0)_45%,rgba(0,0,0,.12)_100%)]" />
        </span>
      )}
      {shownArt?.kind === "emoji" && (
        <img
          src={shownArt.url}
          alt=""
          width={128}
          height={128}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => onFail(shownArt.url)}
          className="relative size-[86%] object-contain"
        />
      )}
    </span>
  )
}
