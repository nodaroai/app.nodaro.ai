import { useCallback, useState } from "react"

/**
 * What is on its way, per brand: a scan or an edit started for it and not yet
 * answered. Counted per call, so a second brand's scan never re-enables the
 * first's (a mutation's own pending state follows only its latest call) and
 * two calls for one brand keep it busy until both are answered.
 */
export function useInFlight() {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(() => new Map())
  const bump = useCallback((id: string, by: 1 | -1) => {
    setCounts((current) => {
      const n = (current.get(id) ?? 0) + by
      const next = new Map(current)
      if (n > 0) next.set(id, n)
      else next.delete(id)
      return next
    })
  }, [])
  /** Runs `work` for the brand, which stays busy until it settles either way. */
  const track = useCallback(
    <T>(id: string, work: () => Promise<T>): Promise<T> => {
      bump(id, 1)
      // A throw before the promise exists still settles it (and the count).
      return new Promise<T>((resolve) => resolve(work())).finally(() => bump(id, -1))
    },
    [bump],
  )
  const isBusy = useCallback((id: string) => counts.has(id), [counts])
  return { track, isBusy }
}
