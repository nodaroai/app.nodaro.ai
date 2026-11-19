// Admin → Video Remake's custom style, as the page holds it: its live
// setting, its draft (use-section-draft.ts, bound for the stored sets),
// whether the draft differs from what is stored, its save, and its block on
// the page (CustomStyleSection.tsx). Kept here so the page only wires it to
// its one Save.

import type { ReactNode } from "react"
import { useNodaroMotionCustomStyle, useSaveNodaroMotionCustomStyle } from "@/ee/hooks/queries/use-nodaro-motion-custom-style"
import type { NodaroMotionCustomStyleView } from "@/lib/api"
import { CUSTOM_STYLE_HEADING, CustomStyleSection, customStyleToSaved } from "./components/CustomStyleSection"
import { CUSTOM_STYLE_SPEC, type MotionSettingsBinding } from "./settings-sections"
import { useSectionDraft } from "./use-section-draft"

export interface CustomStyleSectionState {
  readonly binding: MotionSettingsBinding
  /** Whether the draft differs from what is stored (never before the setting has loaded). */
  readonly changed: boolean
  readonly pending: boolean
  /** Saves the draft as it is saved (its refusal is also said at its fields). */
  readonly save: () => Promise<NodaroMotionCustomStyleView>
  /** The block shown on the page. */
  readonly node: ReactNode
}

export function useCustomStyleSection(held: boolean): CustomStyleSectionState {
  const query = useNodaroMotionCustomStyle()
  const saveMutation = useSaveNodaroMotionCustomStyle()
  const section = useSectionDraft(CUSTOM_STYLE_SPEC, query.data, (v) => v.customStyle, saveMutation.mutateAsync, held)
  const next = customStyleToSaved(section.draft)
  // Never saved reads as the deployment's default and the engine's steps: a draft that sets nothing then is no change.
  const changed = !!query.data && JSON.stringify(next) !== JSON.stringify(customStyleToSaved(query.data.customStyle))

  const node = (
    <div role="group" aria-label={CUSTOM_STYLE_HEADING} className="mb-6 rounded-lg border p-4">
      <h2 className="mb-3 text-base font-semibold">{CUSTOM_STYLE_HEADING}</h2>
      {query.data ? (
        <CustomStyleSection
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
