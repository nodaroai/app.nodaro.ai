/**
 * The Anthropic SDK pointed at KIE's Anthropic-compatible endpoint
 * (`<KIE_API_BASE_URL>/anthropic`), for Copilot turns that run on KIE. KIE
 * takes its own key as `x-api-key: Bearer <key>`. No auth token is sent, even
 * if `ANTHROPIC_AUTH_TOKEN` is set in the environment. The SDK's own retries
 * are off: the loop's K13 ladder is the one retry policy.
 *
 * Memoised per key and base URL: provider keys are live (lib/config.ts), so a
 * key changed on /setup builds a new client instead of freezing the first.
 */
import Anthropic from "@anthropic-ai/sdk"
import { config } from "../../lib/config.js"

const KIE_ANTHROPIC_TIMEOUT_MS = 600_000

let memo: { key: string; baseURL: string; client: Anthropic } | null = null

export function getCopilotKieClient(): Anthropic {
  const key = (config.KIE_API_KEY ?? "").trim()
  const baseURL = `${config.KIE_API_BASE_URL}/anthropic`
  if (!memo || memo.key !== key || memo.baseURL !== baseURL) {
    const client = new Anthropic({
      baseURL,
      apiKey: `Bearer ${key}`,
      authToken: null,
      maxRetries: 0,
      timeout: KIE_ANTHROPIC_TIMEOUT_MS,
    })
    memo = { key, baseURL, client }
  }
  return memo.client
}
