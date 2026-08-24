"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2 } from "lucide-react"
import { PlatformCard } from "@/components/integrations/platform-card"
import { NodaroCloudCard } from "@/components/integrations/nodaro-cloud-card"
import { ModelProvidersCard } from "@/components/integrations/model-providers-card"
import { HeygenCatalogCard } from "@/components/integrations/heygen-catalog-card"
import { useT } from "@/lib/i18n"
import { getSocialConnections, getSocialProviders, type SocialProviderInfo } from "@/lib/api"
import { isCloud } from "@/lib/edition"
import type { SocialConnection } from "@/types/nodes"

/**
 * The grid derives ENTIRELY from GET /v1/social/providers — a network added
 * to the backend registry appears here with zero frontend changes.
 * Unconfigured networks render disabled with their setup requirements
 * (show-don't-hide, so self-hosters discover what's possible).
 */
export default function IntegrationsPage() {
  const t = useT()
  const [providers, setProviders] = useState<SocialProviderInfo[]>([])
  const [connections, setConnections] = useState<SocialConnection[]>([])
  const [loading, setLoading] = useState(true)

  const loadConnections = useCallback(async () => {
    try {
      const data = await getSocialConnections()
      setConnections(data.connections)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    Promise.allSettled([
      getSocialProviders().then((data) => setProviders(data.providers)),
      loadConnections(),
    ]).finally(() => setLoading(false))
  }, [loadConnections])

  // Available networks first (registry order within each group).
  const sorted = [...providers.filter((p) => p.available), ...providers.filter((p) => !p.available)]

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("nav.integrations")}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {isCloud() ? t("integ.subtitle") : t("integ.subtitleSelfHosted")}
        </p>
      </div>

      {/* Nodaro Cloud connect + the operator's own provider keys (self-hosted
          editions; both render null on cloud). Deliberately OUTSIDE the
          social-providers loading gate — each runs its own status fetch. */}
      <NodaroCloudCard />
      <ModelProvidersCard />
      {/* The operator's manual HeyGen catalog refresh — every edition; the
          card hides itself from people the server would refuse. */}
      <HeygenCatalogCard />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((provider) => (
            <PlatformCard
              key={provider.id}
              provider={provider}
              connections={connections.filter((c) => c.platform === provider.id)}
              onConnectionChange={loadConnections}
            />
          ))}
        </div>
      )}
    </div>
  )
}
