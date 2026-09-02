import { useMemo, useSyncExternalStore } from "react"
import { catalogPacksVersion, subscribeCatalogPacks, curateEntries } from "@nodaro/prompts"

export { curateEntries }

/**
 * THE DISPLAY-SIDE HALF OF CATALOG CURATION.
 *
 * Every picker imports its catalog as a bundled constant (`SETTINGS`,
 * `POSES`, …) and groups/filters it in render. A deployment's packs compose a
 * different catalog in the registry, but the registry is not what the
 * pickers read — so a curated deployment showed its users the stock catalogs
 * in every picker while the server enforced the curated ones. The user saw
 * options they could not use, and did not see that the ones they could use
 * had been reworded.
 *
 * `useCuratedEntries(catalogId, base)` is the one-line fix at each picker:
 * the base list, FILTERED to ids the composed catalog offers and OVERLAID
 * with the composed option's label / description / promptHint at the same id.
 * It subscribes to the pack registry, so a registration that lands after the
 * picker mounted (the browser fetches the deployment's catalogs at boot)
 * re-renders the list rather than leaving a stale memo.
 *
 * Deployment with no packs on this catalog: the base array is returned BY
 * IDENTITY — mainline pickers are byte-identical, memo deps included.
 *
 * Not covered: pack-ADDED entries (an `extend` with an id the base does not
 * have) are not surfaced here, because the picker's typed entry shape may
 * carry fields a `PickerOption` cannot supply. The person catalog — the one
 * catalog that extends — already reads through registry-aware getters.
 */

const subscribe = (l: () => void) => subscribeCatalogPacks(l)
const snapshot = () => catalogPacksVersion()

/** Re-render when catalog packs are registered or reset. Returns the version. */
export function useCatalogPacksVersion(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** The hook form: subscribed, memoized on the base and the pack version. */
export function useCuratedEntries<T extends { readonly id: string; readonly label: string }>(
  catalogId: string,
  base: readonly T[],
): readonly T[] {
  const version = useCatalogPacksVersion()
  return useMemo(() => curateEntries(catalogId, base), [catalogId, base, version])
}
