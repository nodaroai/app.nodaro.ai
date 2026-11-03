// Admin → Nodaro Motion, the page's Advanced switch (the `nodaro_motion_advanced`
// setting): whether the Nodaro Motion page shows its Advanced chip, which holds
// Prepare references and the pre-prompt. One switch for the whole page, not per
// engine; off (hidden) until it is turned on.
//
// A page option only: nothing about a run reads it, so it needs no engine and is
// never greyed out. Runs started through the API, the SDK or MCP take both
// fields whatever it says.

import { useId } from "react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export const ADVANCED_SWITCH_LABEL = "Advanced in Nodaro Motion"

export const ADVANCED_SWITCH_HINT =
  "Shows the Advanced chip (Prepare references and the pre-prompt) on the Nodaro Motion page. Hidden by default. Only the page changes: runs through the API, the SDK and MCP can still set both."

interface Props {
  /** The draft: on = shown. */
  readonly checked: boolean
  readonly onChange: (next: boolean) => void
}

export function AdvancedSwitch({ checked, onChange }: Props) {
  const id = useId()
  const switchId = `${id}-advanced`
  const hintId = `${id}-advanced-hint`

  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor={switchId} className="font-medium">
          {ADVANCED_SWITCH_LABEL}
        </Label>
        <p id={hintId} className="text-xs text-muted-foreground">
          {ADVANCED_SWITCH_HINT}
        </p>
      </div>
      <Switch id={switchId} className="mt-0.5" checked={checked} onCheckedChange={onChange} aria-describedby={hintId} />
    </div>
  )
}
