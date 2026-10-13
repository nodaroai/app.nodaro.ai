/**
 * A person's credit USAGE rows — one per run their credits paid for — as every
 * surface lists them: `GET /v1/credits/transactions` and the MCP
 * `credit_transactions` tool read this one function, so the two agree row for
 * row.
 *
 * Each row carries the HOLD and the CHARGE side by side:
 *   - `credits_used` / `credits_reserved`: the hold taken when the run was
 *     accepted. It never changes, so a run settled below it still reads the
 *     whole hold there;
 *   - `credits_charged`: what the payer actually paid, through the one charge
 *     reader (`settledCharge`): null while the hold is open, 0 once refunded.
 */
import { supabase } from "./supabase.js"
import { settledCharge } from "./usage-amount.js"

/**
 * The metadata keys a caller may see on their OWN usage_logs row.
 *
 * An ALLOWLIST, not a denylist, and that direction is the whole point: the
 * transactions route used to `select("... metadata")` and send the object
 * whole, so `display_cost` -- Nodaro's own USD valuation of the run, written by
 * reserve_credits (311_payg_web_free_pool.sql:149-157) -- went out on the wire.
 * Dividing it by `credits_used` recovers CREDIT_BASE_USD exactly. A denylist
 * would leak again the next time an RPC learns a new key; an allowlist makes a
 * new key invisible until someone decides otherwise.
 *
 * Everything here is the user's own billing mechanics, not our economics:
 *   model                        -- the model they picked (already implied by `action`)
 *   from_sub / from_topup        -- which of THEIR credit pools funded the run
 *   is_app_run / allowance_delta -- app-credit allowance movement
 *   web_free_mode / status       -- product state
 *   *_refunded                   -- addon refunds (workers/shared.ts:957, :1003)
 *
 * Deliberately absent: `display_cost` (reserve_credits' spelling, 311:151) AND
 * `display_cost_usd` (the zero-cost-reserve bypass spelling at credits.ts:2114)
 * -- two spellings of the same value, which is why a denylist would have caught
 * only one. `usage_logs.cost_usd` is a COLUMN, not a metadata key; a response
 * projection cannot reach it, which is why migration 346 revokes the table from
 * anon/authenticated in this same PR. Guarded by
 * __tests__/credits-metadata-allowlist.test.ts (no economics-shaped key may
 * ever enter this list).
 */
export const ALLOWED_TRANSACTION_METADATA_KEYS = [
  "model",
  "from_sub",
  "from_topup",
  "is_app_run",
  "allowance_delta",
  "web_free_mode",
  "status",
  "loop_trim_refunded",
  "surround_refine_refunded",
] as const

/**
 * Shape-preserving: always returns an object, so `metadata` stays a documented
 * field of the `Transaction` contract (docs/api-integration.md) and existing
 * bearer-token consumers keep parsing it -- they see a narrowed object, never a
 * vanished field. `{}` when the row has no metadata or only disallowed keys.
 */
export function projectTransactionMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const src = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of ALLOWED_TRANSACTION_METADATA_KEYS) {
    if (key in src) out[key] = src[key]
  }
  return out
}

/** The most usage rows one page lists (`GET /v1/credits/transactions`' `limit` maximum). */
export const USAGE_TRANSACTIONS_PAGE_MAX = 50

export interface UsageTransactionPage {
  readonly items: Array<Record<string, unknown>>
  /** `created_at` of the last row when the page is full, else null. */
  readonly nextCursor: string | null
}

/**
 * The newest `limit` usage rows of `userId` older than `cursor` (a
 * `created_at`), projected for the person who paid them:
 * - `metadata` narrowed to {@link ALLOWED_TRANSACTION_METADATA_KEYS};
 * - `payer` / `workspaceId` from the `workspace_id` COLUMN (never
 *   `metadata.payer`), and `workspace_id` itself dropped;
 * - the amounts as described above.
 * The projection keeps every other top-level column, so the cursor (the last
 * row's `created_at`) is read off the projected row.
 */
export async function listUsageTransactions(
  userId: string,
  page: { readonly limit: number; readonly cursor?: string },
): Promise<UsageTransactionPage | { readonly error: unknown }> {
  let query = supabase
    .from("usage_logs")
    // `status` (PR9) is the reserved/committed/refunded lifecycle COLUMN
    // (019/025 migrations) — real credit-status data, not economics, so it
    // rides straight through like every other top-level column. Distinct from
    // `metadata.status` in the allowlist above, which no INSERT populates.
    // `credits_charged` is read only to feed `settledCharge` — the raw column
    // is overwritten, never sent as-is.
    .select("id, created_at, credits_used, credits_charged, action, provider, status, metadata, workspace_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(page.limit)
  if (page.cursor) query = query.lt("created_at", page.cursor)
  const { data, error } = await query
  if (error) return { error }

  const items = (data ?? []).map((row) => {
    const { workspace_id, ...rest } = row as Record<string, unknown> & {
      workspace_id?: string | null
    }
    const amounts = row as { status?: string | null; credits_used?: number | null; credits_charged?: number | null }
    return {
      ...rest,
      credits_charged: settledCharge(amounts),
      credits_reserved: amounts.credits_used ?? null,
      metadata: projectTransactionMetadata((row as { metadata?: unknown }).metadata),
      payer: workspace_id ? ("workspace" as const) : ("user" as const),
      workspaceId: workspace_id ?? null,
    }
  })
  const last = items[items.length - 1] as { created_at?: string } | undefined
  const nextCursor = items.length === page.limit && last?.created_at ? last.created_at : null
  return { items, nextCursor }
}
