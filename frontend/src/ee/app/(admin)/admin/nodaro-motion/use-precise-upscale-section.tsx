// Admin → Video Remake's Precise upscale, as the page holds it: the live
// setting, its draft (use-section-draft.ts, bound for the stored sets),
// whether the draft differs from what is in effect, its save, and its block
// under the Prism engine (PreciseUpscaleSection.tsx). Kept here so the page
// only wires it to its one Save.

import { useId, type ReactNode } from "react"
import { useNodaroMotionPreciseUpscale, useSaveNodaroMotionPreciseUpscale } from "@/ee/hooks/queries/use-nodaro-motion-precise-upscale"
import type { NodaroMotionPreciseUpscaleView } from "@/lib/api"
import { PreciseUpscaleSection, preciseUpscaleEffective, preciseUpscaleHeading } from "./components/PreciseUpscaleSection"
import { PRECISE_UPSCALE_SPEC, type MotionSettingsBinding } from "./settings-sections"
import { useSectionDraft } from "./use-section-draft"

export interface PreciseUpscaleSectionState {
  readonly binding: MotionSettingsBinding
  /** Whether the draft differs from what is in effect (never before the setting has loaded). */
  readonly changed: boolean
  readonly pending: boolean
  /** Saves the draft, whole. */
  readonly save: () => Promise<NodaroMotionPreciseUpscaleView>
  /** The block shown under the Prism engine. */
  readonly node: ReactNode
}

export function usePreciseUpscaleSection(held: boolean): PreciseUpscaleSectionState {
  const query = useNodaroMotionPreciseUpscale()
  const saveMutation = useSaveNodaroMotionPreciseUpscale()
  const section = useSectionDraft(PRECISE_UPSCALE_SPEC, query.data, (v) => v.stored, saveMutation.mutateAsync, held)
  const headingId = useId()
  // Never saved reads as the defaults: a draft that keeps them then is no change.
  const changed = !!query.data && JSON.stringify(section.draft) !== JSON.stringify(preciseUpscaleEffective(query.data.stored))
  // While the engine takes the upscale choice, each row turns it on or off at its size: the heading says so.
  const upscaleChoice = query.data?.upscaleChoice === true
  const heading = preciseUpscaleHeading(upscaleChoice)

  const node = (
    <div role="group" aria-label={heading} className="mt-4 max-w-md">
      <h3 id={headingId} className="mb-2 text-sm font-semibold">
        {heading}
      </h3>
      {query.data ? (
        <PreciseUpscaleSection
          value={section.draft}
          defaults={query.data.defaults}
          supported={query.data.supported}
          topazDisabled={query.data.topazDisabled === true}
          upscaleChoice={upscaleChoice}
          saveError={saveMutation.error}
          headingId={headingId}
          onChange={(draft) => {
            saveMutation.reset()
            section.setDraft(draft)
          }}
        />
      ) : query.error ? (
        <p className="text-xs text-destructive">{query.error.message}</p>
      ) : (
        <p className="text-xs text-muted-foreground">Loading…</p>
      )}
    </div>
  )

  return { binding: section.binding, changed, pending: saveMutation.isPending, save: () => saveMutation.mutateAsync(section.draft), node }
}
