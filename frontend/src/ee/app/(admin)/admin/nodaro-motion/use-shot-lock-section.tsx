// Admin → Video Remake's shot lock, as the page holds it: the live setting,
// its draft (use-section-draft.ts, bound for the stored sets), whether the
// draft differs from what is stored, its save, and its block on the page
// (ShotLockSection.tsx). Kept here so the page only wires it to its one Save,
// and hands what the draft changes to the engine prompt's previews.

import { useEffect, useState, type ReactNode } from "react"
import { useNodaroMotionShotLock, useSaveNodaroMotionShotLock } from "@/ee/hooks/queries/use-nodaro-motion-shot-lock"
import type { NodaroMotionShotLock, NodaroMotionShotLockView } from "@/lib/api"
import { SHOT_LOCK_HEADING, ShotLockSection, shotLockToSaved } from "./components/ShotLockSection"
import { SHOT_LOCK_SPEC, type MotionSettingsBinding } from "./settings-sections"
import { useSectionDraft } from "./use-section-draft"

export interface ShotLockSectionState {
  readonly binding: MotionSettingsBinding
  /**
   * What the draft changes over what is stored, per engine ("on" or "off"); an engine left as stored is left out, so a
   * preview of it follows the stored setting. Empty until the setting has loaded.
   */
  readonly unsaved: NodaroMotionShotLock
  /** Whether the draft differs from what is stored (never before the setting has loaded). */
  readonly changed: boolean
  readonly pending: boolean
  /** Saves the draft as it is saved (its refusal is also said under the switches). */
  readonly save: () => Promise<NodaroMotionShotLockView>
  /** The block shown on the page. */
  readonly node: ReactNode
}

/** Each engine whose value in `next` differs from `stored`, with its value in `next` (both as saved: only the engines that are on). */
export function shotLockChanges(next: NodaroMotionShotLock, stored: NodaroMotionShotLock): NodaroMotionShotLock {
  const out: NodaroMotionShotLock = {}
  for (const engine of new Set([...Object.keys(next), ...Object.keys(stored)]) as Set<keyof NodaroMotionShotLock>) {
    const value = next[engine] === "on" ? "on" : "off"
    if (value !== (stored[engine] === "on" ? "on" : "off")) out[engine] = value
  }
  return out
}

export function useShotLockSection(held: boolean): ShotLockSectionState {
  const query = useNodaroMotionShotLock()
  const saveMutation = useSaveNodaroMotionShotLock()
  const section = useSectionDraft(SHOT_LOCK_SPEC, query.data, (v) => v.shotLock, saveMutation.mutateAsync, held)
  const next = shotLockToSaved(section.draft)
  // The draft follows the stored setting one commit after it loads: until then it says nothing of what changed. (This
  // effect runs after the draft's own, in the same commit, so the two land in one render.)
  const [drafted, setDrafted] = useState(false)
  useEffect(() => {
    if (query.data) setDrafted(true)
  }, [query.data])
  // Never saved reads as off everywhere: leaving every engine off then is no change.
  const changed = !!query.data && JSON.stringify(next) !== JSON.stringify(shotLockToSaved(query.data.shotLock))

  const node = (
    <div role="group" aria-label={SHOT_LOCK_HEADING} className="mb-6 rounded-lg border p-4">
      <h2 className="mb-3 text-base font-semibold">{SHOT_LOCK_HEADING}</h2>
      {query.data ? (
        <ShotLockSection
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

  return {
    binding: section.binding,
    unsaved: query.data && drafted ? shotLockChanges(next, shotLockToSaved(query.data.shotLock)) : {},
    changed,
    pending: saveMutation.isPending,
    save: () => saveMutation.mutateAsync(next),
    node,
  }
}
