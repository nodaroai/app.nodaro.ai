"use client"

import type { ReactNode } from "react"
import { CharacterThumb, type CharacterArtFamily, type CharacterArtShape } from "@/lib/picker-ui"

interface CharacterPickRowProps {
  readonly family: CharacterArtFamily
  /** The picked option — its photo is the thumbnail. */
  readonly id: string
  readonly shape?: CharacterArtShape
  /** Small caps line above the value (the setting's name); omitted on one-setting nodes. */
  readonly setLabel?: string
  readonly value: string
  /** Further picks of a multi-pick setting, one "+ label" line each. */
  readonly extras?: ReadonlyArray<string>
  readonly description?: string
  /** Drawn icon / swatch / emoji for an option without a photo. */
  readonly fallback?: ReactNode
}

// An option with neither photo nor drawn icon still gets a picture: the soft
// pink ground the card uses for text-only picks.
const TEXT_ONLY_GROUND = <span className="size-full bg-[linear-gradient(135deg,#ff3f93,#ff0073)]" />

/**
 * One pick on a character node card (Person, Styling, Held Prop, Material,
 * Animal): the option's photo as a 52px thumbnail, then the setting name and
 * the value on one line each and the description on up to two, so the card
 * stays compact. The thumbnail is the same photo the picker tile shows.
 */
export function CharacterPickRow({ family, id, shape, setLabel, value, extras, description, fallback }: CharacterPickRowProps) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-[14px] bg-[#f7f7f9] p-2 dark:bg-[#18181c]">
      <CharacterThumb
        family={family}
        id={id}
        shape={shape}
        className="size-[52px] rounded-xl border border-[#ececf0] dark:border-[#26262c]"
        fallback={fallback ?? TEXT_ONLY_GROUND}
      />
      <div className="flex min-w-0 flex-col gap-px">
        {setLabel && (
          <p className="truncate font-mono text-[9.5px] uppercase tracking-[.08em] text-[#9a9aa4] dark:text-[#7a7a85]">
            {setLabel}
          </p>
        )}
        <p className="truncate text-sm font-bold leading-tight text-foreground">{value}</p>
        {extras?.map((extra) => (
          <p key={extra} className="truncate text-xs leading-tight text-foreground/80">
            <span className="text-muted-foreground">+ </span>
            {extra}
          </p>
        ))}
        {description && (
          <p className="line-clamp-2 text-[11.5px] leading-snug text-[#6b6b75] dark:text-[#9a9aa4]">{description}</p>
        )}
      </div>
    </div>
  )
}
