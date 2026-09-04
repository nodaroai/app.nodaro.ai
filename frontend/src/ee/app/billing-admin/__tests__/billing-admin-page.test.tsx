import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { en } from "@/lib/i18n/en"
import { he } from "@/lib/i18n/he"
import { useLocaleStore } from "@/lib/locale-store"
import { isDeploymentPayer } from "@/lib/surface-selectors"
import { ENTRY_BY_LINK } from "@/lib/surface-nav-registry"
import { unitsInputError, orDash } from "../units"
import type {
  DeploymentBillingOverview,
  DeploymentUsersPage,
  UserGrantsPage,
  DeploymentTransactions,
} from "@/ee/hooks/queries/use-deployment-billing"

/**
 * Track A — the BILLING ACCOUNT's page (`/billing-admin`, spec §9.3).
 *
 * Five blocks, and every one of them is a place where a wrong number is
 * expensive rather than merely ugly:
 *
 *  1. The POOL is raw Nodaro credits — the only place in the product that
 *     renders them — and must be LABELLED as Nodaro's. Converting it to the
 *     customer's unit would invent an exchange rate for money that is not
 *     being exchanged.
 *  2. Every PER-USER figure is display units, converted by the SERVER. The page
 *     never multiplies by `unitRate` (R3).
 *  3. `null` is an em dash, never 0: on an allowance, 0 means "exhausted, this
 *     person cannot generate", and manufacturing it turns "we could not read
 *     this" into a refusal.
 *  4. A user with `provisioned: false` has no row yet and the three figures are
 *     the DEFAULT they will actually be given at their first Generate (D7) —
 *     real numbers, not an em dash.
 *  5. RTL (R5): logical properties only, and the remaining/granted pair is
 *     never a bare `X / Y` — under RTL the two numbers swap sides and the
 *     sentence lies.
 */

// ── Fixtures ────────────────────────────────────────────────────────────────

const UNIT = { label: "קרדיטים", rate: 2000, decimals: 0 } as const

const overview: DeploymentBillingOverview = {
  payer: {
    balanceCredits: 12_345,
    subscriptionCredits: 300,
    topupCredits: 12_045,
    tier: "pro",
    periodEnd: "2026-10-01T00:00:00.000Z",
  },
  burn: { periodStart: "2026-09-01T00:00:00.000Z", credits: 987, generations: 42, capped: false },
  defaultAllowance: { credits: 200, units: 400_000 },
  users: { total: 37, provisioned: 12 },
  unit: { ...UNIT },
  allowancesEnforced: false,
  stripeConfigured: true,
}

const usersPage: DeploymentUsersPage = {
  data: [
    {
      id: "u1", email: "alpha@example.com", full_name: "Alpha",
      created_at: "2026-08-01T00:00:00.000Z",
      granted: 400_000, remaining: 399_000, spent: 1_000, provisioned: true,
    },
    {
      id: "u2", email: "beta@example.com", full_name: null,
      created_at: "2026-08-02T00:00:00.000Z",
      granted: 400_000, remaining: 400_000, spent: 0, provisioned: false,
    },
    {
      id: "u3", email: "gamma@example.com", full_name: null,
      created_at: "2026-08-03T00:00:00.000Z",
      granted: null, remaining: null, spent: null, provisioned: false,
    },
  ],
  total: 37,
  limit: 50,
  offset: 0,
  unit: { ...UNIT },
}

const grantsPage: UserGrantsPage = {
  user: { id: "u1", granted: 400_000, remaining: 399_000, spent: 1_000, provisioned: true },
  grants: [
    { id: "g1", units: 400_000, kind: "default", note: null, createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "g2", units: -2_000, kind: "overrun", note: null, createdAt: "2026-08-05T00:00:00.000Z" },
  ],
  limit: 50,
  offset: 0,
  unit: { ...UNIT },
}

const transactions: DeploymentTransactions = { purchases: [], ledger: [], limit: 50, offset: 0 }

// ── Module mocks ────────────────────────────────────────────────────────────
// The page reads EVERYTHING through its own hook module, so the test needs no
// QueryClientProvider and never touches fetch. `importOriginal` keeps the pure
// exports (types, helpers) real.

const grantMutate = vi.fn()
const defaultMutate = vi.fn()
const checkoutMutate = vi.fn()
const refresh = vi.fn()

const usersRefetch = vi.fn()
const txRefetch = vi.fn()
const grantsRefetch = vi.fn()

const state = {
  probe: "payer" as "pending" | "payer" | "not-payer",
  hasPayer: true as boolean | undefined,
  overview: overview as DeploymentBillingOverview | undefined,
  errorStatus: 0,
  /** The probe errored for a reason that is NOT a 4xx refusal (F9). */
  faulted: false,
  /** Each list read, independently: the page's three tables are three
   *  separate queries against three separate routes, all `retry: false`. */
  usersFailed: false,
  /** A SUCCESSFUL read that genuinely matched nobody — the answer the failure
   *  line must not swallow. */
  usersEmptyResult: false,
  txFailed: false,
  grantsFailed: false,
}

vi.mock("@/ee/hooks/queries/use-deployment-billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ee/hooks/queries/use-deployment-billing")>()
  return {
    ...actual,
    useDeploymentPayerViewer: () => ({
      probe: state.probe,
      isPayer: state.hasPayer === true && state.probe === "payer",
      overview: state.probe === "payer" ? state.overview : undefined,
      errorStatus: state.errorStatus,
      faulted: state.faulted,
    }),
    // A failed query has NO data and `isLoading: false` — that pairing is the
    // whole bug class: `data?.x ?? []` then renders the empty state.
    useDeploymentBillingUsers: () => ({
      data: state.usersFailed
        ? undefined
        : state.usersEmptyResult
          ? { ...usersPage, data: [], total: 0 }
          : usersPage,
      isLoading: false,
      isError: state.usersFailed,
      refetch: usersRefetch,
    }),
    useDeploymentBillingTransactions: () => ({
      data: state.txFailed ? undefined : transactions,
      isLoading: false,
      isError: state.txFailed,
      refetch: txRefetch,
    }),
    useUserGrants: () => ({
      data: state.grantsFailed ? undefined : grantsPage,
      isLoading: false,
      isError: state.grantsFailed,
      refetch: grantsRefetch,
    }),
    useGrantAllowanceMutation: () => ({ mutate: grantMutate, isPending: false }),
    useSetDefaultAllowanceMutation: () => ({ mutate: defaultMutate, isPending: false }),
    useDeploymentCheckoutMutation: () => ({ mutate: checkoutMutate, isPending: false }),
    useDeploymentBillingRefresh: () => refresh,
  }
})

vi.mock("@/ee/components/billing/ConnectedInstances", () => ({
  ConnectedInstances: () => <div data-testid="connected-instances-stub" />,
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Imported AFTER the mocks so the page picks them up.
const { default: BillingAdminPage } = await import("../page")

function renderPage(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/billing-admin${search}`]}>
      <BillingAdminPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  state.probe = "payer"
  state.hasPayer = true
  state.overview = overview
  state.errorStatus = 0
  state.faulted = false
  state.usersFailed = false
  state.usersEmptyResult = false
  state.txFailed = false
  state.grantsFailed = false
  useLocaleStore.setState({ locale: "he" })
})

// ── The viewer flag ─────────────────────────────────────────────────────────

describe("isDeploymentPayer — the viewer flag (fail-closed)", () => {
  it("is false while the probe has not settled", () => {
    expect(isDeploymentPayer(true, "pending")).toBe(false)
  })

  it("is false when the deployment has no payer at all, whatever the probe says", () => {
    // Mainline: `deploymentPayer` is false and the routes are not registered,
    // so the probe can never legitimately answer "payer" — but the flag must
    // not depend on that being true.
    expect(isDeploymentPayer(false, "payer")).toBe(false)
    expect(isDeploymentPayer(undefined, "payer")).toBe(false)
  })

  it("is false for every settled non-payer answer (403/404/network all land here)", () => {
    expect(isDeploymentPayer(true, "not-payer")).toBe(false)
  })

  it("is true only for a payer deployment AND a probe that came back 200", () => {
    expect(isDeploymentPayer(true, "payer")).toBe(true)
  })
})

describe("the route is classified for the orphan guard", () => {
  it("/billing-admin is link-only (no surface nav key gates it)", () => {
    expect(ENTRY_BY_LINK).toContain("/billing-admin")
  })
})

// ── The pure unit validator (mirrors the server's 400) ──────────────────────

describe("unitsInputError — the client-side mirror of the server's whole-credits rule", () => {
  it("accepts a whole multiple of the rate", () => {
    expect(unitsInputError("4000", UNIT)).toBeNull()
  })

  it("refuses a figure that is not a whole number of Nodaro credits", () => {
    // 1234 / 2000 is not an integer: the ledger is an INTEGER credit column, so
    // there is no row that could represent it. The server 400s; the page must
    // say so before the round trip.
    expect(unitsInputError("1234", UNIT)).toBe("not_whole_credits")
  })

  it("refuses zero and non-numbers", () => {
    expect(unitsInputError("0", UNIT)).toBe("zero")
    expect(unitsInputError("abc", UNIT)).toBe("not_a_number")
    expect(unitsInputError("2000.5", UNIT)).toBe("not_a_number")
    expect(unitsInputError("", UNIT)).toBe("empty")
  })

  it("refuses a negative unless the caller allows a correction", () => {
    expect(unitsInputError("-4000", UNIT)).toBe("negative")
    expect(unitsInputError("-4000", UNIT, { allowNegative: true })).toBeNull()
  })

  it("refuses everything when the deployment has no display unit", () => {
    // The server answers `unit_not_configured` here; treating a unit as a
    // credit would be a 2000-fold over-allocation.
    expect(unitsInputError("4000", null)).toBe("unit_not_configured")
  })

  it("orDash never manufactures a zero", () => {
    expect(orDash(null)).toBe("—")
    expect(orDash(undefined)).toBe("—")
    expect(orDash(0)).toBe("0")
  })
})

// ── The page ────────────────────────────────────────────────────────────────

describe("who may see the page", () => {
  it("a non-payer viewer gets the refusal copy and NO pool figure", () => {
    state.probe = "not-payer"
    const { container } = renderPage()
    expect(screen.getByText(he["billingAdmin.notPayer"] as string)).toBeInTheDocument()
    expect(container.textContent).not.toContain("12,345")
  })

  it("a 5xx is reported as a read failure, not as 'you are not the payer'", () => {
    state.probe = "not-payer"
    state.errorStatus = 500
    state.faulted = true
    renderPage()
    expect(screen.getByText(he["billingAdmin.loadError"] as string)).toBeInTheDocument()
  })

  it("a probe that never reached the server is ALSO a read failure (F9)", () => {
    // A rejected fetch — DNS, a killed connection, a blocked preflight — never
    // reaches `if (!res.ok)`, so there is no status at all. Keying the page on
    // `errorStatus >= 500` told the real billing account it is not the billing
    // account whenever the network coughed.
    state.probe = "not-payer"
    state.errorStatus = 0
    state.faulted = true
    renderPage()
    expect(screen.getByText(he["billingAdmin.loadError"] as string)).toBeInTheDocument()
    expect(screen.queryByText(he["billingAdmin.notPayer"] as string)).toBeNull()
  })

  it("a 403 still means 'you are not the payer' — the guard's refusal is an answer", () => {
    state.probe = "not-payer"
    state.errorStatus = 403
    state.faulted = false
    renderPage()
    expect(screen.getByText(he["billingAdmin.notPayer"] as string)).toBeInTheDocument()
  })

  it("MAINLINE: no payer, no error, still the not-the-payer sentence", () => {
    state.hasPayer = false
    state.probe = "not-payer"
    renderPage()
    expect(screen.getByText(he["billingAdmin.notPayer"] as string)).toBeInTheDocument()
  })

  it("the payer sees the page", () => {
    renderPage()
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(he["billingAdmin.title"] as string)
  })
})

describe("block 1 — the pool, in RAW Nodaro credits and labelled as Nodaro's", () => {
  it("renders the balance unconverted", () => {
    const { container } = renderPage()
    const pool = container.querySelector("[data-testid='pool-block']")!
    expect(pool.textContent).toContain("12,345")
    // The unit label must NOT ride along with a raw figure: 12,345 credits is
    // not 12,345 SAI units, and putting the customer's label beside it is the
    // exact confusion §9.3 block 1 exists to prevent.
    expect(pool.textContent).toContain(he["billingAdmin.poolNote"] as string)
  })

  it("burn and the user counts come through, with the unprovisioned remainder spelled out", () => {
    const { container } = renderPage()
    const pool = container.querySelector("[data-testid='pool-block']")!
    expect(pool.textContent).toContain("987")
    expect(pool.textContent).toContain("42")
    // 37 total, 12 with a row ⇒ 25 will be provisioned at the default.
    expect(pool.textContent).toContain("25")
  })

  it("says nothing is refused yet while enforcement is off", () => {
    renderPage()
    expect(screen.getByText(he["billingAdmin.enforcementOff"] as string)).toBeInTheDocument()
  })

  it("says the opposite once the deployment has flipped", () => {
    state.overview = { ...overview, allowancesEnforced: true }
    renderPage()
    expect(screen.getByText(he["billingAdmin.enforcementOn"] as string)).toBeInTheDocument()
  })

  it("an unavailable pool figure is an em dash, never a zero", () => {
    state.overview = {
      ...overview,
      payer: { ...overview.payer, balanceCredits: null, subscriptionCredits: null, topupCredits: null },
    }
    const { container } = renderPage()
    // The FIGURE itself, not the block: the block's own copy contains an em
    // dash as punctuation, which would pass a textContent check vacuously.
    expect(container.querySelector("[data-testid='pool-balance']")!.textContent).toBe("—")
    expect(container.querySelector("[data-testid='pool-block']")!.textContent).not.toContain("12,345")
  })
})

describe("block 3 — the default allocation", () => {
  it("carries the D7 sentence: this moves nobody who has already generated", () => {
    renderPage()
    expect(screen.getByText(he["billingAdmin.defaultNote"] as string)).toBeInTheDocument()
  })

  it("shows the live default in UNITS and saves it in units", () => {
    const { container } = renderPage()
    const block = container.querySelector("[data-testid='default-block']")!
    const input = block.querySelector("input")!
    expect((input as HTMLInputElement).value).toBe("400000")
    fireEvent.change(input, { target: { value: "600000" } })
    fireEvent.click(screen.getByRole("button", { name: he["billingAdmin.defaultSave"] as string }))
    expect(defaultMutate).toHaveBeenCalledWith({ units: 600_000 })
  })

  it("refuses a non-multiple of the rate client-side and never calls the mutation", () => {
    const { container } = renderPage()
    const block = container.querySelector("[data-testid='default-block']")!
    fireEvent.change(block.querySelector("input")!, { target: { value: "1234" } })
    fireEvent.click(screen.getByRole("button", { name: he["billingAdmin.defaultSave"] as string }))
    expect(defaultMutate).not.toHaveBeenCalled()
    expect(block.textContent).toContain(
      (he["billingAdmin.errNotWholeCredits"] as string).replace("{rate}", "2,000").replace("{unit}", "קרדיטים"),
    )
  })
})

describe("block 4 — the per-user table", () => {
  it("renders per-user figures in units", () => {
    const { container } = renderPage()
    const table = container.querySelector("[data-testid='users-block']")!
    expect(table.textContent).toContain("399,000")
    expect(table.textContent).toContain("1,000")
  })

  it("a user with no allowance row shows the DEFAULT, not an em dash (the first-Generate rule)", () => {
    const { container } = renderPage()
    const row = container.querySelector("[data-testid='user-row-u2']")!
    // All THREE figures, one by one: this user has no row yet, and what the
    // server sent is the default they will actually be given at their first
    // Generate (D7). An em dash in any column here reads as "this person has
    // nothing", which is the opposite of true.
    const figures = [...row.querySelectorAll("[data-testid='allowance-figures'] dd")]
    expect(figures.map((d) => d.textContent)).toEqual(["400,000", "400,000", "0"])
    expect(row.textContent).toContain(he["billingAdmin.notProvisioned"] as string)
  })

  it("a figure the server could not read is an em dash, never a zero", () => {
    const { container } = renderPage()
    const row = container.querySelector("[data-testid='user-row-u3']")!
    // Each of the three figures, not the row: the row's "not provisioned" copy
    // carries an em dash of its own, so a textContent check would be vacuous.
    const figures = [...row.querySelectorAll("[data-testid='allowance-figures'] dd")]
    expect(figures.map((d) => d.textContent)).toEqual(["—", "—", "—"])
  })

  it("never renders the remaining/granted pair as a bare `X / Y`", () => {
    const { container } = renderPage()
    const groups = container.querySelectorAll("[data-testid='allowance-figures']")
    // Non-vacuity: a selector that matched nothing would pass this loop happily.
    expect(groups.length).toBe(3)
    for (const el of groups) {
      expect(el.textContent ?? "").not.toMatch(/\d\s*\/\s*\d/)
    }
  })

  it("a top-up validates client-side before it is sent", () => {
    const { container } = renderPage()
    fireEvent.click(container.querySelector("[data-testid='topup-open-u1']")!)
    const form = container.querySelector("[data-testid='topup-form-u1']")!
    fireEvent.change(form.querySelector("input")!, { target: { value: "1234" } })
    fireEvent.click(form.querySelector("[data-testid='topup-submit-u1']")!)
    expect(grantMutate).not.toHaveBeenCalled()
  })

  it("a valid top-up is sent in UNITS, with the note", () => {
    const { container } = renderPage()
    fireEvent.click(container.querySelector("[data-testid='topup-open-u1']")!)
    const form = container.querySelector("[data-testid='topup-form-u1']")!
    fireEvent.change(form.querySelector("input")!, { target: { value: "4000" } })
    fireEvent.change(form.querySelector("textarea")!, { target: { value: "extra work" } })
    fireEvent.click(form.querySelector("[data-testid='topup-submit-u1']")!)
    // The second argument is the per-call `onSuccess` that closes the row (F13).
    expect(grantMutate).toHaveBeenCalledWith(
      { userId: "u1", units: 4_000, note: "extra work" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it("caps the grant note at the server's 500 characters, so the cap is not discovered by refusal", () => {
    // F10. The route judges the units first and the note second, and refuses an
    // over-long note with its own `note_too_long`. Without this attribute the
    // payer types a long note, presses the button, and loses the whole grant to
    // a server refusal — the cap is invisible until it bites.
    const { container } = renderPage()
    fireEvent.click(container.querySelector("[data-testid='topup-open-u1']")!)
    const note = container.querySelector("[data-testid='topup-form-u1'] textarea")!
    expect(note.getAttribute("maxlength")).toBe("500")
  })

  it("says how many characters are left as the note approaches the cap, and never as `X / Y`", () => {
    // A silent cap just stops accepting keys. The hint is one number inside a
    // translated sentence: an `X / Y` counter inverts under RTL, which is the
    // same rule the allowance figures above follow.
    const { container } = renderPage()
    fireEvent.click(container.querySelector("[data-testid='topup-open-u1']")!)
    const form = container.querySelector("[data-testid='topup-form-u1']")!
    expect(form.querySelector("[data-testid='topup-note-left-u1']")).toBeNull()

    fireEvent.change(form.querySelector("textarea")!, { target: { value: "x".repeat(495) } })
    const hint = container.querySelector("[data-testid='topup-note-left-u1']")!
    expect(hint.textContent).toContain("5")
    expect(hint.textContent ?? "").not.toMatch(/\d\s*\/\s*\d/)
  })

  it("the grant history labels an overrun row and says it is excluded from the granted total", () => {
    const { container } = renderPage()
    fireEvent.click(container.querySelector("[data-testid='grants-open-u1']")!)
    const history = container.querySelector("[data-testid='grants-u1']")!
    expect(history.textContent).toContain(he["billingAdmin.kindOverrun"] as string)
    expect(history.textContent).toContain(he["billingAdmin.overrunNote"] as string)
  })
})

describe("block 5 — the card", () => {
  it("renders the disabled state with the exact copy when Stripe is not configured", () => {
    state.overview = { ...overview, stripeConfigured: false }
    const { container } = renderPage()
    const card = container.querySelector("[data-testid='card-block']")!
    expect(card.textContent).toContain("רכישה בכרטיס אינה מוגדרת בשרת זה")
    expect(card.querySelector("button")).toBeDisabled()
  })

  it("quotes the purchase in RAW Nodaro credits and starts the session in whole dollars", () => {
    const { container } = renderPage()
    const card = container.querySelector("[data-testid='card-block']")!
    fireEvent.change(card.querySelector("input")!, { target: { value: "100" } })
    // $100 → 36,000 credits through the shared load-rate mirror.
    expect(card.textContent).toContain("36,000")
    fireEvent.click(card.querySelector("button")!)
    expect(checkoutMutate).toHaveBeenCalledWith({ amountUsd: 100 })
  })

  it("refuses an amount outside the platform's range without a round trip", () => {
    const { container } = renderPage()
    const card = container.querySelector("[data-testid='card-block']")!
    fireEvent.change(card.querySelector("input")!, { target: { value: "2000" } })
    fireEvent.click(card.querySelector("button")!)
    expect(checkoutMutate).not.toHaveBeenCalled()
  })
})

describe("the return from Stripe", () => {
  it("?topup=true shows the receipt banner and refetches the pool", () => {
    renderPage("?topup=true")
    expect(screen.getByText(he["billingAdmin.topupSuccess"] as string)).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })
})

describe("the relay keys the payer can otherwise never reach", () => {
  it("mounts Connected Instances on this page", () => {
    // Track B: `/billing` is not registered under `selfServe:false`, so the ONE
    // component that shows and revokes a relay key is unreachable on this
    // instance. It is mounted here or nowhere.
    renderPage()
    expect(screen.getByTestId("connected-instances-stub")).toBeInTheDocument()
  })
})

describe("a failed LIST read is never rendered as a definite empty (F8)", () => {
  it("the user table says the read failed instead of 'no users match this search'", () => {
    state.usersFailed = true
    const { container } = renderPage()
    const table = container.querySelector("[data-testid='users-block']")!
    expect(table.textContent).toContain(he["billingAdmin.listError"] as string)
    expect(table.textContent).not.toContain(he["billingAdmin.usersEmpty"] as string)
  })

  it("and suppresses the 0 of 0 counter, which is a second manufactured fact", () => {
    state.usersFailed = true
    const { container } = renderPage()
    const counter = container.querySelector("[data-testid='users-showing']")
    expect(counter?.textContent ?? "").toBe("—")
  })

  it("offers a retry that refetches the list", () => {
    // Load-bearing, not decoration: these queries are `retry: false`, so
    // without a button the payer's only recovery is a full page reload.
    state.usersFailed = true
    const { container } = renderPage()
    fireEvent.click(container.querySelector("[data-testid='users-retry']")!)
    expect(usersRefetch).toHaveBeenCalled()
  })

  it("R5 — the failure markup is logical-property only, like the happy path", () => {
    // The RTL check further down only ever runs on a successful render, so the
    // error branch's markup would otherwise never be under it.
    state.usersFailed = true
    state.txFailed = true
    state.grantsFailed = true
    const { container } = renderPage()
    expect(container.innerHTML).not.toMatch(/\b(ml|mr|pl|pr)-\d/)
  })

  it("a genuine empty page still reads as empty, and still counts", () => {
    // The failure line must not eat the honest answer: a 200 with zero rows is
    // a real "nobody matched", and its counter is a real 0.
    state.usersEmptyResult = true
    const { container } = renderPage()
    const table = container.querySelector("[data-testid='users-block']")!
    expect(table.textContent).toContain(he["billingAdmin.usersEmpty"] as string)
    expect(table.textContent).not.toContain(he["billingAdmin.listError"] as string)
    expect(container.querySelector("[data-testid='users-showing']")!.textContent).not.toBe("—")
  })

  it("the transactions block says the read failed instead of 'no purchases yet'", () => {
    state.txFailed = true
    const { container } = renderPage()
    const block = container.querySelector("[data-testid='transactions-block']")!
    expect(block.textContent).toContain(he["billingAdmin.listError"] as string)
    expect(block.textContent).not.toContain(he["billingAdmin.txEmpty"] as string)
    expect(block.textContent).not.toContain(he["billingAdmin.ledgerEmpty"] as string)
  })

  it("the transactions retry refetches", () => {
    state.txFailed = true
    const { container } = renderPage()
    fireEvent.click(container.querySelector("[data-testid='transactions-retry']")!)
    expect(txRefetch).toHaveBeenCalled()
  })

  it("the grant history says the read failed instead of 'no grants yet'", () => {
    state.grantsFailed = true
    const { container } = renderPage()
    fireEvent.click(container.querySelector("[data-testid='grants-open-u1']")!)
    const history = container.querySelector("[data-testid='grants-u1']")!
    expect(history.textContent).toContain(he["billingAdmin.listError"] as string)
    expect(history.textContent).not.toContain(he["billingAdmin.grantsEmpty"] as string)
  })

  it("the grant-history retry refetches", () => {
    state.grantsFailed = true
    const { container } = renderPage()
    fireEvent.click(container.querySelector("[data-testid='grants-open-u1']")!)
    fireEvent.click(container.querySelector("[data-testid='grants-retry-u1']")!)
    expect(grantsRefetch).toHaveBeenCalled()
  })
})

describe("the top-up form cannot grant the same allowance twice (F13)", () => {
  it("closes the form on success, which drops the amount it was holding", () => {
    // `grant_deployment_allowance` has no idempotency: a second click on a
    // form that kept its amount adds the allowance again, and unwinding it
    // needs a negative correction the RPC may refuse.
    const { container } = renderPage()
    fireEvent.click(container.querySelector("[data-testid='topup-open-u1']")!)
    const form = container.querySelector("[data-testid='topup-form-u1']")!
    fireEvent.change(form.querySelector("input")!, { target: { value: "4000" } })
    fireEvent.click(form.querySelector("[data-testid='topup-submit-u1']")!)

    expect(grantMutate).toHaveBeenCalledTimes(1)
    // The mutation is mocked, so drive its own success callback — that is the
    // contract the page relies on.
    const opts = grantMutate.mock.calls[0][1] as { onSuccess: () => void }
    act(() => opts.onSuccess())
    expect(container.querySelector("[data-testid='topup-form-u1']")).toBeNull()
  })

  it("re-opening the form starts empty, so nothing is resubmitted by accident", () => {
    const { container } = renderPage()
    fireEvent.click(container.querySelector("[data-testid='topup-open-u1']")!)
    fireEvent.change(container.querySelector("[data-testid='topup-form-u1'] input")!, {
      target: { value: "4000" },
    })
    fireEvent.click(container.querySelector("[data-testid='topup-submit-u1']")!)
    act(() => (grantMutate.mock.calls[0][1] as { onSuccess: () => void }).onSuccess())

    fireEvent.click(container.querySelector("[data-testid='topup-open-u1']")!)
    const input = container.querySelector("[data-testid='topup-form-u1'] input") as HTMLInputElement
    expect(input.value).toBe("")
  })
})

describe("R5 — Hebrew and RTL", () => {
  it("uses logical properties only — no ml-/mr-/pl-/pr- anywhere on the page", () => {
    const { container } = renderPage()
    expect(container.innerHTML).not.toMatch(/\b(ml|mr|pl|pr)-\d/)
  })
})

describe("the billingAdmin.* namespace", () => {
  const keys = Object.keys(en).filter((k) => k.startsWith("billingAdmin."))

  it("ships a non-trivial namespace in the canonical English dict", () => {
    expect(keys.length).toBeGreaterThan(40)
  })

  it("every key is translated in Hebrew", () => {
    const missing = keys.filter((k) => !(k in he))
    expect(missing, `billingAdmin keys with no he value:\n${missing.join("\n")}`).toEqual([])
  })

  it("every Hebrew value actually contains Hebrew letters (i18n.test.ts's NS regex does not cover us)", () => {
    const HEBREW = /[֐-׿]/
    const latin = keys.filter((k) => !HEBREW.test((he as Record<string, string>)[k] ?? ""))
    expect(latin, `billingAdmin he values with no Hebrew letter:\n${latin.join("\n")}`).toEqual([])
  })

  it("the disabled-card copy is the spec's sentence, verbatim", () => {
    expect(he["billingAdmin.cardDisabled"]).toBe("רכישה בכרטיס אינה מוגדרת בשרת זה")
  })

  it("does not name a customer in a shipped string", () => {
    // The page ships on the public platform repo; the deployment's identity
    // belongs in the profile, not in the product's copy.
    for (const k of keys) {
      expect((en as Record<string, string>)[k]).not.toMatch(/\bSAI\b/)
      expect((he as Record<string, string>)[k] ?? "").not.toMatch(/\bSAI\b/)
    }
  })
})
