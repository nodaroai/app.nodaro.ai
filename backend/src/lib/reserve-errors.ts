/**
 * The reserve RPC's refusal vocabulary, translated once (E2/P14).
 *
 * Migration 351's `reserve_credits` refuses with stable RAISE prefixes —
 * that is the wire contract between the database and every reserve site.
 * Migration 382 adds two more for Track A's per-user allowance.
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
  // 500 is here for exactly one member (ALLOWANCE_UNCONFIGURED) and it is not
  // a category error: this vocabulary is "what the reserve RPC raised", and
  // 382 raises one of them for a MISCONFIGURED DEPLOYMENT rather than for a
  // rejected request. Translating it to a 402 would tell a user to go buy
  // something that cannot help them; it is the operator's fault, so it gets a
  // fault status — with a stable code, so the log line is still greppable.
  status: 402 | 403 | 404 | 409 | 500
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
    | "user_allowance_exceeded"
    | "allowance_unconfigured"
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
  // Track A (migration 382): the per-user SAI allowance. Raised as
  // `USER_ALLOWANCE_EXCEEDED: granted %, remaining %, need %` — the three
  // figures stay in `.raw`, per this file's second rule.
  //
  // The NAME was chosen against three constraints and none of them is
  // cosmetic (D9): it must not contain "insufficient" or "not enough",
  // because `pipelines/credits.ts` and `scene-helper-credits.ts` substring-
  // match those two words BEFORE consulting this map and would downgrade a
  // quota refusal into the wallet-empty one; it must not collide with the
  // workspace `budget_exceeded`; and it must read as THIS USER's quota. The
  // deployment-pool refusal keeps its own separate code
  // (`insufficient_credits`, "contact your administrator") — under a
  // deployment payer the two have different fixers, and an admin genuinely
  // cannot top anyone up.
  USER_ALLOWANCE_EXCEEDED: {
    status: 402,
    code: "user_allowance_exceeded",
    message: "Your allowance cannot cover this run",
  },
  // Enforcement was requested with no settings row, or with a settings row
  // naming no payer. That is impossible on a healthy deployment — the boot
  // upsert writes the row before route registration — so it is a FAULT, not
  // a business refusal. 500 keeps it out of the "buy more credits" funnel and
  // puts it where an operator will look.
  ALLOWANCE_UNCONFIGURED: {
    status: 500,
    code: "allowance_unconfigured",
    message: "Per-user allowances are not configured on this deployment",
  },
}

/**
 * Stable CODE -> canonical HTTP status, derived from the one map above.
 *
 * `mapReserveError` answers a whole `MappedReserveError`, which is what a lane
 * that catches the RPC failure itself wants. A lane that carries the refusal
 * across a service boundary keeps only the CODE (branch-pipeline throws a
 * `BranchPipelineError`, and its route maps codes to statuses) — and a
 * hand-written second copy of these statuses is exactly the second dialect the
 * header of this file forbids. Derive, never retype.
 */
export const RESERVE_STATUS_BY_CODE: Readonly<Record<MappedReserveError["code"], MappedReserveError["status"]>> =
  Object.fromEntries(Object.values(RESERVE_PREFIX_MAP).map((m) => [m.code, m.status])) as Readonly<
    Record<MappedReserveError["code"], MappedReserveError["status"]>
  >

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
