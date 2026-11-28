/**
 * The edits of Admin → Video route, and what they were made on.
 *
 * A save is refused by the server when the setting changed since the page it
 * was edited on (`expectedUpdatedAt`). That only protects anything if the page
 * sends the timestamp its DRAFT was started from, not the newest one it holds:
 * every other action on the page (a hold decided, the factors saved) answers
 * with a fresh view, and a draft that kept being edited over it would then
 * overwrite someone else's save unseen. So the base is captured when the draft
 * is created or reset, and stays until the draft is saved or reloaded.
 */
import { useCallback, useEffect, useState } from "react"
import { withLegacyRouting, type VideoRoutePolicy, type VideoRouteView } from "@/ee/lib/video-route-api"

type FactorInputs = Record<string, string>

const factorInputsOf = (view: VideoRouteView): FactorInputs => Object.fromEntries(Object.entries(view.factors).map(([k, f]) => [k, String(f.factor)]))
// Nothing saved yet: the form starts from what runs on the alternate route today (as the route
// reports it), so a first save keeps that traffic where it is unless it is changed here.
const policyDraftOf = (view: VideoRouteView): VideoRoutePolicy => (view.updatedAt === null ? withLegacyRouting(view.policy, view.legacyRouting) : view.policy)

/** What differs between the policy a draft was started from and the one saved now, in plain words. */
export function policyChanges(base: VideoRoutePolicy, current: VideoRoutePolicy): string[] {
  const out: string[] = []
  const models = new Set([...Object.keys(base.models ?? {}), ...Object.keys(current.models ?? {})])
  for (const model of [...models].sort()) {
    if (JSON.stringify(base.models?.[model] ?? null) !== JSON.stringify(current.models?.[model] ?? null)) out.push(`the routing of ${model}`)
  }
  const rest = (p: VideoRoutePolicy) => JSON.stringify({ ...p, models: undefined })
  if (rest(base) !== rest(current)) out.push("the alert and billing settings")
  return out
}

export function useVideoRouteDraft(data: VideoRouteView | undefined) {
  const [draft, setDraftState] = useState<VideoRoutePolicy | null>(null)
  // Unsaved edits: while there are any, a newer view never replaces what is being edited.
  const [dirty, setDirty] = useState(false)
  const [base, setBase] = useState<{ updatedAt: string | null; policy: VideoRoutePolicy } | null>(null)
  const [factors, setFactorsState] = useState<FactorInputs>({})
  const [factorsDirty, setFactorsDirty] = useState(false)
  const [factorsBase, setFactorsBase] = useState<string | null>(null)

  useEffect(() => {
    if (!data || dirty) return
    setDraftState(policyDraftOf(data))
    setBase({ updatedAt: data.updatedAt, policy: data.policy })
  }, [data, dirty])
  useEffect(() => {
    if (!data || factorsDirty) return
    setFactorsState(factorInputsOf(data))
    setFactorsBase(data.factorsUpdatedAt)
  }, [data, factorsDirty])

  const setDraft = useCallback((next: VideoRoutePolicy) => {
    setDirty(true)
    setDraftState(next)
  }, [])
  const setFactors = useCallback((next: FactorInputs) => {
    setFactorsDirty(true)
    setFactorsState(next)
  }, [])

  return {
    draft,
    setDraft,
    dirty,
    /** The `updatedAt` of the setting this draft was started from: what a save states. */
    baseUpdatedAt: base?.updatedAt ?? null,
    /** The setting was saved by someone else since this draft was started: what changed. Empty when it was not. */
    staleChanges: data && base && dirty && data.updatedAt !== base.updatedAt ? (() => {
      const changes = policyChanges(base.policy, data.policy)
      return changes.length > 0 ? changes : ["the saved setting"]
    })() : [],
    /** After a save that went through, or to drop the edits: the draft follows the newest view again. */
    reset: useCallback(() => setDirty(false), []),
    factors,
    setFactors,
    factorsBaseUpdatedAt: factorsBase,
    factorsStale: Boolean(data && factorsDirty && data.factorsUpdatedAt !== factorsBase),
    resetFactors: useCallback(() => setFactorsDirty(false), []),
  }
}
