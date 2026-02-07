/**
 * Replicate API Client - Shared client and helpers
 *
 * Provides a singleton Replicate client and common utilities
 * used by all Replicate provider modules (image, video).
 */

import Replicate from "replicate"
import { config } from "../../lib/config.js"

// Singleton Replicate client
export const replicate = new Replicate({
  auth: config.REPLICATE_API_TOKEN,
})

/**
 * Helper to extract a URL from Replicate's various output formats.
 * Replicate outputs can be strings, FileOutput objects, or other shapes.
 */
export function extractUrl(item: unknown): string {
  if (typeof item === "string") {
    return item
  }
  if (item && typeof item === "object") {
    // Replicate FileOutput: has .url property or toString() returns URL
    const obj = item as Record<string, unknown>
    if (typeof obj.url === "function") {
      return (obj.url as () => string)()
    }
    if (typeof obj.url === "string") {
      return obj.url
    }
    if (typeof obj.href === "string") {
      return obj.href
    }
    // FileOutput extends ReadableStream and has toString
    const str = String(item)
    if (str.startsWith("http")) {
      return str
    }
    // Try JSON stringification as last resort
    console.warn(
      `[Replicate] Unexpected object shape:`,
      JSON.stringify(item).slice(0, 500)
    )
    throw new Error(
      `Unexpected Replicate output object: ${JSON.stringify(item).slice(0, 200)}`
    )
  }
  throw new Error(
    `Unexpected Replicate output type: ${typeof item}`
  )
}

/**
 * Extract approximate cost from Replicate prediction metrics.
 * Uses predict_time * rate per second as an estimate.
 */
export function extractCost(
  metrics: Record<string, unknown> | undefined
): number | null {
  const predictTime = (metrics as { predict_time?: number })
    ?.predict_time
  if (predictTime && predictTime > 0) {
    return predictTime * 0.000225 // Approximate cost per second
  }
  return null
}
