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
}

export interface DeploymentUsersPage {
  readonly data: readonly DeploymentUserRow[]
  readonly total: number
  readonly limit: number
  readonly offset: number
  readonly unit: DisplayUnit | null
}

export type AllowanceGrantKind = "default" | "topup" | "correction" | "overrun"

export interface AllowanceGrantRow {
  readonly id: string
  /** Display units. NEGATIVE for a correction and for an `overrun`. */
  readonly units: number | null
  readonly kind: AllowanceGrantKind
  readonly note: string | null
  readonly createdAt: string
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
