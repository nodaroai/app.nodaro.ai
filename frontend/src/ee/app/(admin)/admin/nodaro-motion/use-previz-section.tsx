// Admin → Video Remake's 3D previz clips, as the page holds them: the live
// setting, its draft (use-section-draft.ts, bound for the stored sets),
// whether the draft differs from what is stored, its save, and its block on
// the page (PrevizSection.tsx). Kept here so the page only wires it to its
// one Save.

import { useId, type ReactNode } from "react"
import { useNodaroMotionPreviz, useSaveNodaroMotionPreviz } from "@/ee/hooks/queries/use-nodaro-motion-previz"
import type { NodaroMotionPrevizView } from "@/lib/api"
import { PREVIZ_HEADING, PrevizSection, previzToSaved } from "./components/PrevizSection"
import { PREVIZ_SPEC, type MotionSettingsBinding } from "./settings-sections"
import { useSectionDraft } from "./use-section-draft"

export interface PrevizSectionState {
  readonly binding: MotionSettingsBinding
  /** Whether the draft differs from what is stored (never before the setting has loaded). */
  readonly changed: boolean
  readonly pending: boolean
  /** Saves the draft as it is saved (its refusal is also said under the switch). */
  readonly save: () => Promise<NodaroMotionPrevizView>
  /** The block shown on the page. */
  readonly node: ReactNode
}

export function usePrevizSection(held: boolean): PrevizSectionState {
  const query = useNodaroMotionPreviz()
  const saveMutation = useSaveNodaroMotionPreviz()
  const section = useSectionDraft(PREVIZ_SPEC, query.data, (v) => v.previz, saveMutation.mutateAsync, held)
  const next = previzToSaved(section.draft)
  const headingId = useId()
  // Never saved reads as the deployment's default: a draft that sets nothing then is no change.
  const changed = !!query.data && JSON.stringify(next) !== JSON.stringify(previzToSaved(query.data.previz))

  const node = (
    <div role="group" aria-label={PREVIZ_HEADING} className="mb-6 rounded-lg border p-4">
      <h2 id={headingId} className="mb-3 text-base font-semibold">
        {PREVIZ_HEADING}
      </h2>
      {query.data ? (
        <PrevizSection
          view={query.data}
          value={section.draft}
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

  return { binding: section.binding, changed, pending: saveMutation.isPending, save: () => saveMutation.mutateAsync(next), node }
}
