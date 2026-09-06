import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

/**
 * The WIRE, not the page (Track A, WS6).
 *
 * `billing-admin-page.test.tsx` mocks this hook module wholesale so the page's
 * rendering rules can be asserted without a network — which means nothing in
 * that file would notice if the hooks parsed the server's body wrongly. This
 * file is the other half: the REAL hooks, driven against WS4's documented
 * response bodies, reproduced verbatim from
 * `backend/src/ee/routes/deployment-billing.ts`.
 *
 * The bug it exists for: SIX of the seven routes answer `{ data: <payload> }`,
 * but `GET /users` answers `{ data: [...rows], total, limit, offset, unit }` —
 * the pagination sits BESIDE `data`. A single generic unwrap resolves that one
 * to a bare array, and the table then renders "no users match this search"
 * against a populated instance with no error anywhere.
 */

vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/edition")>()),
  // The routes exist only on a credit-bearing edition; the default test build
  // is `community`, where the whole surface is correctly inert.
  hasCredits: () => true,
}))

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer test" }) }))

// The mutations below toast on success; the toast itself is not what this file
// asserts, and a real one needs a mounted <Toaster />.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const surface = { deploymentPayer: true as boolean, isLoading: false }
vi.mock("@/hooks/use-billing-surface", () => ({
  useBillingSurface: () => ({ surface, isLoading: surface.isLoading }),
}))

const {
  useDeploymentBillingUsers,
  useDeploymentPayerViewer,
  useDeploymentBillingTransactions,
  useUserGrants,
  useIntegrationKeys,
  useMintIntegrationKeyMutation,
  useRevokeIntegrationKeyMutation,
  useDeploymentBalance,
  useSetBalanceThresholdMutation,
  errorMessageKey,
  DeploymentBillingError,
} = await import("@/ee/hooks/queries/use-deployment-billing")

// ── WS4's bodies, verbatim ─────────────────────────────────────────────────

const OVERVIEW_BODY = {
  data: {
    payer: {
      balanceCredits: 12_345, subscriptionCredits: 300, topupCredits: 12_045,
      tier: "pro", periodEnd: "2026-10-01T00:00:00.000Z",
    },
    burn: { periodStart: "2026-09-01T00:00:00.000Z", credits: 987, generations: 42, capped: false },
    defaultAllowance: { credits: 200, units: 400_000 },
    users: { total: 37, provisioned: 12 },
    unit: { label: "קרדיטים", rate: 2000, decimals: 0 },
    allowancesEnforced: false,
    stripeConfigured: true,
  },
}

// NOTE THE SHAPE: `total`/`limit`/`offset`/`unit` are siblings of `data`.
const USERS_BODY = {
  data: [
    { id: "u1", email: "a@x.com", full_name: null, created_at: "2026-08-01T00:00:00.000Z", granted: 400_000, remaining: 399_000, spent: 1_000, provisioned: true },
    { id: "u2", email: "b@x.com", full_name: null, created_at: "2026-08-02T00:00:00.000Z", granted: 400_000, remaining: 400_000, spent: 0, provisioned: false },
    { id: "u3", email: "c@x.com", full_name: null, created_at: "2026-08-03T00:00:00.000Z", granted: null, remaining: null, spent: null, provisioned: false },
  ],
  total: 37,
  limit: 50,
  offset: 0,
  unit: { label: "קרדיטים", rate: 2000, decimals: 0 },
}

const GRANTS_BODY = {
  data: {
    user: { id: "u1", granted: 400_000, remaining: 399_000, spent: 1_000, provisioned: true },
    grants: [{ id: "g1", units: 400_000, kind: "default", note: null, createdAt: "2026-08-01T00:00:00.000Z" }],
    limit: 50, offset: 0, unit: { label: "קרדיטים", rate: 2000, decimals: 0 },
  },
}

const TX_BODY = { data: { purchases: [{ id: "t1" }], ledger: [{ id: "l1" }], limit: 50, offset: 0 } }

// The billing-integration bodies. `GET /integration-keys` carries a PREFIX and
// never a bearer; `POST` is the one body in the whole API that carries one.
const KEYS_BODY = {
  data: [
    {
      id: "k1", name: "back office", tokenPrefix: "ndr_bill_9f3",
      createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2099-09-01T00:00:00.000Z",
      lastUsedAt: "2026-09-05T00:00:00.000Z", revokedAt: null, allowedCidrs: ["203.0.113.0/24"],
    },
  ],
}

const MINT_BODY = {
  data: {
    id: "k2", name: "new one",
    token: "ndr_bill_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd",
    tokenPrefix: "ndr_bill_012", expiresAt: null,
  },
}

const REVOKE_BODY = { data: { id: "k1", revoked: true } }

const BALANCE_BODY = {
  data: {
    balanceCredits: 41_250,
    burn: { periodStart: "2026-09-01T00:00:00.000Z", credits: 3_180, generations: 412, capped: false },
    periodEnd: null,
    lowBalance: true,
    threshold: 50_000,
  },
}

const THRESHOLD_BODY = { data: { threshold: 10_000 } }

function reply(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body } as Response)
}

let fetchMock: ReturnType<typeof vi.fn>

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  surface.deploymentPayer = true
  surface.isLoading = false
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.startsWith("/v1/deployment-billing/overview")) return reply(OVERVIEW_BODY)
    if (url.startsWith("/v1/deployment-billing/users/")) return reply(GRANTS_BODY)
    if (url.startsWith("/v1/deployment-billing/users")) return reply(USERS_BODY)
    if (url.startsWith("/v1/deployment-billing/transactions")) return reply(TX_BODY)
    // The longer paths FIRST, exactly as `users/` precedes `users` above.
    if (url.startsWith("/v1/deployment-billing/integration-keys/")) return reply(REVOKE_BODY)
    if (url.startsWith("/v1/deployment-billing/integration-keys"))
      return reply(init?.method === "POST" ? MINT_BODY : KEYS_BODY, init?.method === "POST" ? 201 : 200)
    if (url.startsWith("/v1/deployment-billing/balance/threshold")) return reply(THRESHOLD_BODY)
    if (url.startsWith("/v1/deployment-billing/balance")) return reply(BALANCE_BODY)
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("GET /users — the envelope IS the page", () => {
  it("keeps total, limit, offset and unit, which sit beside `data`", async () => {
    const { result } = renderHook(() => useDeploymentBillingUsers(true, "", 0), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data).toHaveLength(3)
    expect(result.current.data?.total).toBe(37)
    expect(result.current.data?.unit?.rate).toBe(2000)
  })

  it("sends the search term url-encoded, and only when there is one", async () => {
    const { result } = renderHook(() => useDeploymentBillingUsers(true, "  אלפא  ", 0), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(String(fetchMock.mock.calls[0][0])).toContain(`search=${encodeURIComponent("אלפא")}`)
  })
})

describe("GET /overview — the probe and the pool", () => {
  it("a 200 makes the viewer the payer and carries the RAW pool figures through", async () => {
    const { result } = renderHook(() => useDeploymentPayerViewer(), { wrapper })
    await waitFor(() => expect(result.current.probe).toBe("payer"))
    expect(result.current.isPayer).toBe(true)
    expect(result.current.overview?.payer.balanceCredits).toBe(12_345)
    expect(result.current.overview?.unit?.rate).toBe(2000)
  })

  it("a 403 settles to not-payer — the guard's refusal is the identity answer", async () => {
    fetchMock.mockImplementation(() =>
      reply({ error: { code: "payer_required", message: "no" } }, 403),
    )
    const { result } = renderHook(() => useDeploymentPayerViewer(), { wrapper })
    await waitFor(() => expect(result.current.probe).toBe("not-payer"))
    expect(result.current.isPayer).toBe(false)
    expect(result.current.errorStatus).toBe(403)
    // Fail-closed, but distinguishable: a definitive refusal is NOT a fault.
    expect(result.current.faulted).toBe(false)
  })

  it("a 500 is reported as a read fault, so the page does not say 'you are not the payer'", async () => {
    fetchMock.mockImplementation(() => reply({ error: { code: "read_failed", message: "no" } }, 500))
    const { result } = renderHook(() => useDeploymentPayerViewer(), { wrapper })
    await waitFor(() => expect(result.current.errorStatus).toBe(500))
    expect(result.current.faulted).toBe(true)
  })

  it("a REJECTED fetch is a read fault too, even though it has no status (F9)", async () => {
    // DNS, a killed connection, a blocked preflight: `fetch` rejects, so
    // `requestRaw` never reaches `if (!res.ok)` and no DeploymentBillingError
    // is ever built. `errorStatus` is 0 — indistinguishable from "no error" —
    // which is why the page must key off `faulted` and never off the status.
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")))
    const { result } = renderHook(() => useDeploymentPayerViewer(), { wrapper })
    await waitFor(() => expect(result.current.faulted).toBe(true))
    expect(result.current.errorStatus).toBe(0)
    expect(result.current.probe).toBe("not-payer")
  })

  it("MAINLINE (R2): with no payer on the deployment the probe issues NO request at all", async () => {
    surface.deploymentPayer = false
    const { result } = renderHook(() => useDeploymentPayerViewer(), { wrapper })
    await waitFor(() => expect(result.current.probe).toBe("not-payer"))
    expect(fetchMock).not.toHaveBeenCalled()
    // The regression guard for the page-side alternative: a deployment with no
    // payer must land on the notPayer sentence, never on the fault one.
    expect(result.current.faulted).toBe(false)
  })

  it("a healthy 200 is not faulted", async () => {
    const { result } = renderHook(() => useDeploymentPayerViewer(), { wrapper })
    await waitFor(() => expect(result.current.probe).toBe("payer"))
    expect(result.current.faulted).toBe(false)
  })

  it("stays pending while the billing surface itself is loading", async () => {
    surface.isLoading = true
    const { result } = renderHook(() => useDeploymentPayerViewer(), { wrapper })
    // Acting on the surface's `false` default would flash the not-the-payer
    // copy at the payer on every load.
    expect(result.current.probe).toBe("pending")
    expect(result.current.isPayer).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("the wrapped routes", () => {
  it("GET /transactions unwraps `data`", async () => {
    const { result } = renderHook(() => useDeploymentBillingTransactions(true), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.purchases).toHaveLength(1)
    expect(result.current.data?.ledger).toHaveLength(1)
  })

  it("GET /users/:id/grants unwraps `data` and keeps the kind", async () => {
    const { result } = renderHook(() => useUserGrants("u1"), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.grants[0].kind).toBe("default")
    expect(result.current.data?.user.provisioned).toBe(true)
  })

  it("does not fetch a grant history for nobody", () => {
    renderHook(() => useUserGrants(null), { wrapper })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * The note's own refusals (F10).
 *
 * The grant route judges the UNITS first and the NOTE second, and it now says
 * which failed: `note_too_long` / `invalid_note`. Before that split, a valid
 * amount with a 501-character note came back as `invalid_units` — "Enter a
 * whole number" — pointing the payer at the one field that was fine. Leaving
 * these two to fall through to `errGeneric` puts the same blindfold back on:
 * "The action did not complete" names no field either.
 */
describe("errorMessageKey — the note's refusals reach the payer as the note's", () => {
  const err = (code: string) => new DeploymentBillingError(400, code, "developer-facing English")

  it("maps note_too_long to the note's own sentence", () => {
    expect(errorMessageKey(err("note_too_long"))).toBe("billingAdmin.errNoteTooLong")
  })

  it("maps invalid_note to the note's own sentence", () => {
    expect(errorMessageKey(err("invalid_note"))).toBe("billingAdmin.errInvalidNote")
  })

  it("still names the UNITS when the units are what failed", () => {
    // Non-vacuity in the direction that regressed: the two codes must not have
    // been wired by widening the units case.
    expect(errorMessageKey(err("invalid_units"))).toBe("billingAdmin.errInvalidUnits")
  })

  it("leaves an unrecognised code on the generic sentence", () => {
    expect(errorMessageKey(err("something_new"))).toBe("billingAdmin.errGeneric")
  })
})


/**
 * The billing-integration credential, on the wire.
 *
 * The bearer exists in exactly ONE response body, once — so the
 * hooks must not put it anywhere that outlives the panel showing it, and above
 * all the mint call must not be something a re-render can repeat. A component
 * that re-issued the POST on every render would mint a key per paint, blow
 * through the five-key cap, and leave four bearers nobody ever saw.
 */
describe("the integration keys — the bearer travels once", () => {
  it("GET /integration-keys unwraps `data` and carries no token on any row", async () => {
    const { result } = renderHook(() => useIntegrationKeys(true), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0].tokenPrefix).toBe("ndr_bill_9f3")
    // The route never selects `token_hash` and never returns a bearer; a row
    // that grew one would be the leak this asserts against.
    expect(JSON.stringify(result.current.data)).not.toMatch(/ndr_bill_[0-9a-f]{64}/)
  })

  it("POST mints once, and RE-RENDERING never mints again", async () => {
    const { result, rerender } = renderHook(() => useMintIntegrationKeyMutation(), { wrapper })
    result.current.mutate({ name: "back office" })
    await waitFor(() => expect(result.current.data?.token).toBeTruthy())

    const posts = () =>
      fetchMock.mock.calls.filter(
        (c) => String(c[0]).includes("/integration-keys") && (c[1] as RequestInit)?.method === "POST",
      )
    expect(posts()).toHaveLength(1)
    expect(JSON.parse(String((posts()[0][1] as RequestInit).body))).toEqual({ name: "back office" })

    // The claim: the bearer is a MUTATION result, not a query. Nothing about
    // painting the panel again re-issues the call that produced it.
    rerender()
    rerender()
    expect(posts()).toHaveLength(1)
    expect(result.current.data?.token).toBe(MINT_BODY.data.token)
  })

  it("sends the optional expiry and source ranges through untouched", async () => {
    const { result } = renderHook(() => useMintIntegrationKeyMutation(), { wrapper })
    result.current.mutate({
      name: "back office",
      expiresAt: "2099-01-31T00:00:00.000Z",
      allowedCidrs: ["10.0.0.0/8"],
    })
    await waitFor(() => expect(result.current.data?.token).toBeTruthy())
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "POST")!
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({
      name: "back office",
      expiresAt: "2099-01-31T00:00:00.000Z",
      allowedCidrs: ["10.0.0.0/8"],
    })
  })

  it("revoking is a DELETE on that key's own path", async () => {
    const { result } = renderHook(() => useRevokeIntegrationKeyMutation(), { wrapper })
    result.current.mutate({ id: "k1" })
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === "DELETE"),
      ).toBe(true),
    )
    const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE")!
    expect(String(del[0])).toBe("/v1/deployment-billing/integration-keys/k1")
  })

  it("the five-key refusal arrives as its own code, not as a generic failure", () => {
    expect(errorMessageKey(new DeploymentBillingError(409, "key_limit_reached", "no"))).toBe(
      "billingAdmin.errKeyLimitReached",
    )
  })
})

describe("GET /balance — the pool for a machine, and the payer's own alert", () => {
  it("unwraps `data` and keeps the threshold and the flag", async () => {
    const { result } = renderHook(() => useDeploymentBalance(true), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // RAW Nodaro credits — the one figure in this API that is not display units.
    expect(result.current.data?.balanceCredits).toBe(41_250)
    expect(result.current.data?.lowBalance).toBe(true)
    expect(result.current.data?.threshold).toBe(50_000)
  })

  it("PUT /balance/threshold sends whole credits", async () => {
    const { result } = renderHook(() => useSetBalanceThresholdMutation(), { wrapper })
    result.current.mutate({ credits: 10_000 })
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === "PUT")).toBe(true),
    )
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "PUT")!
    expect(String(put[0])).toBe("/v1/deployment-billing/balance/threshold")
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({ credits: 10_000 })
  })

  it("clearing the threshold sends null, not 0 — 0 is a real threshold", async () => {
    // `low_balance_threshold_credits` is `integer NULL CHECK (>= 0)`: 0 means
    // "warn me when the pool is empty", NULL means "do not warn me". Sending 0
    // for "cleared" would arm an alert the payer just turned off.
    const { result } = renderHook(() => useSetBalanceThresholdMutation(), { wrapper })
    result.current.mutate({ credits: null })
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === "PUT")).toBe(true),
    )
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "PUT")!
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({ credits: null })
  })
})
