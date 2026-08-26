/**
 * The reserve RPC's refusal vocabulary, translated once (E2/P14).
 *
 * Migration 351's `reserve_credits` refuses with stable RAISE prefixes —
 * that is the wire contract between the database and every reserve site.
 * This file is the ONE translator: prefix → HTTP status + stable code +
 * FIXED message. Core placement on purpose: the orchestrator (core) needs
 * the same translation as the ee guard, and this is pure vocabulary — no
 * ee import, no credit logic, nothing edition-gated.
 *
 * Two rules, both audit-scarred:
 *  - Matching is ANCHORED to the start of the message (the plugin's
 *    `RPC_PREFIX_MAP` discipline): content that merely CONTAINS a prefix
 *    must not spoof a business rejection out of a real fault.
 *  - The database's own text is NEVER echoed to a caller. The raw message
 *    interpolates user ids and amounts (`BUDGET_EXCEEDED: allocated 5000,
 *    need 40 …`); it belongs in server logs, and callers get the fixed
 *    message here. `SUBSCRIPTION_REQUIRED:` is deliberately absent — it has
 *    its own dedicated handling (the subscription modal), which every catch
 *    checks BEFORE this map.
 */

export interface MappedReserveError {
  status: 402 | 403 | 404 | 409
  // ONE platform vocabulary (P14.3 review): "not a member" is not_a_member
  // everywhere (orgs-context rung 1, api-tokens, MCP — and the frontend's
  // stale-workspace self-heal keys on exactly that code), and
  // workspace_archived is publicly documented as 409. A reserve-side fork
  // of either would be a second dialect for the same condition.
  code:
    | "budget_exceeded"
    | "member_cap_exceeded"
    | "workspace_archived"
    | "member_suspended"
    | "not_a_member"
    | "workspace_not_found"
  message: string
}

const RESERVE_PREFIX_MAP: Readonly<Record<string, MappedReserveError>> = {
  BUDGET_EXCEEDED: {
    status: 402,
    code: "budget_exceeded",
    message: "The workspace budget cannot cover this run",
  },
  MEMBER_CAP_EXCEEDED: {
    status: 402,
    code: "member_cap_exceeded",
    message: "Your credit cap in this workspace cannot cover this run",
  },
  WORKSPACE_ARCHIVED: {
    status: 409,
    code: "workspace_archived",
    message: "The workspace is archived",
  },
  MEMBER_SUSPENDED: {
    status: 403,
    code: "member_suspended",
    message: "Your membership in this workspace is suspended",
  },
  MEMBER_NOT_FOUND: {
    status: 403,
    code: "not_a_member",
    message: "You are not a member of this workspace",
  },
  WORKSPACE_NOT_FOUND: {
    status: 404,
    code: "workspace_not_found",
    message: "Workspace not found",
  },
}

const RAISE_PREFIX = /^([A-Z][A-Z_]*):/

/** The known reserve-refusal prefix at the START of a message, or null. */
export function reservePrefixOf(message: string | null | undefined): string | null {
  if (!message) return null
  const m = RAISE_PREFIX.exec(message)
  return m && RESERVE_PREFIX_MAP[m[1]] ? m[1] : null
}

/**
 * A reserve refusal that kept its identity through the wrapper layers.
 * Family 0 throws THIS (never a string-concatenated Error) when the RPC's
 * message carries a known prefix — string wrapping is how the prefix used
 * to die before any catch could match it anchored. `message` is the FIXED
 * translation; the raw database text lives only in `raw`, for logs.
 */
export class ReserveRpcError extends Error {
  readonly prefix: string
  readonly raw: string
  constructor(prefix: string, raw: string) {
    super(RESERVE_PREFIX_MAP[prefix]?.message ?? "Credit reservation refused")
    this.name = "ReserveRpcError"
    this.prefix = prefix
    this.raw = raw
  }
}

/**
 * Translate any thrown reserve failure. A `ReserveRpcError` matches by its
 * carried prefix; a plain Error matches only when a known prefix ANCHORS its
 * message (direct-rpc callers that did not wrap). Anything else is null —
 * a real fault, not a business rejection, and must surface as a 500.
 */
export function mapReserveError(err: unknown): MappedReserveError | null {
  if (err instanceof ReserveRpcError) return RESERVE_PREFIX_MAP[err.prefix] ?? null
  if (err instanceof Error) {
    const prefix = reservePrefixOf(err.message)
    return prefix ? RESERVE_PREFIX_MAP[prefix] : null
  }
  return null
}
