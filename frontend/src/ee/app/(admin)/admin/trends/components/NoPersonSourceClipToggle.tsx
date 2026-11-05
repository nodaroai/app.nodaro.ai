// A trend with no person to replace (a place, a pet, a product): whether the
// first try sends the source clip as it is. Off (the default): the trend runs
// as its face masking says. On: the first try sends the source clip, and if the
// model refuses the clip or what it would make, the one retry uses the trend's approved mask. Shown only where
// a run reads it (`noPersonSourceClipOffered`). It changes no mask's settings, so
// an approved mask stays approved.

import { Switch } from "@/components/ui/switch"

interface Props {
  readonly checked: boolean
  readonly onChange: (noPersonSourceClip: boolean) => void
}

export function NoPersonSourceClipToggle({ checked, onChange }: Props) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <Switch aria-label="Send the clip as it is first" checked={checked} onCheckedChange={onChange} />
        Send the clip as it is first
      </label>
      <p className="text-xs text-muted-foreground">
        With no person to replace, the first try sends the source clip. If the model refuses the clip or what it would make, the one retry uses this trend's approved mask, or masks for that run if the trend has none: the run's balance must also cover that masking, charged only if the retry runs.
      </p>
    </div>
  )
}
