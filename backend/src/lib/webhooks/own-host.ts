/**
 * This install's own public hosts — `PUBLIC_URL` and `MCP_PUBLIC_URL`, when
 * set — are never a webhook receiver: the server would POST to itself through
 * its own edge, and an event aimed at its own workflow trigger
 * (`POST /v1/webhooks/:token`) starts a run whose jobs send more events.
 * Matched on the host name (any port, any path); a host the operator has not
 * configured is not known here, so nothing else is refused.
 *
 * DELIBERATELY reads process.env, not ../config.js — the same reasons
 * own-storage-url.ts gives: the values carry no transform, and this check sits
 * in a request schema crossed by route tests that partially mock config.
 */
function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "")
}

export function isThisInstallAddress(url: URL): boolean {
  const host = bareHost(url.hostname)
  for (const configured of [process.env.PUBLIC_URL, process.env.MCP_PUBLIC_URL]) {
    if (!configured) continue
    try {
      if (bareHost(new URL(configured).hostname) === host) return true
    } catch {
      // A malformed setting names no host.
    }
  }
  return false
}
