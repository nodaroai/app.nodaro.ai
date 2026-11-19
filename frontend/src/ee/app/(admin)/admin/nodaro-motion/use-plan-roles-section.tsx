// Admin → Video Remake's roles from the prompt, as the page holds them: the
// live setting, its draft (use-section-draft.ts, bound for the stored sets),
// whether the draft differs from what is stored, its save, and its block on
// the page (PlanRolesSection.tsx). Kept here so the page only wires it to its
// one Save.

import type { ReactNode } from "react"
import { useNodaroMotionPlanRoles, useSaveNodaroMotionPlanRoles } from "@/ee/hooks/queries/use-nodaro-motion-plan-roles"
import type { NodaroMotionPlanRolesView } from "@/lib/api"
import { PLAN_ROLES_HEADING, PlanRolesSection, planRolesToSaved } from "./components/PlanRolesSection"
import { PLAN_ROLES_SPEC, type MotionSettingsBinding } from "./settings-sections"
import { useSectionDraft } from "./use-section-draft"

export interface PlanRolesSectionState {
  readonly binding: MotionSettingsBinding
  /** Whether the draft differs from what is stored (never before the setting has loaded). */
  readonly changed: boolean
  readonly pending: boolean
  /** Saves the draft as it is saved (its refusal is also said at its fields). */
  readonly save: () => Promise<NodaroMotionPlanRolesView>
  /** The block shown on the page. */
  readonly node: ReactNode
}

export function usePlanRolesSection(held: boolean): PlanRolesSectionState {
  const query = useNodaroMotionPlanRoles()
  const saveMutation = useSaveNodaroMotionPlanRoles()
  const section = useSectionDraft(PLAN_ROLES_SPEC, query.data, (v) => v.planRoles, saveMutation.mutateAsync, held)
  const next = planRolesToSaved(section.draft)
  // Never saved reads as the deployment's default and the engine's step: a draft that sets nothing then is no change.
  const changed = !!query.data && JSON.stringify(next) !== JSON.stringify(planRolesToSaved(query.data.planRoles))

  const node = (
    <div role="group" aria-label={PLAN_ROLES_HEADING} className="mb-6 rounded-lg border p-4">
      <h2 className="mb-3 text-base font-semibold">{PLAN_ROLES_HEADING}</h2>
      {query.data ? (
        <PlanRolesSection
          view={query.data}
          value={section.draft}
          saveError={saveMutation.error}
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
