/**
 * Minimal Slack incoming-webhook sender for the internal founder alerts.
 * Mirrors loops-client.ts: no-op when unconfigured, never throws, 10s timeout.
 * The webhook URL is admin-configured (app_settings), passed in by the caller.
 */

const REQUEST_TIMEOUT_MS = 10_000

/** An incoming-webhook URL always has this exact prefix; anything else is a
 *  typo that would fail silently forever, so reject it up front. */
export function isSlackWebhookValid(url: string): boolean {
  return /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(url.trim())
}

export interface SlackResult {
  ok: boolean
  status?: number
  error?: string
}

export interface SlackMessage {
  /** Plain-text fallback + the phone-notification preview (keep it informative). */
  text: string
  /** Optional Block Kit blocks for a richer in-channel render (digest list). */
  blocks?: unknown[]
}

/** Post one message. Resolves `{ ok:false }` (never throws) on any failure so a
 *  Slack outage can never break the path that emitted the alert. */
export async function sendSlack(webhookUrl: string, message: SlackMessage): Promise<SlackResult> {
  if (!isSlackWebhookValid(webhookUrl)) {
    return { ok: false, error: "slack_webhook_not_configured" }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.blocks ? { text: message.text, blocks: message.blocks } : { text: message.text }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200)
      return { ok: false, status: res.status, error: detail || `http_${res.status}` }
    }
    return { ok: true, status: res.status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "slack_request_failed" }
  } finally {
    clearTimeout(timer)
  }
}
