"use client"

import { useState, useEffect } from "react"
import { getModelCreditCost } from "@/lib/api"
import { hasCredits } from "@/lib/edition"

// Client-side cache to avoid repeated API calls for the same model
const creditCache = new Map<string, number>()

/**
 * Hook that fetches credit cost for a model from the server.
 * Returns the cached/fetched cost, or a fallback value while loading.
 * Only active in cloud edition.
 */
export function useModelCredits(modelIdentifier: string | undefined, fallback: number = 0): number {
  const [credits, setCredits] = useState<number>(() => {
    if (!modelIdentifier || !hasCredits()) return fallback
    return creditCache.get(modelIdentifier) ?? fallback
  })

  useEffect(() => {
    if (!modelIdentifier || !hasCredits()) {
      setCredits(fallback)
      return
    }

    // Check cache first
    const cached = creditCache.get(modelIdentifier)
    if (cached !== undefined) {
      setCredits(cached)
      return
    }

    // Fetch from server
    getModelCreditCost(modelIdentifier)
      .then(({ data }) => {
        creditCache.set(modelIdentifier, data.creditCost)
        setCredits(data.creditCost)
      })
      .catch(() => {
        setCredits(fallback)
      })
  }, [modelIdentifier, fallback])

  return credits
}

/**
 * Get cached credit cost synchronously (for non-hook contexts like estimation).
 * Returns undefined if not cached yet.
 */
export function getCachedCredits(modelIdentifier: string): number | undefined {
  return creditCache.get(modelIdentifier)
}

/**
 * Pre-fetch credits for multiple models (call on app init or when models list loads).
 */
export async function prefetchModelCredits(models: string[]): Promise<void> {
  if (!hasCredits()) return
  const uncached = models.filter(m => !creditCache.has(m))
  await Promise.allSettled(
    uncached.map(async (model) => {
      try {
        const { data } = await getModelCreditCost(model)
        creditCache.set(model, data.creditCost)
      } catch { /* ignore */ }
    })
  )
}
