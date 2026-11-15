import { config } from "./config.js"
import { mcpClientListSetIn, parseAssertionExchangeClientIds } from "./mcp-client-ids.js"
import { exchangeProvider, type SsoProviderConfig } from "./sso-providers.js"

/**
 * The settings of the MCP assertion exchange (decided 2026-11-11), read with
 * no database in reach, so the authorization-server metadata
 * (`routes/well-known.ts`) can name the grant where it is on without loading
 * the client funnel. The rule itself — which client may exchange, on every
 * request — is `lib/mcp-assertion-exchange.ts`.
 */

export const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer"

let parsedFrom: string | undefined
let parsedIds: ReadonlySet<string> | null = null

/** The clients named for the exchange (`MCP_ASSERTION_EXCHANGE_CLIENT_IDS`), or null when none is. A value that does not parse names nobody (`config.ts` refuses it at boot). */
export function assertionExchangeClients(): ReadonlySet<string> | null {
  const raw = typeof config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS === "string" ? config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS : ""
  if (raw !== parsedFrom) {
    const parsed = parseAssertionExchangeClientIds(raw)
    parsedIds = parsed.ok ? parsed.ids : new Set<string>()
    parsedFrom = raw
  }
  return parsedIds
}

/**
 * The provider whose assertions the named clients exchange, or null when the
 * exchange is off on this deployment: no MCP client list, no client named, or
 * no provider with an exchange audience. (With no list `clientMayUseMcp` lets
 * every client through, which must never switch the exchange on.) The rule
 * (`mcp-assertion-exchange.ts`) and the metadata read this one answer.
 */
export function namedExchangeProvider(): SsoProviderConfig | null {
  if (assertionExchangeClients() === null || !mcpClientListSetIn(config)) return null
  return exchangeProvider()
}

/** Whether the authorization-server metadata names the jwt-bearer grant. */
export function assertionExchangeAdvertised(): boolean {
  return namedExchangeProvider() !== null
}

/** How long the token an exchange issues lives (`MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS`, validated at boot: 300–86400, default 3600). */
export function assertionExchangeTokenTtlSeconds(): number {
  const v = Number(config.MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS)
  return Number.isInteger(v) && v >= 300 && v <= 86400 ? v : 3600
}

/**
 * The boot check across the two kinds of lever (env and provider list): a
 * deployment that names exchange clients must also configure the provider
 * whose assertions they exchange. Null when usable. A provider with an
 * exchange audience and no client named is a valid "off".
 */
export function assertionExchangeBootProblem(): string | null {
  if (assertionExchangeClients() === null) return null
  if (exchangeProvider() === null) {
    return 'MCP_ASSERTION_EXCHANGE_CLIENT_IDS is set, but no EXTERNAL_SSO_PROVIDERS entry of kind "assertion" sets an "exchangeAudience"'
  }
  return null
}
