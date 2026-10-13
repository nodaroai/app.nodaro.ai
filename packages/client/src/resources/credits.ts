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
  /** Stored billing tier. Display should prefer `effectiveTier`. */
  tier: string
  /** Derived entitlement tier: "payg" when stored-free with purchased credits. */
  effectiveTier: string
  features: Record<string, unknown>
  periodEnd: string | null
  /** Credits earned for app usage (free tier only — earned by running flows). */
  appCreditsAllowance: number
  /** Present when a deployment uses an external shared wallet. Raw credits;
   * null means unavailable. Do not substitute the personal `total` balance. */
  externalWallet?: { available: number | null }
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

/**
 * The two browser signals a claim reports — SHA-256 hex digests computed by
 * `@nodaro/sdk/signup-signals` (`collectSignupKeys`). Either may be absent:
 * a browser that cannot be measured still claims, and the server treats the
 * absence as what it is. Any other value is stored as absent server-side.
 */
export interface SignupKeys {
  browserKey?: string
  deviceKey?: string
}

/** The answer of `POST /v1/credits/claim-signup-grant`. */
export interface SignupGrantClaimResult {
  /** Where the account's free grant stands after this call. */
  state: "unclaimed" | "granted" | "withheld" | "revoked"
  /** True only when THIS call moved the credits — a repeat is `false` with the same state. */
  granted: boolean
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

  /**
   * `POST /v1/credits/claim-signup-grant` → claims the account's free signup
   * grant, once, with the browser signals of the page making the claim.
   *
   * Call it once per page load as soon as the session is known, and never
   * wait on it for rendering: it is idempotent (a decided account answers
   * with its state and `granted: false`), it costs the user nothing when it
   * fails (the next load asks again), and the signals are what make the
   * claim worth sending — collect them with `collectSignupKeys()` from
   * `@nodaro/sdk/signup-signals` and pass whatever came back, `{}` included.
   * Cloud-only route: a self-hosted instance answers 404.
   */
  claimSignupGrant(keys: SignupKeys = {}): Promise<SignupGrantClaimResult> {
    return this.client.request<SignupGrantClaimResult>("POST", "/v1/credits/claim-signup-grant", {
      body: keys,
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
