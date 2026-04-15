import { ApifyClient } from "apify-client"
import { config } from "../../lib/config.js"

/**
 * Do not construct directly — always throw via sanitizeApifyError()
 * so raw SDK errors get logged and mapped to user-facing messages in one place.
 */
export class ApifyError extends Error {
  public readonly internalDetails: string
  public readonly context: string

  constructor(message: string, internalDetails: string, context: string) {
    super(message)
    this.name = "ApifyError"
    this.internalDetails = internalDetails
    this.context = context
  }

  getFullMessage(): string {
    return `[${this.context}] ${this.message} | Internal: ${this.internalDetails}`
  }
}

export function sanitizeApifyError(err: unknown, context: string): ApifyError {
  const raw = err instanceof Error ? err.message : String(err)
  console.error(`[Apify INTERNAL ERROR] ${context}: ${raw}`)

  const lower = raw.toLowerCase()
  let sanitized: string
  // Order matters: more specific patterns first. E.g. "403 timeout" routes to
  // the timeout branch (the actual failure mode) rather than auth.
  if (lower.includes("rate limit") || lower.includes("429")) {
    sanitized = "Too many requests — please try again in a minute."
  } else if (lower.includes("timeout")) {
    sanitized = "Scrape took too long and was cancelled. Try a smaller target."
  } else if (lower.includes("not found") || lower.includes("404")) {
    sanitized = "The requested URL could not be found or is private."
  } else if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("403")) {
    sanitized = "Access denied by the target site."
  } else if (lower.includes("memory") || lower.includes("blocked") || lower.includes("captcha")) {
    sanitized = "The target site blocked the scrape. Try a different URL or smaller scope."
  } else if (lower.includes("usage limit") || lower.includes("quota")) {
    // Distinct wording so support can grep for "temporarily unavailable" and
    // immediately know it's a Nodaro-side Apify quota, not a user error.
    sanitized = "Scraping is temporarily unavailable. Please contact support."
  } else {
    sanitized = "Scrape failed. Please check the URL and try again."
  }
  return new ApifyError(sanitized, raw, context)
}

let client: ApifyClient | null = null

export function getApifyClient(): ApifyClient {
  if (client) return client
  if (!config.APIFY_API_TOKEN) {
    throw new Error("APIFY_API_TOKEN is not configured")
  }
  client = new ApifyClient({ token: config.APIFY_API_TOKEN })
  return client
}

export function resetApifyClientForTests(): void {
  client = null
}
