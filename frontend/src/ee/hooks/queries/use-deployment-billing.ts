import { useCallback } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { getAuthHeaders } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { useBillingSurface } from "@/hooks/use-billing-surface"
import {
  isDeploymentPayer,
  surfaceCreditUnitLabel,
  type DeploymentPayerProbe,
} from "@/lib/surface-selectors"
import { tx, type MessageKey } from "@/lib/i18n"
import type { DisplayUnit } from "@/ee/app/billing-admin/units"

/**
 * The BILLING ACCOUNT's data layer (Track A, WS6) — `/v1/deployment-billing/*`.
 *
 * These routes exist only on a deployment where one account pays for everyone,
 * and only that account may call them: `app.ts` registers the plugin under
 * `hasCredits() && deploymentPayerActive()`, and every route sits behind
 * `requireDeploymentPayer`. MAINLINE (R2): `billingSurface().deploymentPayer`
 * is false, so `enabled` is false on every query here and the browser never
 * issues a single request — the paths do not exist to be 404'd.
 *
 * WHY THE OVERVIEW DOUBLES AS AN IDENTITY PROBE. The payer's uuid is
 * deliberately redacted from `/config.js` (it is operator-owned config the
 * customer must not be able to read or write), so there is NO client-side
 * source for "am I the payer". The only honest answer is the server's: a 200
 * from `/overview` means the guard let us through, and a 401/403/404 means it
 * did not. The probe is therefore the page's own first fetch, not an extra
 * round trip, and it fails CLOSED — anything that is not a 200 answers
 * "not-payer", so a nav entry can never appear on a maybe.
 *
 * UNITS (R3). Every per-user figure below arrives already converted by the
 * server, and every figure sent back travels in display units for the server to
 * convert. Nothing in this file multiplies by `unitRate`.
 */

// ── Wire types (mirrors of backend/src/ee/routes/deployment-billing.ts) ─────

export interface DeploymentBillingOverview {
  /** RAW Nodaro credits — the deployment's real money. Rendered ONLY on the
   *  billing account's page, and labelled as Nodaro's there. */
  readonly payer: {
    readonly balanceCredits: number | null
    readonly subscriptionCredits: number | null
    readonly topupCredits: number | null
    readonly tier: string | null
    readonly periodEnd: string | null
  }
  readonly burn: {
    readonly periodStart: string
    readonly credits: number | null
    readonly generations: number | null
    /** The server counted at its cap: the figure is a floor, and the page says so. */
    readonly capped: boolean
  }
  readonly defaultAllowance: { readonly credits: number; readonly units: number | null }
  readonly users: { readonly total: number | null; readonly provisioned: number }
  readonly unit: DisplayUnit | null
  /** False until the overlay flips `billing.allowances` to "enforce" (rollout
   *  step 8). Until then a user is never refused, and the page must not imply
   *  a limit is doing anything. */
  readonly allowancesEnforced: boolean
  readonly stripeConfigured: boolean
}

export interface DeploymentUserRow {
  readonly id: string
  readonly email: string | null
  /** The human-readable name. `profiles` has NO `display_name` column (see
   *  database.types.ts and routes/me.ts) — a projection that named one 500'd
   *  the whole route, and the name on screen has to be the one the route can
   *  search. */
  readonly full_name: string | null
  readonly created_at: string
  /** Display units, or null when unavailable. NEVER 0 for "unknown". */
  readonly granted: number | null
  readonly remaining: number | null
  readonly spent: number | null
  /** false ⇒ no allowance row yet: the three figures above are the DEFAULT this
   *  user will actually be given at their first Generate (D7), not a guess. */
  readonly provisioned: boolean
  /** The subject the identity provider asserts for this person — the name an
   *  integration knows them by, since it never learns the studio's own uuid.
   *  Absent when the deployment's IdP asserts none. */
  readonly ssoSubject?: string | null
  /**
   * When this allowance's current PERIOD began — the instant a renewal last
   * zeroed `spent` — or ABSENT when it has never been renewed.
   *
   * Optional and omitted rather than null, because that is the shape the
   * server sends and because absence is the meaningful answer: until a
   * renewal has happened `spent` is a LIFETIME figure, and a table that said
   * "this period" beside it would be printing a true number under a false
   * sentence.
   */
  readonly resetAt?: string | null
}

export interface DeploymentUsersPage {
  readonly data: readonly DeploymentUserRow[]
  readonly total: number
  readonly limit: number
  readonly offset: number
  readonly unit: DisplayUnit | null
}

/** `renewal` is the fourth kind inside the reconciliation sum (`granted =
 *  Σ credits WHERE kind IN ('default','topup','correction','renewal')`); it is
 *  the one kind whose `credits` may legitimately be ZERO, so that a renewal at
 *  an unchanged plan still leaves a row saying the period turned over.
 *  `overrun` remains audit-only and outside the sum. */
export type AllowanceGrantKind = "default" | "topup" | "correction" | "overrun" | "renewal"

export interface AllowanceGrantRow {
  readonly id: string
  /** Display units. NEGATIVE for a correction and for an `overrun`. */
  readonly units: number | null
  readonly kind: AllowanceGrantKind
  readonly note: string | null
  readonly createdAt: string
  /**
   * The integration credential that performed the move, or null for the
   * billing account's own browser session (this page).
   *
   * AUDIT ONLY. The actor on every row is still the billing account — the key
   * acts *as* it — which is exactly why the credential has to be named
   * separately: without this the payer cannot tell a move their integration
   * made from one they made here themselves.
   */
  readonly credentialId?: string | null
  /** The credential's name, when the route joined it. The page resolves the id
   *  against the keys list when it did not, so both shapes render alike. */
  readonly credentialName?: string | null
}

/**
 * One billing integration key, as `GET /integration-keys` reports it.
 *
 * THERE IS NO `token` FIELD, and there never will be. The bearer exists in
 * exactly one response body — the mint answer below — once. This route reads
 * columns that deliberately exclude the hash, so a row cannot grow one by
 * accident.
 */
export interface IntegrationKey {
  readonly id: string
  readonly name: string
  /** The first 12 characters (`ndr_bill_` + 3 hex) — enough to recognise a key
   *  in a log line, useless as a credential. */
  readonly tokenPrefix: string
  readonly createdAt: string
  readonly expiresAt: string | null
  readonly lastUsedAt: string | null
  readonly revokedAt: string | null
  /** The source ranges the key is accepted from; null = any source. This is
   *  configuration the payer set, not key material. */
  readonly allowedCidrs?: readonly string[] | null
}

/** The ONE body that carries a bearer. It is shown once and is not recoverable
 *  — a key the payer failed to copy is revoked and replaced, never re-read. */
export interface MintedIntegrationKey {
  readonly id: string
  readonly name: string
  readonly token: string
  readonly tokenPrefix: string
  readonly expiresAt: string | null
}

/**
 * The minimal pool read, and the payer's own alert threshold.
 *
 * RAW Nodaro credits, like block 1 of the page — the pool is the deployment's
 * real money and is the one figure on this whole surface that is not in the
 * deployment's display unit. `threshold` is null when the payer has set none,
 * and `lowBalance` is then false: never a fabricated default.
 */
export interface DeploymentBalance {
  readonly balanceCredits: number | null
  readonly burn: {
    readonly periodStart: string
    readonly credits: number | null
    readonly generations: number | null
    readonly capped: boolean
  }
  readonly periodEnd: string | null
  readonly lowBalance: boolean
  readonly threshold: number | null
}

/** The cap the mint route enforces. Mirrored here so the page can say how many
 *  of them are in use BEFORE the payer meets `key_limit_reached`. */
export const MAX_LIVE_INTEGRATION_KEYS = 5

/** Live = not revoked, and not past its expiry. The same definition the route
 *  counts with; a key that has expired frees a slot without being revoked. */
export function isIntegrationKeyLive(k: IntegrationKey, now = Date.now()): boolean {
  if (k.revokedAt) return false
  return !k.expiresAt || new Date(k.expiresAt).getTime() > now
}

export interface UserGrantsPage {
  readonly user: {
    readonly id: string
    readonly granted: number | null
    readonly remaining: number | null
    readonly spent: number | null
    readonly provisioned: boolean
  }
  readonly grants: readonly AllowanceGrantRow[]
  readonly limit: number
  readonly offset: number
  readonly unit: DisplayUnit | null
}

export interface PurchaseRow {
  readonly id: string
  readonly stripe_transaction_id: string | null
  readonly type: string | null
  readonly amount_usd: number | null
  readonly credits_granted: number | null
  readonly tier: string | null
  readonly created_at: string
  readonly receipt_url: string | null
}

export interface LedgerRow {
  readonly id: string
  readonly amount: number | null
  readonly credit_type: string | null
  readonly source: string | null
  readonly description: string | null
  readonly balance_after: number | null
  readonly created_at: string
}

export interface DeploymentTransactions {
  readonly purchases: readonly PurchaseRow[]
  readonly ledger: readonly LedgerRow[]
  readonly limit: number
  readonly offset: number
}

// ── Transport ───────────────────────────────────────────────────────────────

export class DeploymentBillingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: string,
  ) {
    super(message)
    this.name = "DeploymentBillingError"
  }
}

/**
 * The WHOLE response body, envelope and all.
 *
 * Two body shapes travel from these routes and confusing them is silent: six of
 * the seven answer `{ data: <payload> }`, but `GET /users` answers
 * `{ data: [...rows], total, limit, offset, unit }` — the pagination lives
 * BESIDE `data`, not inside it. Unwrapping that one would hand the caller a
 * bare array typed as a page object, and every field it reads off it
 * (`total`, `unit`) would be `undefined` while the table rendered "no users"
 * against a populated instance. So the unwrap is explicit, per call site.
 */
async function requestRaw<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/v1/deployment-billing${path}`, {
    ...init,
    headers: {
      ...(await getAuthHeaders()),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  })
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: { code?: string; message?: string; detail?: string } })
    | null
  if (!res.ok) {
    throw new DeploymentBillingError(
      res.status,
      body?.error?.code ?? "unknown",
      body?.error?.message ?? "Request failed",
      body?.error?.detail,
    )
  }
  return body as T
}

/** The six routes whose payload IS the envelope's `data`. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const body = await requestRaw<{ data: T }>(path, init)
  return body?.data as T
}

/**
 * Which sentence a server refusal renders as. The codebase's convention is that
 * the server's English message is a developer-facing fallback and the CODE is
 * what the UI localizes — this page is Hebrew-first, so the code is what counts.
 */
export function errorMessageKey(e: unknown): MessageKey {
  const code = e instanceof DeploymentBillingError ? e.code : ""
  switch (code) {
    case "unit_not_whole_credits":
      return "billingAdmin.errNotWholeCredits"
    case "invalid_units":
      return "billingAdmin.errInvalidUnits"
    // The note has its own two refusals BECAUSE the route judges the units
    // first and the note second: before that split, a valid amount with an
    // over-long note came back as `invalid_units` / "Enter a whole number",
    // which points the payer at the one field that was fine. Falling through
    // to `errGeneric` here would put the same blindfold back on.
    case "note_too_long":
      return "billingAdmin.errNoteTooLong"
    case "invalid_note":
      return "billingAdmin.errInvalidNote"
    case "unit_not_configured":
      return "billingAdmin.errUnitNotConfigured"
    case "allowance_below_committed":
      return "billingAdmin.errBelowCommitted"
    case "allowance_actor_not_payer":
      return "billingAdmin.errActorNotPayer"
    case "allowance_unconfigured":
      return "billingAdmin.errUnconfigured"
    case "allowance_write_failed":
    case "allowance_kind_invalid":
    case "allowance_zero_grant":
      return "billingAdmin.errWriteFailed"
    case "payer_has_no_allowance":
      return "billingAdmin.errPayerHasNoAllowance"
    case "stripe_not_configured":
      return "billingAdmin.errStripeNotConfigured"
    case "invalid_amount":
      return "billingAdmin.errInvalidAmount"
    // The billing integration credential's own refusals. Each one names the
    // field or the state that refused, for the reason the note's two codes
    // exist: a generic "the action did not complete" points the payer at
    // nothing, and the recovery from `key_limit_reached` (revoke one) is
    // completely different from the recovery from `invalid_cidr` (fix a range).
    case "key_limit_reached":
      return "billingAdmin.errKeyLimitReached"
    case "invalid_name":
      return "billingAdmin.errInvalidName"
    case "invalid_expiry":
      return "billingAdmin.errInvalidExpiry"
    case "invalid_cidr":
      return "billingAdmin.errInvalidCidr"
    case "invalid_key_id":
    case "key_not_found":
      return "billingAdmin.errKeyNotFound"
    case "key_write_failed":
      return "billingAdmin.errKeyWriteFailed"
    // A credential reached a route only the billing account's own browser may
    // use. That is a configuration mistake in the integration, not a failure of
    // this page, and the sentence has to say which.
    case "payer_session_required":
      return "billingAdmin.errPayerSessionRequired"
    case "invalid_threshold":
      return "billingAdmin.errInvalidThreshold"
    case "read_failed":
      return "billingAdmin.errReadFailed"
    default:
      return "billingAdmin.errGeneric"
  }
}

// ── Query keys ──────────────────────────────────────────────────────────────

const ROOT = ["deployment-billing"] as const
export const deploymentBillingKeys = {
  all: ROOT,
  overview: [...ROOT, "overview"] as const,
  transactions: [...ROOT, "transactions"] as const,
  users: (search: string, offset: number) => [...ROOT, "users", search, offset] as const,
  grants: (userId: string) => [...ROOT, "grants", userId] as const,
  integrationKeys: [...ROOT, "integration-keys"] as const,
  balance: [...ROOT, "balance"] as const,
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * The page's identity probe AND its first block of data.
 *
 * `enabled` is the R2 sentence: on a deployment with no `billing.payerAccount`
 * the billing surface answers `deploymentPayer: false` and this query never
 * fires. While the surface itself is loading the probe stays "pending" — acting
 * on the default (`false`) would flash the not-the-payer copy at the payer.
 */
export function useDeploymentPayerViewer(): {
  readonly probe: DeploymentPayerProbe
  readonly isPayer: boolean
  readonly overview: DeploymentBillingOverview | undefined
  /** The HTTP status the probe settled on: 403 is "you are not the payer",
   *  5xx is "we could not read it" — a distinction the page must make, because
   *  telling the payer they are not the payer over a transient fault is worse
   *  than saying the read failed. 0 means "no HTTP status at all" — either no
   *  error, or an error that never reached one; use `faulted` to tell a fault
   *  from a refusal, never this. */
  readonly errorStatus: number
  /**
   * True when the probe errored for any reason that is NOT a definitive 4xx
   * refusal from the guard: a 5xx, or a rejected fetch that never reached the
   * server at all (DNS, a killed connection, a blocked preflight). A READ
   * FAULT is not "you are not the payer".
   *
   * This exists because `requestRaw` awaits `fetch` unguarded: a transport
   * rejection never reaches the `if (!res.ok)` branch that builds a
   * `DeploymentBillingError`, so the raw TypeError propagates and there is no
   * status to test. Keying the page on `errorStatus >= 500` therefore told the
   * real billing account it was not the billing account for exactly the
   * failures that are hardest to diagnose.
   *
   * FALSE on mainline, where `enabled` keeps the query from ever firing — which
   * is what keeps the R2 byte-identity promise (a deployment with no payer
   * still renders the notPayer sentence, with no request).
   */
  readonly faulted: boolean
} {
  const { surface, isLoading: surfaceLoading } = useBillingSurface()
  const hasPayer = surface.deploymentPayer === true
  const q = useQuery({
    queryKey: deploymentBillingKeys.overview,
    queryFn: () => request<DeploymentBillingOverview>("/overview"),
    enabled: hasCredits() && hasPayer && !surfaceLoading,
    // A guard refusal is not a transient failure, and retrying it three times
    // only delays the page's honest answer.
    retry: false,
    staleTime: 30_000,
  })

  const probe: DeploymentPayerProbe = surfaceLoading
    ? "pending"
    : !hasPayer
      ? "not-payer"
      : q.isSuccess
        ? "payer"
        : q.isError
          ? "not-payer"
          : "pending"

  return {
    probe,
    isPayer: isDeploymentPayer(surface.deploymentPayer, probe),
    overview: q.data,
    errorStatus: q.error instanceof DeploymentBillingError ? q.error.status : 0,
    // Anything that is NOT a 4xx answer from the guard is a fault. Written as
    // a negation on purpose: the set of transport failures is open-ended, the
    // set of definitive refusals is not.
    faulted:
      q.isError &&
      !(q.error instanceof DeploymentBillingError && q.error.status >= 400 && q.error.status < 500),
  }
}

export function useDeploymentBillingUsers(enabled: boolean, search: string, offset: number, limit = 50) {
  const term = search.trim()
  return useQuery({
    queryKey: deploymentBillingKeys.users(term, offset),
    // requestRaw, not request: `total` / `limit` / `offset` / `unit` sit BESIDE
    // `data` in this one route's body, so the page IS the envelope.
    queryFn: () =>
      requestRaw<DeploymentUsersPage>(
        `/users?limit=${limit}&offset=${offset}${term ? `&search=${encodeURIComponent(term)}` : ""}`,
      ),
    enabled,
    retry: false,
    staleTime: 15_000,
  })
}

export function useDeploymentBillingTransactions(enabled: boolean) {
  return useQuery({
    queryKey: deploymentBillingKeys.transactions,
    queryFn: () => request<DeploymentTransactions>("/transactions?limit=25"),
    enabled,
    retry: false,
    staleTime: 60_000,
  })
}

export function useUserGrants(userId: string | null) {
  return useQuery({
    queryKey: deploymentBillingKeys.grants(userId ?? ""),
    queryFn: () => request<UserGrantsPage>(`/users/${userId}/grants?limit=50`),
    enabled: !!userId,
    retry: false,
    staleTime: 15_000,
  })
}

/**
 * The billing integration keys.
 *
 * ONE query, shared. The Integrations block lists them and the grant history
 * resolves `credentialId` to a name against the same rows — react-query dedupes
 * on the key, so the second consumer costs no request. It is also why the list
 * must include REVOKED keys: a revoked key's grants stay in the history for
 * good, and their "via <name>" label has to keep resolving.
 */
export function useIntegrationKeys(enabled: boolean) {
  return useQuery({
    queryKey: deploymentBillingKeys.integrationKeys,
    queryFn: () => request<readonly IntegrationKey[]>("/integration-keys"),
    enabled,
    retry: false,
    staleTime: 30_000,
  })
}

/**
 * The pool for a machine, plus the payer's own low-balance threshold.
 *
 * Separate from `/overview` on purpose: `lowBalance` is a SERVER-side
 * comparison against a threshold this page also writes, so the flag and the
 * field it depends on have to invalidate together — and only a route that
 * returns both can be relied on to agree with itself.
 */
export function useDeploymentBalance(enabled: boolean) {
  return useQuery({
    queryKey: deploymentBillingKeys.balance,
    queryFn: () => request<DeploymentBalance>("/balance"),
    enabled,
    retry: false,
    staleTime: 30_000,
  })
}

/** Refetch everything the pool's figures depend on (the Stripe return).
 *  Stable across renders — the page lists it in an effect's deps, and a fresh
 *  closure every render would re-invalidate on every re-render. */
export function useDeploymentBillingRefresh(): () => void {
  const qc = useQueryClient()
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: deploymentBillingKeys.all })
  }, [qc])
}

// ── Writes ──────────────────────────────────────────────────────────────────

export function useSetDefaultAllowanceMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { units: number }) =>
      request<{ credits: number; units: number | null }>("/default-allowance", {
        method: "PUT",
        body: JSON.stringify({ units: vars.units }),
      }),
    onSuccess: () => {
      toast.success(tx("billingAdmin.defaultSaved"))
      // `all`, not just the overview: every `provisioned: false` row in the
      // user table shows the DEFAULT (D7), so a saved default moves figures on
      // a page that would otherwise keep rendering the old one.
      void qc.invalidateQueries({ queryKey: deploymentBillingKeys.all })
    },
    onError: (e) => toast.error(tx(errorMessageKey(e))),
  })
}

export function useGrantAllowanceMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { userId: string; units: number; note: string }) =>
      request<{
        userId: string
        kind: "topup" | "correction"
        credits: number
        units: number | null
        allowance: { granted: number | null; remaining: number | null; spent: number | null }
      }>(`/users/${vars.userId}/grant`, {
        method: "POST",
        body: JSON.stringify({ units: vars.units, ...(vars.note ? { note: vars.note } : {}) }),
      }),
    onSuccess: (data, vars) => {
      // The GRANTED TOTAL is read back from the database, never computed here:
      // a top-up to a user who has never generated seeds the row at the default
      // AND writes the top-up, so `granted` comes back as default + top-up.
      // Client-side arithmetic would show the top-up alone and read as a lost
      // default.
      toast.success(
        tx("billingAdmin.topupDone", {
          granted: data.allowance.granted == null ? "—" : data.allowance.granted.toLocaleString(),
          unit: surfaceCreditUnitLabel(),
        }),
      )
      void qc.invalidateQueries({ queryKey: deploymentBillingKeys.all })
      void qc.invalidateQueries({ queryKey: deploymentBillingKeys.grants(vars.userId) })
    },
    onError: (e) => toast.error(tx(errorMessageKey(e))),
  })
}

export function useDeploymentCheckoutMutation() {
  return useMutation({
    mutationFn: (vars: { amountUsd: number }) =>
      request<{ url: string | null; credits: number }>("/checkout", {
        method: "POST",
        body: JSON.stringify({ amountUsd: vars.amountUsd }),
      }),
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url
    },
    onError: (e) => toast.error(tx(errorMessageKey(e))),
  })
}

/**
 * Mint an integration key. THE ONE CALL IN THE PRODUCT THAT PRODUCES A BEARER.
 *
 * Three rules, all of them enforced here rather than left to the block:
 *
 *  1. It is a MUTATION, never a query. A query would be re-fetched on window
 *     focus, on reconnect, on any invalidation — each re-fetch minting another
 *     key, spending one of the five slots on a bearer nobody ever saw.
 *  2. The token goes NOWHERE but this mutation's own `data`. Not into the query
 *     cache (which the list shares, and which outlives the panel), and above
 *     all not into a toast: a toast is copyable, screenshot-able, and stays on
 *     screen past the moment the payer dismissed the panel.
 *  3. `onSuccess` invalidates the LIST, which carries no token at all — so the
 *     new key appears by its prefix while the bearer stays in one place.
 */
export function useMintIntegrationKeyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { name: string; expiresAt?: string; allowedCidrs?: string[] }) =>
      request<MintedIntegrationKey>("/integration-keys", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      // Deliberately no toast: a success message here would have to say
      // something about a credential, and the panel already says the only
      // thing worth saying about this one.
      void qc.invalidateQueries({ queryKey: deploymentBillingKeys.integrationKeys })
    },
    // Deliberately no `onError` toast either — the block renders the refusal
    // inline, beside the button that refused, where the payer can act on it.
  })
}

/** Revoke a key. It takes effect on the integration's next request, and there
 *  is no un-revoke — which is why the block asks twice before calling this. */
export function useRevokeIntegrationKeyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string }) =>
      request<{ id: string; revoked: boolean }>(`/integration-keys/${vars.id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success(tx("billingAdmin.integrationsRevokedDone"))
      void qc.invalidateQueries({ queryKey: deploymentBillingKeys.integrationKeys })
    },
    onError: (e) => toast.error(tx(errorMessageKey(e))),
  })
}

/**
 * Set — or CLEAR — the low-balance threshold.
 *
 * `credits: null` clears it; `credits: 0` is a real threshold meaning "tell me
 * when the pool is empty". The column is `integer NULL CHECK (>= 0)` and those
 * two values mean different things, so a caller must never collapse an empty
 * field to zero — that arms an alert the payer just turned off.
 *
 * RAW Nodaro credits, the pool's own currency rather than the deployment's
 * display unit. R3 is not in play here: nothing is converted, in either
 * direction.
 */
export function useSetBalanceThresholdMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { credits: number | null }) =>
      request<{ threshold: number | null }>("/balance/threshold", {
        method: "PUT",
        body: JSON.stringify({ credits: vars.credits }),
      }),
    onSuccess: () => {
      toast.success(tx("billingAdmin.thresholdSaved"))
      // The FLAG is computed server-side against the figure just written, so
      // the balance read has to come back. Echoing the stored threshold into
      // the cache would leave `lowBalance` stale against its own threshold.
      void qc.invalidateQueries({ queryKey: deploymentBillingKeys.balance })
    },
    onError: (e) => toast.error(tx(errorMessageKey(e))),
  })
}
