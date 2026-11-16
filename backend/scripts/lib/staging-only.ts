/**
 * The one check a staging-only script makes before it loads anything: it runs
 * only where the operator has named this deployment's host, and never on a
 * production host or a local address, whatever is set.
 */

/** The variable that confirms the run: it must name the host of this deployment's PUBLIC_URL. */
export const STAGING_CONFIRM_VARIABLE = "MCP_COMPARE_STAGING_HOST"

/** Hosts a staging-only script refuses outright. */
export const PRODUCTION_HOSTS: ReadonlySet<string> = new Set(["nodaro.ai", "app.nodaro.ai", "flow.nodaro.ai", "mcp.nodaro.ai"])

function hostOf(url: string | undefined): string | null {
  try {
    const parsed = new URL(url ?? "")
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.hostname.toLowerCase() : null
  } catch {
    return null
  }
}

/** A loopback or unqualified name: a developer's machine, not a deployment. */
function isLocalHost(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host) || !host.includes(".")
}

/** Why the script must not run here, or null when it may. */
export function stagingOnlyRefusal(env: Readonly<Record<string, string | undefined>>): string | null {
  const host = hostOf(env.PUBLIC_URL)
  if (host === null) return "PUBLIC_URL is not an http(s) URL, so this is no deployment this script can name"
  if (PRODUCTION_HOSTS.has(host)) return `PUBLIC_URL is ${host}, a production host: this script runs on staging only`
  // A machine of one's own names no deployment: its database and plugins are
  // whatever its .env points at, which the host cannot vouch for.
  if (isLocalHost(host)) return `PUBLIC_URL is ${host}, a local address: this script runs on the staging deployment itself`
  const confirmed = (env[STAGING_CONFIRM_VARIABLE] ?? "").trim().toLowerCase()
  if (confirmed === "") return `set ${STAGING_CONFIRM_VARIABLE}=${host} to confirm that this deployment is the staging one`
  if (confirmed !== host) return `${STAGING_CONFIRM_VARIABLE} is ${confirmed}, but this deployment's PUBLIC_URL host is ${host}`
  return null
}
