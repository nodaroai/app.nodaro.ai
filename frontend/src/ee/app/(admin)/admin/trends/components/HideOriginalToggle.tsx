// Whether visitors see the trend's original clip. Off (the default): the
// trend's page shows the source's display copy as the original. On: the card
// and the page show Example 1 as the original and list the examples from
// Example 2, and the original clip never leaves the server. A trend that hides
// its original publishes only with an example (`hide_original_needs_example`),
// so the editor says so while the draft has none.

import { Switch } from "@/components/ui/switch"

interface Props {
  readonly checked: boolean
  /** The draft's examples as saved (examples are added from test runs, never in the form). */
  readonly examples: number
  readonly onChange: (hideOriginal: boolean) => void
}

export function HideOriginalToggle({ checked, examples, onChange }: Props) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <Switch aria-label="Hide the original" checked={checked} onCheckedChange={onChange} />
        Hide the original
      </label>
      <p className="text-xs text-muted-foreground">Visitors see example 1 as the original; the original clip is never shown.</p>
      {checked && examples === 0 && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400" data-hide-original-warning>
          This draft has no example yet: add one from a test run before publishing, since visitors would have no original to see.
        </p>
      )}
    </div>
  )
}
