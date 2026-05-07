import { useModelCreditCost } from "./queries/use-credits-queries"

export { getCachedCredits, prefetchModelCredits } from "./queries/use-credits-queries"
export { useModelCreditCost } from "./queries/use-credits-queries"

/**
 * Backward-compatible wrapper: returns a plain number (matching old signature).
 * Prefer `useModelCreditCost(model)` in new code for full React Query state.
 */
export function useModelCredits(modelIdentifier: string | undefined, fallback: number = 0): number {
  const { data } = useModelCreditCost(modelIdentifier)
  return data ?? fallback
}
