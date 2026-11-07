// One Nodaro Motion setting's draft on the admin page: it starts from the
// live setting and again whenever the live setting changes, except while a
// stored set or an imported file is loaded (`held`), so a refetch never wipes
// a loaded draft. Its binding (settings-sections.ts) is how the stored sets
// read, load and save it.

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import type { MotionSettingsBinding, MotionSettingsSectionSpec } from "./settings-sections"

export function useSectionDraft<V, S, D, B>(
  spec: MotionSettingsSectionSpec<S, D, B>,
  /** The section's live view (its GET), undefined until it loads. */
  view: V | undefined,
  /** The stored value in the view (null: never saved). */
  storedOf: (view: V) => S | null,
  /** The section's save (its mutation's `mutateAsync`). */
  save: (arg: never) => Promise<unknown>,
  held: boolean,
): { draft: D; setDraft: Dispatch<SetStateAction<D>>; binding: MotionSettingsBinding } {
  const [draft, setDraft] = useState<D>(() => spec.draftOf(null))
  const heldRef = useRef(held)
  // A draft released (Discard, or everything saved) follows the live setting again, from what is live now.
  useEffect(() => {
    const released = heldRef.current && !held
    heldRef.current = held
    if (released && view) setDraft(spec.draftOf(storedOf(view)))
  }, [held]) // eslint-disable-line react-hooks/exhaustive-deps

  // The draft starts from what is stored, and again after each save (never over a loaded set).
  useEffect(() => {
    if (view && !heldRef.current) setDraft(spec.draftOf(storedOf(view)))
    // Only a new view resets the draft (the spec and its reader are fixed).
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  const fromBody = (body: unknown) => spec.draftOf(spec.storedOfBody(body as B))
  const binding: MotionSettingsBinding = {
    ready: view !== undefined,
    live: view === undefined ? undefined : spec.bodyOf(spec.draftOf(storedOf(view))),
    draft: spec.bodyOf(draft),
    canon: (body) => spec.bodyOf(fromBody(body)),
    load: (body) => setDraft(fromBody(body)),
    reset: () => {
      if (view !== undefined) setDraft(spec.draftOf(storedOf(view)))
    },
    save: (body) => save(spec.saveArgOf(body as B) as never),
  }
  return { draft, setDraft, binding }
}
