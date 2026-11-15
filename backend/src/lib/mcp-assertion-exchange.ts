import { clientMayUseMcp, mcpClientListSet, type McpClientFacts } from "./mcp-listed-clients.js"
import type { SsoProviderConfig } from "./sso-providers.js"
import { mcpLaneAddresses, metadataLane } from "./mcp-lane-addresses.js"
import type { HostRequestLike } from "./allowed-origins.js"
import { assertionExchangeClients, namedExchangeProvider } from "./mcp-assertion-exchange-settings.js"

export {
  JWT_BEARER_GRANT,
  assertionExchangeAdvertised,
  assertionExchangeBootProblem,
  assertionExchangeClients,
  assertionExchangeTokenTtlSeconds,
} from "./mcp-assertion-exchange-settings.js"

/**
 * THE rule for the MCP assertion exchange (decided 2026-11-11): a deployment
 * whose own application signs its people in can let that application's
 * server exchange a signed assertion for an MCP access token, with no consent
 * click (POST /v1/oauth/token, the RFC 7523 jwt-bearer grant —
 * `routes/oauth-assertion-exchange.ts`). Off unless the deployment turns it
 * on, and narrow when on. It is on for a client only when ALL of these hold:
 *
 *  - the deployment lists its MCP clients (`MCP_ALLOWED_CLIENT_IDS`) and the
 *    client may use MCP (`clientMayUseMcp`: listed, active, set up by the
 *    deployment);
 *  - the deployment names the client for the exchange
 *    (`MCP_ASSERTION_EXCHANGE_CLIENT_IDS`), so a second listed client does
 *    not get it by default;
 *  - one SSO provider carries an `exchangeAudience` of its own, different from
 *    its sign-in `audience` (`sso-providers.ts` refuses equal ones at boot).
 *
 * Anything less and the grant does not exist for that caller: the token
 * endpoint answers it exactly as it answers a grant type it does not know,
 * and the authorization-server metadata does not name it
 * (`mcp-assertion-exchange-settings.ts`, the part read without a database).
 *
 * The verifier, the single-use rule and the account resolution are the
 * sign-in's own (`lib/sso-redeem.ts`); the token is an ordinary app token
 * (`lib/oauth-tokens.ts`) that the MCP endpoint admits through
 * `admitMcpCaller` like any other.
 */

/** The provider whose assertions the exchange takes, or null when the exchange is off on this deployment. */
export function assertionExchangeProvider(): SsoProviderConfig | null {
  // The list is asked here as well, through the funnel itself: with no list
  // `clientMayUseMcp` lets every client through, which must never switch the
  // exchange on.
  if (!mcpClientListSet()) return null
  return namedExchangeProvider()
}

/** Whether this deployment has the exchange on at all (no client row read). */
export function assertionExchangeOn(): boolean {
  return assertionExchangeProvider() !== null
}

/** The first, pure half of the per-client rule: may a request naming this `client_id` be an exchange at all? */
export function clientIdNamedForExchange(clientId: unknown): clientId is string {
  return typeof clientId === "string" && assertionExchangeOn() && (assertionExchangeClients()?.has(clientId) ?? false)
}

/** The whole per-client rule, on the client's row: named for the exchange AND allowed to use MCP. */
export function clientMayExchange(app: McpClientFacts): boolean {
  return clientIdNamedForExchange(app.client_id) && clientMayUseMcp(app)
}

/** The MCP endpoint's address as this request's lane states it (the host it came through, on a deployment that serves MCP by path). */
export function mcpEndpointOfRequest(req: HostRequestLike): string {
  return mcpLaneAddresses(req, metadataLane()).mcpUrl
}

function originAndPath(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.search || url.hash || url.username || url.password) return null
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

/**
 * Whether an RFC 8707 `resource` names this deployment's MCP endpoint, as the
 * request's lane states it: the same origin and path (a trailing slash
 * aside), no query, no fragment. Every value of a repeated parameter must;
 * none at all does not.
 */
export function resourceNamesThisMcpEndpoint(req: HostRequestLike, resource: unknown): boolean {
  const values = Array.isArray(resource) ? resource : [resource]
  if (values.length === 0) return false
  const endpoint = originAndPath(mcpEndpointOfRequest(req))
  if (endpoint === null) return false
  return values.every((v) => typeof v === "string" && originAndPath(v) === endpoint)
}
