// Admin → Video Remake's Offer Flash, as the page holds it: the live setting,
// its draft (use-section-draft.ts, bound for the stored sets), whether the
// draft differs from what is stored, its save, and its block on the page
// (FlashOfferSection.tsx). Kept here so the page only wires it to its one Save.

import { useId, type ReactNode } from "react"
import { useNodaroMotionFlashOffer, useSaveNodaroMotionFlashOffer } from "@/ee/hooks/queries/use-nodaro-motion-flash-offer"
import type { NodaroMotionFlashOfferView } from "@/lib/api"
import { FLASH_OFFER_HEADING, FlashOfferSection, flashOfferToSaved } from "./components/FlashOfferSection"
import { FLASH_OFFER_SPEC, type MotionSettingsBinding } from "./settings-sections"
import { useSectionDraft } from "./use-section-draft"

export interface FlashOfferSectionState {
  readonly binding: MotionSettingsBinding
  /** Whether the draft differs from what is stored (never before the setting has loaded). */
  readonly changed: boolean
  readonly pending: boolean
  /** Saves the draft as it is saved (its refusal is also said under the switches). */
  readonly save: () => Promise<NodaroMotionFlashOfferView>
  /** The block shown on the page. */
  readonly node: ReactNode
}

export function useFlashOfferSection(held: boolean): FlashOfferSectionState {
  const query = useNodaroMotionFlashOffer()
  const saveMutation = useSaveNodaroMotionFlashOffer()
  const section = useSectionDraft(FLASH_OFFER_SPEC, query.data, (v) => v.flashOffer, saveMutation.mutateAsync, held)
  const next = flashOfferToSaved(section.draft)
  const headingId = useId()
  const changed = !!query.data && JSON.stringify(next) !== JSON.stringify(flashOfferToSaved(query.data.flashOffer))

  const node = (
    <div role="group" aria-label={FLASH_OFFER_HEADING} className="mb-6 rounded-lg border p-4" data-testid="flash-offer">
      <h2 id={headingId} className="mb-3 text-base font-semibold">
        {FLASH_OFFER_HEADING}
      </h2>
      {query.data ? (
        <FlashOfferSection
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
