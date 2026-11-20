// Admin → Video Remake, the 3D previz clips (the `nodaro_motion_previz`
// setting): whether this deployment accepts a run whose clip is a 3D previz
// (simple untextured models moved and filmed as the video to make will be).
// Such a clip is rendered into the run's look (its art style or custom style,
// else real-world footage) instead of edited.
//
// The switch is stored only once an admin chose a value: while none is, the
// deployment's default decides (on for Nodaro's own, off on a white-label
// one), so the draft keeps it left out until the admin picks the other value.
//
// Where this environment's engine takes no such clip (`supported` false), the
// switch still saves, and says that nothing reads it here yet.

import { useId } from "react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { NodaroMotionPreviz, NodaroMotionPrevizView } from "@/lib/api"

export const PREVIZ_HEADING = "3D previz clips"

export const PREVIZ_SWITCH_LABEL = "Offered"

/**
 * The switch's accessible name: its block's heading, then its label. "Offered" alone is also the roles' switch, and
 * two switches of one name cannot be told apart by a screen reader.
 */
export const PREVIZ_SWITCH_NAME = `${PREVIZ_HEADING} ${PREVIZ_SWITCH_LABEL}`

/** The switch's hint: what it does, and this deployment's default. */
export function previzSwitchHint(enabledByDefault: boolean): string {
  return `People can say that their clip is a 3D previz (untextured stand-in models): the engine then renders it into the look they chose, or into real-world footage, instead of editing it. Nodaro Prism only. This deployment's default: ${enabledByDefault ? "on" : "off"}.`
}

/** Said where this environment's engine takes no 3D previz clip. */
export const PREVIZ_UNSUPPORTED = "This environment's engine takes no 3D previz clip yet: such a run is refused here until it does."

/** The setting as it is saved (the server's own reading): `enabled` only when an admin chose a value. A new object. */
export function previzToSaved(draft: NodaroMotionPreviz | null | undefined): NodaroMotionPreviz {
  const out: NodaroMotionPreviz = {}
  if (typeof draft?.enabled === "boolean") out.enabled = draft.enabled
  return out
}

interface Props {
  /** The live setting (its GET). */
  readonly view: NodaroMotionPrevizView
  /** The draft, in its saved form (`enabled` left out: the deployment's default). */
  readonly value: NodaroMotionPreviz
  readonly onChange: (next: NodaroMotionPreviz) => void
  /** The last save's refusal, said under the switch. */
  readonly saveError: unknown
  /** The id of the block's heading, which names the switch with its label. */
  readonly headingId: string
}

export function PrevizSection({ view, value, onChange, saveError, headingId }: Props) {
  const id = useId()
  const switchId = `${id}-switch`
  const labelId = `${id}-label`
  const hintId = `${id}-hint`
  const checked = value.enabled ?? view.enabledByDefault
  const setEnabled = (next: boolean) => {
    const out: NodaroMotionPreviz = { ...value }
    // Stored only once an admin chose a value: back at the deployment's default with none saved, it stays left out.
    if (typeof view.previz?.enabled === "boolean" || next !== view.enabledByDefault) out.enabled = next
    else delete out.enabled
    onChange(out)
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm" data-testid="previz">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Label id={labelId} htmlFor={switchId} className="font-medium">
            {PREVIZ_SWITCH_LABEL}
          </Label>
          <p id={hintId} className="text-xs text-muted-foreground">
            {previzSwitchHint(view.enabledByDefault)}
          </p>
        </div>
        <Switch id={switchId} className="mt-0.5" checked={checked} onCheckedChange={setEnabled} aria-labelledby={`${headingId} ${labelId}`} aria-describedby={hintId} />
      </div>
      {!view.supported && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {PREVIZ_UNSUPPORTED}
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
