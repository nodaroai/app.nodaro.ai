import type { FastifyRequest } from "fastify"
import { config } from "./config.js"
import { parseMcpAllowedClientIds } from "./mcp-client-ids.js"
import { mcpServedPath } from "./mcp-lane-addresses.js"
import { supabase } from "./supabase.js"

/**
 * THE funnel for "may this client use MCP here" (decided 2026-11-11). A
 * deployment that sets `MCP_ALLOWED_CLIENT_IDS` names the clients that may use
 * its MCP endpoint; this file is the only reader of that list, and every door
 * asks it:
 *
 *  - the MCP endpoint (`routes/mcp.ts`) asks `admitMcpCaller` before it builds
 *    a server: only a token issued to a listed client passes; every other
 *    credential kind the endpoint accepts — a session, a personal API token,
 *    the internal secret, a billing key, a kind added later — is refused;
 *  - the sign-in (`routes/oauth.ts`: the consent redirect, app-info, consent,
 *    the token exchange) asks `mcpSignInRefusal`: an unlisted client that asks
 *    for MCP is refused BEFORE the consent screen, and again wherever a code or
 *    a token would be issued;
 *  - dynamic registration (`routes/oauth-register.ts`) asks
 *    `registrationClosedByClientList`: with a list set it answers exactly as
 *    `MCP_DYNAMIC_REGISTRATION=off` does, since a client that registered
 *    itself can never be listed.
 *
 * `lib/__tests__/mcp-listed-clients-totality.test.ts` fails the build when a
 * file builds or serves an MCP server, issues a code or mints a token without
 * asking here (or a reasoned entry saying why it need not).
 *
 * No list (unset or blank): every answer is "go on", decided before anything
 * is read, so such a deployment behaves exactly as before the lever existed.
 * With a list, every doubt refuses: an unreadable client row, a lookup error,
 * an unknown credential kind, a `resource` that cannot be parsed.
 *
 * A later server-to-server grant (a signed assertion exchanged for a token)
 * plugs in at the same two points: the grant asks `mcpSignInRefusal` before it
 * mints, and the token it mints is an app token the endpoint admits through
 * `admitMcpCaller` like any other.
 */

/** The refusal's code on every JSON surface (the endpoint, app-info, consent). */
export const MCP_CLIENT_NOT_ALLOWED = "mcp_client_not_allowed"
/** What a refused caller reads. Names no client and nothing of the list. */
export const MCP_CLIENT_NOT_ALLOWED_MESSAGE =
  "This deployment accepts MCP connections only from the clients it has set up. Connect through the deployment's own app."

let parsedFrom: string | undefined
let parsedIds: ReadonlySet<string> | null = null

/**
 * The listed client ids, or null when the deployment lists none. A value that
 * does not parse lists NOBODY (fail closed) — `config.ts` refuses it at boot,
 * so this only matters to a process that skipped that check.
 */
export function listedMcpClients(): ReadonlySet<string> | null {
  const raw = typeof config.MCP_ALLOWED_CLIENT_IDS === "string" ? config.MCP_ALLOWED_CLIENT_IDS : ""
  if (raw !== parsedFrom) {
    const parsed = parseMcpAllowedClientIds(raw)
    parsedIds = parsed.ok ? parsed.ids : new Set<string>()
    parsedFrom = raw
  }
  return parsedIds
}

/** Whether this deployment restricts MCP to listed clients. */
export function mcpClientListSet(): boolean {
  return listedMcpClients() !== null
}

/** What the rule reads of a client: its `developer_apps` row. */
export interface McpClientFacts {
  client_id: string
  kind?: string | null
  status?: string | null
}

/**
 * Registration kinds a deployment makes itself: a developer app
 * (`POST /v1/developer-apps`, kind "user") or an operator-seeded one. A client
 * that registered itself (`dynamic_mcp`, `community_instance`) is never one,
 * whatever id a list names.
 */
const SET_UP_KINDS: ReadonlySet<string> = new Set(["user", "first_party_mcp"])

/** Kinds that exist to be MCP clients: their sign-in always asks for MCP. */
const MCP_KINDS: ReadonlySet<string> = new Set(["dynamic_mcp", "first_party_mcp"])

/** THE rule. No list: every client may (today's behaviour). A list: a listed, active client the deployment set up. */
export function clientMayUseMcp(app: McpClientFacts): boolean {
  const list = listedMcpClients()
  if (list === null) return true
  return list.has(app.client_id) && SET_UP_KINDS.has(app.kind ?? "user") && app.status === "active"
}

// ---------------------------------------------------------------------------
// The endpoint
// ---------------------------------------------------------------------------

export type McpCallerVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: 403 | 503; readonly code: string; readonly message: string }

const ADMITTED: McpCallerVerdict = { ok: true }
const REFUSED: McpCallerVerdict = { ok: false, status: 403, code: MCP_CLIENT_NOT_ALLOWED, message: MCP_CLIENT_NOT_ALLOWED_MESSAGE }
const CHECK_FAILED: McpCallerVerdict = {
  ok: false,
  status: 503,
  code: "mcp_client_check_failed",
  message: "Could not check this client right now. Try again in a moment.",
}

type CallerCredential = Pick<FastifyRequest, "authKind" | "appAuthorization">

/**
 * The one credential shape the endpoint admits while a list is set: a token
 * the platform's OAuth server issued to a client. Exhaustive over `authKind`,
 * so a kind added to the auth hook fails typecheck here until someone decides
 * it; at run time anything unrecognised refuses.
 */
function issuedToAClient(req: CallerCredential): req is CallerCredential & { appAuthorization: NonNullable<CallerCredential["appAuthorization"]> } {
  const kind = req.authKind
  switch (kind) {
    case "app_token":
      return req.appAuthorization !== undefined
    case "jwt":
    case "api_token":
    case "internal":
    case "billing_key":
    case undefined:
      return false
    default: {
      const unhandled: never = kind
      void unhandled
      return false
    }
  }
}

/** The client a token was issued to, read fresh on every call (never cached: removal from the list, a suspension, take effect at the next call). */
async function clientOfApp(appId: string): Promise<McpClientFacts | null | "error"> {
  const { data, error } = await supabase.from("developer_apps").select("client_id, kind, status").eq("id", appId).maybeSingle()
  if (error) return "error"
  if (!data || typeof (data as { client_id?: unknown }).client_id !== "string") return null
  return data as McpClientFacts
}

/**
 * May this request use the MCP endpoint? Asked by every route that serves an
 * MCP server to a caller, after the caller was identified and before the
 * server is built. No list: admitted, nothing read.
 */
export async function admitMcpCaller(req: CallerCredential): Promise<McpCallerVerdict> {
  if (!mcpClientListSet()) return ADMITTED
  if (!issuedToAClient(req)) return REFUSED
  let client: McpClientFacts | null | "error"
  try {
    client = await clientOfApp(req.appAuthorization.appId)
  } catch {
    client = "error"
  }
  if (client === "error") return CHECK_FAILED
  if (client === null || !clientMayUseMcp(client)) return REFUSED
  return ADMITTED
}

// ---------------------------------------------------------------------------
// The sign-in
// ---------------------------------------------------------------------------

export interface McpSignInRefusal {
  /** RFC 6749's error code, for the redirect to the client and the token endpoint. */
  readonly error: "unauthorized_client"
  /** The JSON surfaces' code. */
  readonly code: typeof MCP_CLIENT_NOT_ALLOWED
  readonly message: string
}

const SIGN_IN_REFUSAL: McpSignInRefusal = { error: "unauthorized_client", code: MCP_CLIENT_NOT_ALLOWED, message: MCP_CLIENT_NOT_ALLOWED_MESSAGE }

/** Whether a `resource` value (RFC 8707) names an MCP endpoint: its path is `/mcp` or the path MCP is served at, on any host (tokens carry no audience). Unparseable: yes. */
function resourceNamesMcp(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false
  if (Array.isArray(value)) return value.some(resourceNamesMcp)
  if (typeof value !== "string") return true
  let path: string
  try {
    path = new URL(value).pathname.replace(/\/+$/, "") || "/"
  } catch {
    return true
  }
  const served = mcpServedPath()
  return [ "/mcp", ...(served ? [served] : []) ].some((p) => path === p || path.startsWith(`${p}/`))
}

/** Whether a sign-in asks for MCP: a client that exists to be an MCP client always does; any other does when its `resource` names the MCP endpoint. */
export function signInAsksForMcp(app: Pick<McpClientFacts, "kind">, resource: unknown): boolean {
  return MCP_KINDS.has(app.kind ?? "user") || resourceNamesMcp(resource)
}

/**
 * The sign-in rule, for every step that shows consent or issues a code or a
 * token: null to go on, or the refusal. No list: null, nothing read beyond
 * the row the step already holds. A list: a client that may use MCP goes on;
 * any other goes on only when it does not ask for MCP (an unlisted developer
 * app signing in for the REST API is unaffected — its token is still refused
 * on the MCP lane).
 */
export function mcpSignInRefusal(app: McpClientFacts, resource: unknown): McpSignInRefusal | null {
  if (!mcpClientListSet()) return null
  if (clientMayUseMcp(app)) return null
  return signInAsksForMcp(app, resource) ? SIGN_IN_REFUSAL : null
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * With a list set, dynamic registration of an MCP client answers as
 * `MCP_DYNAMIC_REGISTRATION=off` does, whatever that variable says: a client
 * that registers itself can never be listed (`config.ts` refuses its id, the
 * rule above refuses its kind), so a registration could only make a row the
 * sign-in then refuses. Community-instance registrations keep their own switch.
 */
export function registrationClosedByClientList(): boolean {
  return mcpClientListSet()
}
