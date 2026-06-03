import type { NodaroClient } from "../client.js"

/**
 * Authenticated user's credit balance — the shape of `GET /v1/user/credits`'s
 * `data` field. Mirrors the canonical `UserBalance` from the backend billing
 * module (`backend/src/ee/billing/credits.ts`), the source of truth: keep this
 * in sync if that interface changes.
 */
export interface UserBalance {
  total: number
  subscription: number
  topup: number
  dailySpent: number
  dailyLimit: number | null
  monthlyAllocation: number
  tier: string
  features: Record<string, unknown>
  periodEnd: string | null
  /** Credits earned for app usage (free tier only — earned by running flows). */
  appCreditsAllowance: number
}

/**
 * Result of `POST /v1/credits/model-costs` — a batch cost lookup for editor
 * cost previews. `data` maps each priced identifier → its credit cost.
 *
 * Per-model fault isolation (the route runs the lookups under
 * `Promise.allSettled`): identifiers with no pricing row are reported in
 * `missing` (undisplayable until an operator seeds a price) and lookup
 * failures in `errors`, instead of failing the whole batch. Callers typically
 * render `'—'` for any identifier that lands in `missing`. The hard-fail
 * policy still triggers at reservation time when the user actually runs the
 * node — this preview lookup is intentionally lenient.
 */
export interface ModelCostsResult {
  data: Record<string, number>
  missing: string[]
  errors: string[]
}

/** Max identifiers per `model-costs` batch — the route caps the request at 50. */
const MODEL_COSTS_LIMIT = 50

export class CreditsResource {
  constructor(private client: NodaroClient) {}

  /**
   * `GET /v1/user/credits` → the authenticated user's credit balance and tier
   * info. Throws `UnauthorizedError` (401) when signed out, and the SDK's
   * other typed errors on the usual statuses.
   */
  async balance(): Promise<UserBalance> {
    const res = await this.client.request<{ data: UserBalance }>(
      "GET",
      "/v1/user/credits",
    )
    return res.data
  }

  /**
   * `POST /v1/credits/model-costs` → per-identifier credit cost, for editor
   * cost previews. Capped at the first {@link MODEL_COSTS_LIMIT} identifiers
   * (the route's request limit). Preserves the `{ data, missing, errors }`
   * fault-isolation shape verbatim (see {@link ModelCostsResult}).
   */
  modelCosts(ids: string[]): Promise<ModelCostsResult> {
    return this.client.request<ModelCostsResult>("POST", "/v1/credits/model-costs", {
      body: { models: ids.slice(0, MODEL_COSTS_LIMIT) },
    })
  }

  // NOTE: no `estimate(...)` helper. The backend exposes
  // `POST /v1/credits/estimate-workflow` (body `{ nodes }` → `{ data: {
  // totalCredits, nodeCount } }`), but no consumer has a settled shape for it
  // yet (studio pre-checks `balance >= Σ modelCosts` client-side rather than
  // calling an estimate endpoint). Adding it now would be inventing an API
  // surface ahead of a real caller, so it's deliberately omitted — add it when
  // a consumer needs it, shaped to that need.
}
