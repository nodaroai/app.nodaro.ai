// Admin → Video Remake, the shot lock (the `nodaro_motion_shot_lock`
// setting): per engine, whether the prompt of every run people start
// themselves on an ordinary clip carries one more line, which tells the
// engine to keep the clip's shot order and not add shots. Off for every
// engine until it is turned on; there is no deployment default.
//
// A trend keeps its own prompt, and a style-only run and a 3D previz run
// never carry the line.
//
// Where this environment's engine does not write the line (`supported`
// false), the switches say that nothing reads them here yet. The server
// refuses "on" while no environment's engine writes it.

import { useId } from "react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { NodaroMotionEngine, NodaroMotionShotLock, NodaroMotionShotLockValue, NodaroMotionShotLockView } from "@/lib/api"

export const SHOT_LOCK_HEADING = "Shot lock"

export const SHOT_LOCK_HINT =
  "Adds a line to the prompt that tells the engine to keep the clip's shot order and not add shots. Off by default, for runs people start themselves on an ordinary clip; trends keep their own prompt."

/** Said where this environment's engine does not write the line. */
export const SHOT_LOCK_UNSUPPORTED = "This environment's engine does not write the shot lock yet: nothing here is read until it does."

/** The setting as it is saved: each engine that is on; one that is off is left out. A new object. */
export function shotLockToSaved(draft: NodaroMotionShotLock | null | undefined): NodaroMotionShotLock {
  const out: NodaroMotionShotLock = {}
  for (const [id, value] of Object.entries(draft ?? {}) as Array<[NodaroMotionEngine, NodaroMotionShotLockValue | undefined]>) {
    if (value === "on") out[id] = "on"
  }
  return out
}

interface Props {
  /** The live setting (its GET), with the engines it lists. */
  readonly view: NodaroMotionShotLockView
  /** The draft: each engine that is on. */
  readonly value: NodaroMotionShotLock
  readonly onChange: (next: NodaroMotionShotLock) => void
  /** The last save's refusal, said under the switches. */
  readonly saveError: unknown
}

export function ShotLockSection({ view, value, onChange, saveError }: Props) {
  const id = useId()
  const hintId = `${id}-hint`
  const set = (engine: NodaroMotionEngine, on: boolean) => {
    const out: NodaroMotionShotLock = { ...value }
    if (on) out[engine] = "on"
    else delete out[engine]
    onChange(out)
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm" data-testid="shot-lock">
      <p id={hintId} className="text-xs text-muted-foreground">
        {SHOT_LOCK_HINT}
      </p>
      {view.engines.map((engine) => {
        const switchId = `${id}-${engine.id}`
        return (
          <div key={engine.id} className="flex items-center justify-between gap-3">
            <Label htmlFor={switchId} className="font-medium">
              {engine.name}
            </Label>
            <Switch id={switchId} checked={value[engine.id] === "on"} onCheckedChange={(on) => set(engine.id, on)} aria-describedby={hintId} />
          </div>
        )
      })}
      {!view.supported && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {SHOT_LOCK_UNSUPPORTED}
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
