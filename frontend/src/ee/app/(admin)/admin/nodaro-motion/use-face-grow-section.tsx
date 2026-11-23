// Admin → Video Remake's face grow, as the page holds it: the live setting (its own row, apart from the Precise
// masking), its draft (use-section-draft.ts, bound for the stored sets), whether the draft differs from what is stored,
// and its save. The field itself is drawn in each engine's Precise column (FaceGrowField), beside its masking.

import type { ReactNode } from "react"
import { useNodaroMotionFaceGrow, useSaveNodaroMotionFaceGrow } from "@/ee/hooks/queries/use-nodaro-motion-face-grow"
import type { AdminTrendFaceMasking, NodaroMotionEngine, NodaroMotionFaceGrow, NodaroMotionFaceGrowView, TrendEngineEnvironment } from "@/lib/api"
import { FaceGrowField } from "../trends/components/FaceGrowField"
import { faceGrowApplies, faceGrowMissing } from "../trends/clip-preparation"
import { FACE_GROW_SPEC, faceGrowToSaved, type MotionSettingsBinding } from "./settings-sections"
import { useSectionDraft } from "./use-section-draft"

export interface FaceGrowSectionState {
  readonly binding: MotionSettingsBinding
  readonly loaded: boolean
  /** Whether the draft differs from what is stored (never before the setting has loaded). */
  readonly changed: boolean
  readonly pending: boolean
  readonly error: Error | null
  /** One engine's grow in the draft (undefined: none). */
  readonly valueOf: (engine: NodaroMotionEngine) => number | undefined
  /** Sets one engine's grow in the draft (undefined or 0: none). */
  readonly set: (engine: NodaroMotionEngine, v: number | undefined) => void
  readonly save: () => Promise<NodaroMotionFaceGrowView>
  /**
   * The field in one engine's Precise column, beside its masking: shown with target Face and a covering fill
   * (one already set stays shown, to be set back), greyed out while an environment cannot apply it; null otherwise.
   */
  readonly fieldFor: (engine: NodaroMotionEngine, masking: AdminTrendFaceMasking | undefined, envs: readonly TrendEngineEnvironment[] | undefined) => ReactNode
}

export function useFaceGrowSection(held: boolean): FaceGrowSectionState {
  const query = useNodaroMotionFaceGrow()
  const saveMutation = useSaveNodaroMotionFaceGrow()
  const section = useSectionDraft(FACE_GROW_SPEC, query.data, (v) => v.faceGrow, saveMutation.mutateAsync, held)
  const next = faceGrowToSaved(section.draft)
  const set = (engine: NodaroMotionEngine, v: number | undefined) => {
    saveMutation.reset()
    const draft: NodaroMotionFaceGrow = { ...(section.draft ?? {}) }
    if (v === undefined || v === 0) delete draft[engine]
    else draft[engine] = v
    section.setDraft(draft)
  }
  const changed = !!query.data && JSON.stringify(next) !== JSON.stringify(faceGrowToSaved(query.data.faceGrow))
  return {
    binding: section.binding,
    loaded: !!query.data,
    changed,
    pending: saveMutation.isPending,
    error: saveMutation.error,
    valueOf: (engine) => section.draft?.[engine],
    set,
    save: () => saveMutation.mutateAsync(next),
    fieldFor: (engine, masking, envs) => {
      const missing = faceGrowMissing(envs)
      const value = section.draft?.[engine]
      const applies = faceGrowApplies(masking)
      if (!query.data || !missing || !(applies || value !== undefined)) return null
      return (
        <>
          <FaceGrowField value={value} applies={applies} missing={missing} onChange={(v) => set(engine, v)} />
          {saveMutation.error && <p className="text-xs text-destructive">{saveMutation.error.message}</p>}
        </>
      )
    },
  }
}
