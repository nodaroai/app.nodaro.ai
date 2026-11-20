// Admin → Video Remake's shot-list frame rate, as the page holds it: the live
// setting, its draft (use-section-draft.ts, bound for the stored sets),
// whether the draft differs from what is stored, its save, and its block on
// the page (ShotListFpsSection.tsx). Kept here so the page only wires it to
// its one Save.

import { useId, type ReactNode } from "react"
import { useNodaroMotionShotListFps, useSaveNodaroMotionShotListFps } from "@/ee/hooks/queries/use-nodaro-motion-shot-list-fps"
import type { NodaroMotionShotListFpsView } from "@/lib/api"
import { SHOT_LIST_FPS_HEADING, ShotListFpsSection, shotListFpsToSaved } from "./components/ShotListFpsSection"
import { SHOT_LIST_FPS_SPEC, type MotionSettingsBinding } from "./settings-sections"
import { useSectionDraft } from "./use-section-draft"

export interface ShotListFpsSectionState {
  readonly binding: MotionSettingsBinding
  /** Whether the draft differs from what is stored (never before the setting has loaded). */
  readonly changed: boolean
  readonly pending: boolean
  /** Saves the draft as it is saved (its refusal is also said under the select). */
  readonly save: () => Promise<NodaroMotionShotListFpsView>
  /** The block shown on the page. */
  readonly node: ReactNode
}

export function useShotListFpsSection(held: boolean): ShotListFpsSectionState {
  const query = useNodaroMotionShotListFps()
  const saveMutation = useSaveNodaroMotionShotListFps()
  const section = useSectionDraft(SHOT_LIST_FPS_SPEC, query.data, (v) => v.shotListFps, saveMutation.mutateAsync, held)
  const next = shotListFpsToSaved(section.draft)
  const headingId = useId()
  // Never saved reads as the engine's default: a draft that sets nothing then is no change.
  const changed = !!query.data && JSON.stringify(next) !== JSON.stringify(shotListFpsToSaved(query.data.shotListFps))

  const node = (
    <div role="group" aria-label={SHOT_LIST_FPS_HEADING} className="mb-6 rounded-lg border p-4">
      <h2 id={headingId} className="mb-3 text-base font-semibold">
        {SHOT_LIST_FPS_HEADING}
      </h2>
      {query.data ? (
        <ShotListFpsSection
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
