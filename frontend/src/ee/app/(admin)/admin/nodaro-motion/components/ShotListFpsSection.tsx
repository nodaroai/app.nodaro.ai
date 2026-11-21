// Admin → Video Remake, the shot list's frame rate (the
// `nodaro_motion_shot_list_fps` setting): how many frames of each second the
// model that writes a run's shot list is shown of the clip.
//
// The shot list is the run's script, one line per shot. At one frame a
// second a shot shorter than a second can fall between two frames: it is
// never seen, and the lines written after it slip onto the wrong shots. A
// higher rate shows every shot, and sends more frames with that one call.
//
// The rate is stored only once an admin chose one: while none is, the
// engine's own default decides (shown as recommended), so the draft keeps it
// left out until the admin picks another value.
//
// Where this environment's engine reads no rate (`supported` false), or this
// deployment cannot serve a call that carries one (`rateCarried` false), the
// rate still saves, and the block says that nothing reads it here.

import { useId } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { NodaroMotionShotListFps, NodaroMotionShotListFpsView } from "@/lib/api"

export const SHOT_LIST_FPS_HEADING = "Shot list frame rate"

export const SHOT_LIST_FPS_LABEL = "Frames a second"

/** One rate as the list names it: its number, what 1 means, and which one is recommended. */
export function shotListFpsOptionLabel(fps: number, defaultFps: number): string {
  if (fps === defaultFps) return `${fps} (recommended)`
  if (fps === 1) return "1 (as before this setting)"
  return String(fps)
}

/** The select's hint: what the rate does, and what a higher one costs. */
export function shotListFpsHint(defaultFps: number): string {
  return `How many frames of each second the model that writes a run's shot list is shown. At 1, a shot shorter than a second can fall between two frames: it is never seen, and the lines after it slip onto the wrong shots. A higher rate shows every shot. Cost: that one call reads as many times more frames as the rate (${defaultFps} sends ${defaultFps} times the frames of 1), and any rate above 1 runs it on the model provider's own API, at that API's price. Recommended: ${defaultFps}.`
}

/** Said where this environment's engine reads no frame rate. */
export const SHOT_LIST_FPS_UNSUPPORTED = "This environment's engine reads no frame rate yet: its shot lists are written from 1 frame a second until it does."

/** Said where this deployment cannot serve a call that carries a frame rate. */
export const SHOT_LIST_FPS_NOT_CARRIED =
  "This deployment has no key for the model provider's own API, which is what carries a frame rate: shot lists are written from 1 frame a second, whatever is saved here."

/** The setting as it is saved (the server's own reading): `fps` only when an admin chose a rate. A new object. */
export function shotListFpsToSaved(draft: NodaroMotionShotListFps | null | undefined): NodaroMotionShotListFps {
  const out: NodaroMotionShotListFps = {}
  if (typeof draft?.fps === "number") out.fps = draft.fps
  return out
}

interface Props {
  /** The live setting (its GET). */
  readonly view: NodaroMotionShotListFpsView
  /** The draft, in its saved form (`fps` left out: the engine's default). */
  readonly value: NodaroMotionShotListFps
  readonly onChange: (next: NodaroMotionShotListFps) => void
  /** The last save's refusal, said under the select. */
  readonly saveError: unknown
  /** The id of the block's heading, which names the select with its label. */
  readonly headingId: string
}

export function ShotListFpsSection({ view, value, onChange, saveError, headingId }: Props) {
  const id = useId()
  const selectId = `${id}-select`
  const labelId = `${id}-label`
  const hintId = `${id}-hint`
  const current = value.fps ?? view.defaultFps
  // A stored rate that is no longer offered still shows as what it is.
  const options = view.options.includes(current) ? view.options : [...view.options, current].sort((a, b) => a - b)
  const setFps = (next: number) => {
    const out: NodaroMotionShotListFps = { ...value }
    // Stored only once an admin chose a rate: back at the default with none saved, it stays left out.
    if (typeof view.shotListFps?.fps === "number" || next !== view.defaultFps) out.fps = next
    else delete out.fps
    onChange(out)
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm" data-testid="shot-list-fps">
      <div className="flex min-w-0 flex-col gap-1">
        <Label id={labelId} htmlFor={selectId} className="font-medium">
          {SHOT_LIST_FPS_LABEL}
        </Label>
        <p id={hintId} className="text-xs text-muted-foreground">
          {shotListFpsHint(view.defaultFps)}
        </p>
      </div>
      <Select value={String(current)} onValueChange={(v) => setFps(Number(v))}>
        <SelectTrigger id={selectId} className="h-9 w-full sm:w-64" aria-labelledby={`${headingId} ${labelId}`} aria-describedby={hintId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((fps) => (
            <SelectItem key={fps} value={String(fps)}>
              {shotListFpsOptionLabel(fps, view.defaultFps)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!view.supported && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {SHOT_LIST_FPS_UNSUPPORTED}
        </p>
      )}
      {view.supported && !view.rateCarried && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {SHOT_LIST_FPS_NOT_CARRIED}
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
