// Admin → Video Remake, Prism's Precise upscale (the
// `nodaro_motion_precise_upscale` setting): per output resolution, whether a
// direct Precise run sends its take to Topaz video upscale, and at which
// size, before the result is scaled back to the run's own frame. Topaz at a
// size above the output restores the detail the edit softens.
//
// Each resolution is "Off" or a Topaz target (480p and 720p: 720p, 1080p or
// 4k; 1080p: 1080p or 4k); one never saved takes its default (480p and 720p:
// Topaz 1080p; 1080p: Topaz 4k), marked "(default)". The draft is always the
// whole effective setting, and Save sends it whole.
//
// Nodaro Prism Flash (decided 2026-11-22) has its own two rows (480p, 720p: it
// renders no 1080p), default Topaz 1080p each, in a "Nodaro Prism Flash" block: a
// Nodaro Prism Flash Precise run takes those, any other run the rows above.
//
// Where this environment's engine runs no upscale (`supported` false), the
// setting still saves, and the block says that nothing reads it here.
//
// While this environment's engine takes Video Remake's upscale choice (the
// view's `upscaleChoice`, decided 2026-11-24), the hidden step runs nowhere and
// the engine reads each row as a switch instead: "Off" = the choice is not
// offered at that size, any Topaz size = it is, and a run that picks it is
// delivered at the next size (480p → 720p, 720p → 1080p, 1080p → 4K). The
// stored values and the selects stay as they are; the heading and the notes
// say what a row does there (the `*_CHOICE_*` strings).

import { useId } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { NodaroMotionPreciseUpscale, NodaroMotionPreciseUpscaleEffective } from "@/lib/api"

export const PRECISE_UPSCALE_HEADING = "Precise upscale (Topaz)"

export const PRECISE_UPSCALE_NOTE = "Precise runs only. Topaz upscales the result, then it is scaled back to the run's resolution. Its cost is added to the run's price."

/** Said while this deployment withholds Topaz (its model or its credit row switched off). */
export const PRECISE_UPSCALE_TOPAZ_DISABLED = "Topaz is disabled on this deployment: every Precise run is delivered without the upscale, whatever is saved here."

/** Said where this environment's engine runs no upscale. */
export const PRECISE_UPSCALE_UNSUPPORTED = "This environment's engine runs no upscale yet: its Precise runs are delivered as the edit made them until it does."

/** The heading while the engine takes the upscale choice: each row turns it on or off at its size. */
export const PRECISE_UPSCALE_CHOICE_HEADING = "Upscale choice by size"

export const PRECISE_UPSCALE_CHOICE_NOTE =
  "Each row turns the Upscale choice on or off for runs made at that size: Off hides it there, any Topaz size offers it (the size picked here is not used). A run that picks it is delivered at the next size (480p → 720p, 720p → 1080p, 1080p → 4K), and the upscale is added to its price. Nodaro Pulse always offers it."

/** Said, while the engine takes the upscale choice, when this deployment withholds Topaz. */
export const PRECISE_UPSCALE_CHOICE_TOPAZ_DISABLED = "Topaz is disabled on this deployment: no engine offers the Upscale choice, whatever is saved here."

/** Said, while the engine takes the upscale choice, where it reads none of these rows. */
export const PRECISE_UPSCALE_CHOICE_UNSUPPORTED = "This environment's engine does not read these rows: Nodaro Prism and Nodaro Prism Flash offer the Upscale choice at no size here."

/** The block's heading: what a row does on this environment's engine. */
export function preciseUpscaleHeading(upscaleChoice: boolean): string {
  return upscaleChoice ? PRECISE_UPSCALE_CHOICE_HEADING : PRECISE_UPSCALE_HEADING
}

export type PreciseUpscaleResolution = Exclude<keyof NodaroMotionPreciseUpscaleEffective, "flash">

/** Nodaro Prism Flash's rows (no 1080p). */
export type PreciseUpscaleFlashResolution = keyof NodaroMotionPreciseUpscaleEffective["flash"]
export const PRECISE_UPSCALE_FLASH_RESOLUTIONS: readonly PreciseUpscaleFlashResolution[] = ["480p", "720p"]

/** The Nodaro Prism Flash block's heading. */
export const PRECISE_UPSCALE_FLASH_HEADING = "Nodaro Prism Flash"

export const PRECISE_UPSCALE_RESOLUTIONS: readonly PreciseUpscaleResolution[] = ["480p", "720p", "1080p"]

/** Each resolution's choices, "off" first (the server's own, cast-swap-prism-precise-upscale.ts). */
export const PRECISE_UPSCALE_CHOICES: { readonly [R in PreciseUpscaleResolution]: readonly NodaroMotionPreciseUpscaleEffective[R][] } = {
  "480p": ["off", "720p", "1080p", "4k"],
  "720p": ["off", "720p", "1080p", "4k"],
  "1080p": ["off", "1080p", "4k"],
}

/** Each resolution's choice while it was never saved (the server's own). */
export const PRECISE_UPSCALE_DEFAULTS: NodaroMotionPreciseUpscaleEffective = { "480p": "1080p", "720p": "1080p", "1080p": "4k", flash: { "480p": "1080p", "720p": "1080p" } }

/** The whole effective setting of a stored one: each resolution it leaves out (or a choice it does not take) at its default. A new object. */
export function preciseUpscaleEffective(stored: NodaroMotionPreciseUpscale | null | undefined): NodaroMotionPreciseUpscaleEffective {
  const out = { ...PRECISE_UPSCALE_DEFAULTS, flash: { ...PRECISE_UPSCALE_DEFAULTS.flash } }
  for (const r of PRECISE_UPSCALE_RESOLUTIONS) {
    const v = stored?.[r]
    if (v !== undefined && (PRECISE_UPSCALE_CHOICES[r] as readonly string[]).includes(v)) (out as unknown as Record<string, string>)[r] = v
  }
  // Nodaro Prism Flash's rows (a setting stored before them has none: their defaults).
  for (const r of PRECISE_UPSCALE_FLASH_RESOLUTIONS) {
    const v = stored?.flash?.[r]
    if (v !== undefined && (PRECISE_UPSCALE_CHOICES[r] as readonly string[]).includes(v)) (out.flash as Record<string, string>)[r] = v
  }
  return out
}

/** One choice as the list names it. */
export function preciseUpscaleOptionLabel(choice: string, defaultChoice: string): string {
  const name = choice === "off" ? "Off" : `Topaz ${choice}`
  return choice === defaultChoice ? `${name} (default)` : name
}

interface Props {
  readonly value: NodaroMotionPreciseUpscaleEffective
  readonly onChange: (next: NodaroMotionPreciseUpscaleEffective) => void
  /** Each resolution's default (the GET's). */
  readonly defaults: NodaroMotionPreciseUpscaleEffective
  readonly supported: boolean
  /** Whether this deployment withholds Topaz. */
  readonly topazDisabled: boolean
  /** Whether the engine takes the upscale choice: each row then turns it on or off at its size. */
  readonly upscaleChoice: boolean
  /** The last save's refusal, said under the selects. */
  readonly saveError: unknown
  /** The id of the block's heading, which names each select with its resolution. */
  readonly headingId: string
}

export function PreciseUpscaleSection({ value, onChange, defaults, supported, topazDisabled, upscaleChoice, saveError, headingId }: Props) {
  const id = useId()
  const noteId = `${id}-note`
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm" data-testid="precise-upscale">
      <p id={noteId} className="text-xs text-muted-foreground">
        {upscaleChoice ? PRECISE_UPSCALE_CHOICE_NOTE : PRECISE_UPSCALE_NOTE}
      </p>
      {PRECISE_UPSCALE_RESOLUTIONS.map((r) => {
        const labelId = `${id}-${r}-label`
        return (
          <div key={r} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <Label id={labelId} htmlFor={`${id}-${r}`} className="font-medium">
              {r}
            </Label>
            <Select value={value[r]} onValueChange={(v) => onChange({ ...value, [r]: v })}>
              <SelectTrigger id={`${id}-${r}`} className="h-9 w-full sm:w-56" aria-labelledby={`${headingId} ${labelId}`} aria-describedby={noteId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRECISE_UPSCALE_CHOICES[r].map((choice) => (
                  <SelectItem key={choice} value={choice}>
                    {preciseUpscaleOptionLabel(choice, defaults[r])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      })}
      <div role="group" aria-label={PRECISE_UPSCALE_FLASH_HEADING} className="flex min-w-0 flex-col gap-3 border-t pt-3">
        <h3 id={`${id}-flash-heading`} className="text-sm font-semibold">
          {PRECISE_UPSCALE_FLASH_HEADING}
        </h3>
        {PRECISE_UPSCALE_FLASH_RESOLUTIONS.map((r) => {
          const labelId = `${id}-flash-${r}-label`
          return (
            <div key={r} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <Label id={labelId} htmlFor={`${id}-flash-${r}`} className="font-medium">
                {r}
              </Label>
              <Select value={value.flash[r]} onValueChange={(v) => onChange({ ...value, flash: { ...value.flash, [r]: v } })}>
                <SelectTrigger id={`${id}-flash-${r}`} className="h-9 w-full sm:w-56" aria-labelledby={`${id}-flash-heading ${labelId}`} aria-describedby={noteId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRECISE_UPSCALE_CHOICES[r].map((choice) => (
                    <SelectItem key={choice} value={choice}>
                      {preciseUpscaleOptionLabel(choice, defaults.flash?.[r] ?? PRECISE_UPSCALE_DEFAULTS.flash[r])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        })}
      </div>
      {topazDisabled && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {upscaleChoice ? PRECISE_UPSCALE_CHOICE_TOPAZ_DISABLED : PRECISE_UPSCALE_TOPAZ_DISABLED}
        </p>
      )}
      {!supported && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {upscaleChoice ? PRECISE_UPSCALE_CHOICE_UNSUPPORTED : PRECISE_UPSCALE_UNSUPPORTED}
        </p>
      )}
      {saveError instanceof Error && (
        <p role="alert" className="text-xs text-destructive">
          {saveError.message}
        </p>
      )}
    </div>
  )
}
