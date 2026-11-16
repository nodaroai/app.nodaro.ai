import type { UserBalance } from "@/lib/api"

/**
 * The free tiers: free, and pay-as-you-go (free with purchased credits). Their
 * subscription credits are the one-time signup grant — nothing resets them.
 */
export function isOneTimeGrantTier(effectiveTier: string | undefined): boolean {
  return effectiveTier === "free" || effectiveTier === "payg"
}

/**
 * The allocation the Subscription bucket measures the balance against ("x of
 * y left", the bar, "resets monthly", "used this cycle"), or 0 when there is
 * none to state.
 *
 * On the free tiers there is none, whatever the balance: their credits are a
 * one-time grant, never a monthly allocation. (The balance's
 * `monthlyAllocation` there is the grant's figure — 300 since migration 652 —
 * which an account granted 1,500 earlier can even hold more than.) A paid
 * plan's figure is its monthly allocation, left as it is.
 */
export function subscriptionAllocation(
  balance: Pick<UserBalance, "monthlyAllocation" | "effectiveTier"> | undefined,
): number {
  if (isOneTimeGrantTier(balance?.effectiveTier)) return 0
  return balance?.monthlyAllocation ?? 0
}
