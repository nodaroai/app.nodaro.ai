import { useMemo } from "react"
import type { SocialProviderInfo } from "@/lib/api"
import type { SocialConnection } from "@/types/nodes"
import { useT, type TFunction } from "@/lib/i18n"
import { describeProvider } from "./platform-meta"

/**
 * The Integrations grid's search / tab / counter logic, kept out of the page
 * component so it can be tested without rendering twenty cards.
 *
 * Two rules here are load-bearing and easy to lose in a restyle:
 *
 * 1. The "coming soon" set is DERIVED (`!available`), never a written list.
 *    The handoff ships a hardcoded array of pending networks; adopting it
 *    would break the page's founding invariant that everything comes from
 *    GET /v1/social/providers, and would go stale the first time a network
 *    is configured on a deployment.
 *
 * 2. `category` comes from the server, so the tabs need no name list here.
 *    Adding a network to the backend puts it under the right tab with no
 *    frontend change at all.
 */
export type IntegrationTab = "all" | "connected" | "social" | "publishing"

export const INTEGRATION_TABS: readonly IntegrationTab[] = ["all", "connected", "social", "publishing"]

export interface IntegrationCard {
  readonly provider: SocialProviderInfo
  readonly connections: readonly SocialConnection[]
}

export interface IntegrationFilterResult {
  /** Networks this deployment can connect, matching the tab + search. */
  readonly available: readonly IntegrationCard[]
  /** Networks the deployment cannot connect yet, matching the tab + search. */
  readonly comingSoon: readonly SocialProviderInfo[]
  /** Counts for the header — over ALL networks, never the filtered view. */
  readonly connectedCount: number
  readonly availableCount: number
  /** True when a search or tab is on and nothing at all matched. */
  readonly isEmpty: boolean
}

function matchesQuery(provider: SocialProviderInfo, query: string, t: TFunction): boolean {
  if (query === "") return true
  return `${provider.label} ${describeProvider(provider, t)}`.toLowerCase().includes(query)
}

function matchesTab(
  provider: SocialProviderInfo,
  tab: IntegrationTab,
  connectionCount: number,
): boolean {
  switch (tab) {
    case "connected":
      return connectionCount > 0
    case "social":
    case "publishing":
      return provider.category === tab
    case "all":
      return true
  }
}

export function useIntegrationFilter(
  providers: readonly SocialProviderInfo[],
  connections: readonly SocialConnection[],
  tab: IntegrationTab,
  query: string,
): IntegrationFilterResult {
  const t = useT()
  return useMemo(() => {
    const needle = query.trim().toLowerCase()

    const connectionsFor = (id: string) => connections.filter((c) => c.platform === id)

    const available: IntegrationCard[] = []
    const comingSoon: SocialProviderInfo[] = []
    let connectedCount = 0
    let availableCount = 0

    for (const provider of providers) {
      const own = connectionsFor(provider.id)

      // Header counts describe the deployment, not the current filter — a
      // counter that moved with the search would be answering a different
      // question than the one it is placed next to.
      if (!provider.available) {
        // nothing to count: an unconfigured network is neither.
      } else if (own.length > 0) {
        connectedCount += 1
      } else {
        availableCount += 1
      }

      if (!matchesQuery(provider, needle, t)) continue
      if (!matchesTab(provider, tab, own.length)) continue

      if (provider.available) {
        available.push({ provider, connections: own })
      } else if (tab !== "connected") {
        // An unconnectable network can never satisfy "Connected".
        comingSoon.push(provider)
      }
    }

    // Connected first, registry order preserved within each group.
    const sorted = [
      ...available.filter((c) => c.connections.length > 0),
      ...available.filter((c) => c.connections.length === 0),
    ]

    return {
      available: sorted,
      comingSoon,
      connectedCount,
      availableCount,
      isEmpty: sorted.length === 0 && comingSoon.length === 0,
    }
  }, [providers, connections, tab, query, t])
}
