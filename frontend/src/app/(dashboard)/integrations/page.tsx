"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2 } from "lucide-react"
import { PlatformCard } from "@/components/integrations/platform-card"
import { getSocialConnections } from "@/lib/api"
import type { SocialPlatformType, SocialConnection } from "@/types/nodes"

const PLATFORMS: SocialPlatformType[] = ["instagram", "tiktok", "youtube", "linkedin", "x", "facebook"]

export default function IntegrationsPage() {
  const [connections, setConnections] = useState<SocialConnection[]>([])
  const [loading, setLoading] = useState(true)

  const loadConnections = useCallback(async () => {
    try {
      const data = await getSocialConnections()
      setConnections(data.connections)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Integrations</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Connect your social media accounts to publish directly from workflows.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PLATFORMS.map((platform) => (
            <PlatformCard
              key={platform}
              platform={platform}
              connection={connections.find((c) => c.platform === platform) ?? null}
              onConnectionChange={loadConnections}
            />
          ))}
        </div>
      )}
    </div>
  )
}
