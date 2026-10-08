"use client"

import { memo, useState } from "react"
import { SPEAKER_SWITCHES } from "@nodaro/shared"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { CombineTransitionPicker } from "./combine-transition-picker"
import { SpeakerOptionTile, type SpeakerPickerOption } from "./speaker-option-tile"

const XFADE_PREFIX = "xfade:"

/** The combine-videos ids behind the crossfade family, DERIVED from the
 *  switch registry (never hand-listed): one per real ffmpeg xfade, never `cut`. */
export const SPEAKER_CROSSFADE_COMBINE_IDS: readonly string[] = SPEAKER_SWITCHES.filter((s) => s.overlaps).map((s) => s.id.slice(XFADE_PREFIX.length))

interface SpeakerSwitchPickerProps {
  /** Cut, Pan and Zoom, in that order, with whether each applies. */
  readonly options: readonly SpeakerPickerOption[]
  /** `cut`, `pan`, `zoom` or `xfade:<combine id>`. */
  readonly value: string
  readonly onChange: (id: string) => void
  readonly ariaLabel: string
  /** The Crossfade tile's text ("Crossfade…"). */
  readonly crossfadeLabel: string
  /** Its text while a crossfade is chosen ("Crossfade: Wipe Left"). */
  readonly crossfadeSelectedLabel?: string
  /** Localizes the catalog's own English tile, tab and caption strings. */
  readonly localizeLabel?: (english: string) => string
  /** The Crossfade tile is ruled out for this edit (no speaker change crosses a
   *  jump of the clock): greyed like the basic tiles, it neither opens the
   *  transition popover nor reports a value. A stored crossfade stays checked. */
  readonly crossfadeDisabled?: boolean
  /** Why it is ruled out, already localized — the title on hover, a caption on
   *  keyboard focus, and read aloud. */
  readonly crossfadeReason?: string
}

/**
 * Speaker View's switch tiles (U2): what happens at a speaker change — Cut,
 * Pan, Zoom, or a crossfade. Each basic tile loops a small animation of what
 * it does; the Crossfade tile opens the combine-videos transition picker
 * restricted to the crossfade family (`xfade:<id>`), with the basic switches
 * as leading tiles above it so one visit changes anything.
 */
export const SpeakerSwitchPicker = memo(function SpeakerSwitchPicker({
  options,
  value,
  onChange,
  ariaLabel,
  crossfadeLabel,
  crossfadeSelectedLabel,
  localizeLabel,
  crossfadeDisabled,
  crossfadeReason,
}: SpeakerSwitchPickerProps) {
  const [open, setOpen] = useState(false)
  const isCrossfade = value.startsWith(XFADE_PREFIX)
  const crossfadeTileLabel = isCrossfade ? (crossfadeSelectedLabel ?? crossfadeLabel) : crossfadeLabel
  const basicTile = (o: SpeakerPickerOption) => (
    <SpeakerOptionTile key={o.id} role="radio" label={o.label} checked={o.id === value} disabled={o.disabled} reason={o.reason} onSelect={() => { onChange(o.id); setOpen(false) }}>
      <SwitchPreview kind={o.id} />
    </SpeakerOptionTile>
  )
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="grid grid-cols-4 gap-1">
      {options.map(basicTile)}
      {crossfadeDisabled ? (
        // Ruled out: the tile only explains itself, so it sits outside the
        // popover trigger (which would open on click whatever the tile does).
        <SpeakerOptionTile role="radio" label={crossfadeTileLabel} checked={isCrossfade} disabled reason={crossfadeReason} onSelect={() => {}}>
          <SwitchPreview kind="xfade" />
        </SpeakerOptionTile>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            {/* The trigger toggles the popover itself; the tile's own select is a no-op. */}
            <SpeakerOptionTile role="radio" label={crossfadeTileLabel} checked={isCrossfade} haspopup onSelect={() => {}}>
              <SwitchPreview kind="xfade" />
            </SpeakerOptionTile>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <CombineTransitionPicker
              value={isCrossfade ? value.slice(XFADE_PREFIX.length) : ""}
              onChange={(id) => { onChange(XFADE_PREFIX + id); setOpen(false) }}
              allowedIds={SPEAKER_CROSSFADE_COMBINE_IDS}
              localizeLabel={localizeLabel}
              leadingLabel={ariaLabel}
              leadingTiles={options.map(basicTile)}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
})

/** A looping 2.4 s sketch of the switch: two speakers' pictures A and B and
 *  what moves between them. Pure CSS, paused for reduced motion. */
function SwitchPreview({ kind }: { readonly kind: string }) {
  const known = kind === "cut" || kind === "pan" || kind === "zoom" || kind === "xfade"
  return (
    <div className="stv-root" data-kind={known ? kind : "cut"} aria-hidden="true">
      <div className="stv-pic stv-pic-a" />
      <div className="stv-pic stv-pic-b" />
      <div className="stv-frame" />
    </div>
  )
}
