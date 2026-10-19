import type { NodaroClientCore } from "../core.js"

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
  /**
   * Where the account's free signup grant stands. `"withheld"` means the
   * account works but the grant did not land — show the activation path.
   * Absent where the deployment has no signup grant.
   */
  freeGrantState?: FreeGrantState
  /**
   * Present only with `freeGrantState: "withheld"`, when the claim showed no
   * browser signals at all: the app may say "free credits need a regular
   * browser — reload", because a reload in one judges the account again.
   */
  freeGrantNotice?: "browser_unmeasured"
  /**
   * The welcome-credits opt-in. PRESENT only while the deployment has the
   * offer switched on — absent means "no popup, no banner, no block".
   */
  welcomeOffer?: WelcomeOfferState
}

/** Where an account's free signup grant stands. */
export type FreeGrantState = "unclaimed" | "granted" | "withheld" | "revoked"

/** `UserBalance.welcomeOffer` — what an app needs to show the welcome offer. */
export interface WelcomeOfferState {
  /** The one-time popup was already shown (see `markWelcomeOfferSeen`). */
  popupSeen: boolean
  /**
   * The account already has its credits (granted elsewhere) but still owes
   * the email consent: the web apps block creation until it is given — the
   * claim records it.
   */
  consentPending: boolean
  /** The credits a claim grants. Name this figure in the offer; never hard-code it. */
  credits: number
}

/** What `claimWelcomeOffer` sends: the browser signals plus the app answering. */
export interface WelcomeOfferClaimInput extends SignupKeys {
  /**
   * The answering app's slug (lowercase letters, digits and `-`, up to 40
   * characters), recorded with the consent. A value outside that grammar is
   * stored as absent, never refused.
   */
  sourceApp?: string
  /**
   * The interface language the user answered in — the id of a language Nodaro
   * ships, such as `"en"`, `"ja"` or `"pt-BR"`. Matched exactly and
   * case-sensitively: `"en-US"` or `"pt-br"` is stored as absent, never refused.
   * Recorded with the consent as the language of the LATEST consent: a later
   * "yes" in another language replaces it.
   */
  locale?: string
}

/** The answer of `POST /v1/credits/welcome-offer/claim`. */
export interface WelcomeOfferClaimResult {
  /** The email consent is recorded. */
  consent: "granted"
  /** Where the free grant stands after the claim — `"withheld"` when the abuse gate refused it. */
  grant: FreeGrantState
  /** The grant's figure. A grant tops the subscription credits UP TO it (it is not added on top), so a claim that lands it leaves the subscription credits at no less than this. */
  credits: number
}

/** The answer of `POST /v1/credits/welcome-offer/seen`. */
export interface WelcomeOfferSeenResult {
  ok: true
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
  state: FreeGrantState
  /** True only when THIS call moved the credits — a repeat is `false` with the same state. */
  granted: boolean
}

/**
 * One row of `GET /v1/credits/transactions` — a run's reservation and how it
 * settled.
 *
 * Which amount to read: a run first HOLDS credits and is then settled — charged
 * all or part of the hold, the rest returned. `credits_charged` is what the run
 * cost (`null` while the hold is still open, `0` once refunded); sum it for
 * spend. `credits_reserved` is the hold, which never changes. `credits_used`
 * is the same hold under its original name, kept for existing integrations.
 */
export interface CreditTransaction {
  id: string
  /** ISO-8601. Also the paging cursor: pass the last row's value as `cursor`. */
  created_at: string
  /** Settled charge; `null` while `status` is `"reserved"`, `0` when refunded. */
  credits_charged: number | null
  /** The hold taken when the run was accepted. */
  credits_reserved: number | null
  /** The hold, under its original name. Prefer `credits_charged`. */
  credits_used: number | null
  /** The model or operation the credits were for. */
  action: string | null
  provider: string | null
  /** Reservation lifecycle: `"reserved"`, `"committed"` or `"refunded"`. */
  status: string | null
  /** The caller's own billing details for the run (model, which pool paid, …). */
  metadata: Record<string, unknown>
  /** `"workspace"` when a class or team budget paid, not your balance. */
  payer: "user" | "workspace"
  workspaceId: string | null
}

/** A page of {@link CreditTransaction}s, newest first. */
export interface CreditTransactionsPage {
  data: CreditTransaction[]
  /** Pass as `cursor` for the next page; `null` when there are no more rows. */
  nextCursor: string | null
}

export interface CreditTransactionsOptions {
  /** Rows per page, 1–50 (server default 20). */
  limit?: number
  /** The `nextCursor` of the previous page. */
  cursor?: string
}

/** Max identifiers per `model-costs` batch — the route caps the request at 50. */
const MODEL_COSTS_LIMIT = 50

export class CreditsResource {
  constructor(private client: NodaroClientCore) {}

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
   * `GET /v1/credits/transactions` → one page of the caller's credit
   * transactions, newest first, with `nextCursor` for the next page (`null`
   * at the end). Read `credits_charged` for what each run cost — it can be
   * below the hold (`credits_reserved`) and is `null` while the hold is open.
   * Cloud-only route: a self-hosted instance answers 404.
   */
  transactions(options: CreditTransactionsOptions = {}): Promise<CreditTransactionsPage> {
    return this.client.request<CreditTransactionsPage>("GET", "/v1/credits/transactions", {
      query: { limit: options.limit, cursor: options.cursor },
    })
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

  /**
   * `POST /v1/credits/welcome-offer/claim` → the user's "yes" to the welcome
   * offer, as ONE server action: the marketing-email consent is recorded,
   * then the free signup grant is claimed with that consent. The abuse gate
   * still decides — consent is necessary, not sufficient — so read `grant`:
   * `"granted"` (the grant has landed: this call topped the subscription credits up to `credits` — not added on top — or it had landed before), `"withheld"` (refused), `"revoked"` (taken back earlier; nothing moves), `"unclaimed"` (nothing moved — treat as a failure and let the user retry).
   * Pass the browser signals from `collectSignupKeys()` and your app's slug.
   *
   * **Browser session only.** Usable from a first-party web app signed in
   * with a Supabase session (the consent is a person's choice in a browser);
   * an API key or OAuth app token is refused with 403. 409
   * `welcome_offer_disabled` while the deployment has the offer off — show
   * it only when `balance().welcomeOffer` is present. Cloud-only route: a
   * self-hosted instance answers 404.
   */
  claimWelcomeOffer(input: WelcomeOfferClaimInput = {}): Promise<WelcomeOfferClaimResult> {
    return this.client.request<WelcomeOfferClaimResult>("POST", "/v1/credits/welcome-offer/claim", {
      body: input,
    })
  }

  /**
   * `POST /v1/credits/welcome-offer/seen` → records that the one-time welcome
   * popup was shown, so `balance().welcomeOffer.popupSeen` turns true on every
   * app. Idempotent (the first stamp wins); a failed call only means the popup
   * may show once more, so callers usually ignore errors.
   *
   * **Browser session only**, like {@link claimWelcomeOffer}: 403 for an API
   * key or OAuth app token, 409 `welcome_offer_disabled` while the offer is
   * off, 404 on a self-hosted instance.
   */
  markWelcomeOfferSeen(): Promise<WelcomeOfferSeenResult> {
    return this.client.request<WelcomeOfferSeenResult>("POST", "/v1/credits/welcome-offer/seen")
  }

  // NOTE: no `estimate(...)` helper. The backend exposes
  // `POST /v1/credits/estimate-workflow` (body `{ nodes }` → `{ data: {
  // totalCredits, nodeCount } }`), but no consumer has a settled shape for it
  // yet (studio pre-checks `balance >= Σ modelCosts` client-side rather than
  // calling an estimate endpoint). Adding it now would be inventing an API
  // surface ahead of a real caller, so it's deliberately omitted — add it when
  // a consumer needs it, shaped to that need.
}
