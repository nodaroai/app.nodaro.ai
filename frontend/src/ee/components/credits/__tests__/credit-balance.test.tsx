import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { useLocaleStore } from "@/lib/locale-store"

/**
 * `CreditBalance`, the balance outside the shared header (`/app/*`,
 * `/present/*`, and the toolbar when the header did not load).
 *
 * Nodaro's own rendering is pinned byte for byte here: the markup of every
 * state, as `container.innerHTML`, written against the component before it
 * learned a deployment's unit. A deployment that shows its own unit takes
 * another path (the server's `display` figure and unit, the spendable rule,
 * no plan badge when nothing is sold), and none of it may reach these strings.
 */

const m = vi.hoisted(() => ({
  query: { data: undefined, isLoading: false, error: null } as { data: unknown; isLoading: boolean; error: unknown },
  credits: { hasCredits: true },
}))

vi.mock("@/ee/hooks/queries/use-credits-queries", () => ({ useUserCredits: () => m.query }))
vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/edition")>()),
  hasCredits: () => m.credits.hasCredits,
}))

const { CreditBalance } = await import("../CreditBalance")

const WALLET = {
  total: 1500,
  subscription: 1200,
  topup: 300,
  dailySpent: 0,
  dailyLimit: null,
  monthlyAllocation: 2000,
  tier: "pro",
  effectiveTier: "pro",
  features: {},
  periodEnd: null,
  appCreditsAllowance: 0,
}

/** Mount with the query answering `data`; the markup a viewer gets. */
function html(data: unknown, props: { onClick?: () => void } = {}): string {
  m.query = { data, isLoading: false, error: null }
  const { container } = render(<CreditBalance userId="u1" {...props} />)
  const out = container.innerHTML
  cleanup()
  return out
}

afterEach(() => {
  cleanup()
  m.query = { data: undefined, isLoading: false, error: null }
  delete window.__NODARO_RUNTIME__
  useLocaleStore.setState({ locale: "en" })
})

describe("Nodaro's rendering is byte-identical (no display unit, nothing narrowed)", () => {
  it("a subscriber: the total, the unit word and the plan badge", () => {
    expect(html(WALLET)).toMatchInlineSnapshot(`"<div class="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-coins w-4 h-4 text-muted-foreground" aria-hidden="true"><circle cx="8" cy="8" r="6"></circle><path d="M18.09 10.37A6 6 0 1 1 10.34 18"></path><path d="M7 6h1v4"></path><path d="m16.71 13.88.7.71-2.82 2.82"></path></svg><span class="text-sm font-medium font-mono">1,500</span><span class="text-xs text-muted-foreground hidden sm:inline">credits</span><span data-slot="badge" data-variant="secondary" class="inline-flex items-center justify-center rounded-full border border-transparent font-medium w-fit whitespace-nowrap shrink-0 [&amp;>svg]:size-3 gap-1 [&amp;>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden bg-secondary text-secondary-foreground [a&amp;]:hover:bg-secondary/90 text-[11px] px-1.5 py-0 h-4 capitalize">pro</span></div>"`)
  })

  it("a free account", () => {
    expect(html({ ...WALLET, tier: "free", effectiveTier: "free", total: 20, subscription: 20, topup: 0 })).toMatchInlineSnapshot(`"<div class="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-coins w-4 h-4 text-muted-foreground" aria-hidden="true"><circle cx="8" cy="8" r="6"></circle><path d="M18.09 10.37A6 6 0 1 1 10.34 18"></path><path d="M7 6h1v4"></path><path d="m16.71 13.88.7.71-2.82 2.82"></path></svg><span class="text-sm font-medium font-mono">20</span><span class="text-xs text-muted-foreground hidden sm:inline">credits</span><span data-slot="badge" data-variant="secondary" class="inline-flex items-center justify-center rounded-full border border-transparent font-medium w-fit whitespace-nowrap shrink-0 [&amp;>svg]:size-3 gap-1 [&amp;>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden bg-secondary text-secondary-foreground [a&amp;]:hover:bg-secondary/90 text-[11px] px-1.5 py-0 h-4 capitalize">free</span></div>"`)
  })

  it("pay-as-you-go: the two pools, each with its own label", () => {
    expect(html({ ...WALLET, tier: "free", effectiveTier: "payg", subscription: 40, topup: 500 })).toMatchInlineSnapshot(`"<div class="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-coins w-4 h-4 text-muted-foreground" aria-hidden="true"><circle cx="8" cy="8" r="6"></circle><path d="M18.09 10.37A6 6 0 1 1 10.34 18"></path><path d="M7 6h1v4"></path><path d="m16.71 13.88.7.71-2.82 2.82"></path></svg><span class="text-sm font-medium font-mono" title="Free credits (studio) / API credits (SDK, MCP, API)">40<span class="text-muted-foreground"> free · </span>500<span class="text-muted-foreground"> API</span></span><span class="text-xs text-muted-foreground hidden sm:inline">credits</span><span data-slot="badge" data-variant="secondary" class="inline-flex items-center justify-center rounded-full border border-transparent font-medium w-fit whitespace-nowrap shrink-0 [&amp;>svg]:size-3 gap-1 [&amp;>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden bg-secondary text-secondary-foreground [a&amp;]:hover:bg-secondary/90 text-[11px] px-1.5 py-0 h-4 capitalize">payg</span></div>"`)
  })

  it("loading, error and no balance", () => {
    m.query = { data: undefined, isLoading: true, error: null }
    expect(render(<CreditBalance userId="u1" />).container.innerHTML).toMatchInlineSnapshot(`"<div class="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md animate-pulse"><div class="w-4 h-4 bg-muted-foreground/20 rounded"></div><div class="w-12 h-4 bg-muted-foreground/20 rounded"></div></div>"`)
    cleanup()
    m.query = { data: undefined, isLoading: false, error: new Error("nope") }
    expect(render(<CreditBalance userId="u1" />).container.innerHTML).toMatchInlineSnapshot(`"<div class="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-coins w-4 h-4 text-muted-foreground" aria-hidden="true"><circle cx="8" cy="8" r="6"></circle><path d="M18.09 10.37A6 6 0 1 1 10.34 18"></path><path d="M7 6h1v4"></path><path d="m16.71 13.88.7.71-2.82 2.82"></path></svg><span class="text-sm text-muted-foreground">—</span></div>"`)
    cleanup()
    m.query = { data: undefined, isLoading: false, error: null }
    expect(render(<CreditBalance userId="u1" />).container.innerHTML).toMatchInlineSnapshot(`"<div class="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-coins w-4 h-4 text-muted-foreground" aria-hidden="true"><circle cx="8" cy="8" r="6"></circle><path d="M18.09 10.37A6 6 0 1 1 10.34 18"></path><path d="M7 6h1v4"></path><path d="m16.71 13.88.7.71-2.82 2.82"></path></svg><span class="text-sm text-muted-foreground">—</span></div>"`)
  })

  it("clickable (the app runner's way to more credits)", () => {
    expect(html(WALLET, { onClick: vi.fn() })).toMatchInlineSnapshot(`"<button type="button" class="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md cursor-pointer hover:bg-muted/80 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-coins w-4 h-4 text-muted-foreground" aria-hidden="true"><circle cx="8" cy="8" r="6"></circle><path d="M18.09 10.37A6 6 0 1 1 10.34 18"></path><path d="M7 6h1v4"></path><path d="m16.71 13.88.7.71-2.82 2.82"></path></svg><span class="text-sm font-medium font-mono">1,500</span><span class="text-xs text-muted-foreground hidden sm:inline">credits</span><span data-slot="badge" data-variant="secondary" class="inline-flex items-center justify-center rounded-full border border-transparent font-medium w-fit whitespace-nowrap shrink-0 [&amp;>svg]:size-3 gap-1 [&amp;>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden bg-secondary text-secondary-foreground [a&amp;]:hover:bg-secondary/90 text-[11px] px-1.5 py-0 h-4 capitalize">pro</span></button>"`)
  })

  it("no credits on this edition: nothing", () => {
    m.credits.hasCredits = false
    m.query = { data: WALLET, isLoading: false, error: null }
    expect(render(<CreditBalance userId="u1" />).container.innerHTML).toBe("")
    m.credits.hasCredits = true
  })

  it("a label the profile sets alone (no display yet) still renders the client's own conversion, unchanged", () => {
    window.__NODARO_RUNTIME__ = { surface: { billing: { costTab: "inherit", sidebarCard: "inherit", selfServe: true, unitLabel: "points", unitRate: 10 } } } as unknown as typeof window.__NODARO_RUNTIME__
    render(<CreditBalance userId="u1" />)
    cleanup()
    expect(html(WALLET)).toContain("15,000")
    expect(html(WALLET)).toContain("points")
  })
})

describe("a deployment that shows its own unit: the server's `display`", () => {
  const DISPLAY = { unit: "points", decimals: 0, total: 3000, subscription: 2400, topup: 600, dailySpent: 0, dailyLimit: null, monthlyAllocation: 4000, appCreditsAllowance: 0 }

  function surface(billing: Record<string, unknown>) {
    window.__NODARO_RUNTIME__ = { surface: { header: "white-label", billing: { costTab: "inherit", sidebarCard: "inherit", selfServe: false, ...billing } } } as unknown as typeof window.__NODARO_RUNTIME__
  }

  function mount(data: unknown, props: { onClick?: () => void } = {}) {
    m.query = { data, isLoading: false, error: null }
    return render(<CreditBalance userId="u1" {...props} />)
  }

  it("the server's figure and unit, never converted again in the browser", () => {
    surface({ unitLabel: "points", unitRate: 2 })
    mount({ ...WALLET, display: DISPLAY })
    // 3,000 is the server's figure; converting it again would read 6,000.
    expect(screen.getByText("3,000")).toBeTruthy()
    expect(screen.queryByText("6,000")).toBeNull()
    expect(screen.getByText("points")).toBeTruthy()
  })

  it("the spendable rule: a shared wallet's available figure, else the member's allowance, else the total", () => {
    surface({ unitLabel: "points", unitRate: 2 })
    mount({ ...WALLET, total: 1, externalWallet: { available: 700 }, display: { ...DISPLAY, total: 2, externalWallet: { available: 1400 } } })
    expect(screen.getByText("1,400")).toBeTruthy()
    cleanup()
    mount({ ...WALLET, total: 1, allowance: { granted: 900, remaining: 450, enforced: true }, display: { ...DISPLAY, total: 2, allowance: { granted: 1800, remaining: 900 } } })
    expect(screen.getByText("900")).toBeTruthy()
    cleanup()
    mount({ ...WALLET, display: DISPLAY })
    expect(screen.getByText("3,000")).toBeTruthy()
  })

  it("a figure the server could not give is an em dash, never 0", () => {
    surface({ unitLabel: "points", unitRate: 2 })
    mount({ ...WALLET, allowance: { granted: 900, remaining: 450, enforced: true }, display: { ...DISPLAY, allowance: { granted: null, remaining: null } } })
    expect(screen.getByText("—")).toBeTruthy()
    expect(screen.queryByText("0")).toBeNull()
    cleanup()
    mount({ ...WALLET, display: { ...DISPLAY, total: null } })
    expect(screen.getByText("—")).toBeTruthy()
    cleanup()
    mount({ ...WALLET, externalWallet: { available: null }, display: { ...DISPLAY, externalWallet: { available: null } } })
    expect(screen.getByText("—")).toBeTruthy()
  })

  it("one figure, also for a pay-as-you-go plan: the deployment's balance has no two pools", () => {
    surface({ unitLabel: "points", unitRate: 2 })
    const { container } = mount({ ...WALLET, effectiveTier: "payg", display: DISPLAY })
    expect(container.textContent).not.toContain("API")
    expect(screen.getByText("3,000")).toBeTruthy()
  })

  it("to the decimal places the server gives", () => {
    surface({ unitLabel: "points", unitRate: 0.5, unitDecimals: 2 })
    const { container } = mount({ ...WALLET, display: { ...DISPLAY, decimals: 2, total: 1234.5 } })
    expect(container.textContent).toContain("1,234.5")
  })

  it("no plan badge when nothing is sold; a deployment that does sell keeps it", () => {
    surface({ unitLabel: "points", unitRate: 2 })
    const { container } = mount({ ...WALLET, display: DISPLAY })
    expect(container.querySelector('[data-slot="badge"]')).toBeNull()
    cleanup()
    surface({ unitLabel: "points", unitRate: 2, selfServe: true })
    const shown = mount({ ...WALLET, display: DISPLAY }).container
    expect(shown.querySelector('[data-slot="badge"]')?.textContent).toBe("pro")
  })

  it("a deployment that sells nothing and shows no unit also drops the badge", () => {
    window.__NODARO_RUNTIME__ = { surface: { billing: { costTab: "inherit", sidebarCard: "inherit", selfServe: false } } } as unknown as typeof window.__NODARO_RUNTIME__
    const { container } = mount(WALLET)
    expect(container.querySelector('[data-slot="badge"]')).toBeNull()
    expect(screen.getByText("1,500")).toBeTruthy()
  })

  it("the unit word in the viewer's language, from the map the server sent", () => {
    surface({ unitLabel: "נקודות", unitRate: 2, unitLabels: { he: "נקודות", en: "points" } })
    const words = { unit: "נקודות", unitLabels: { he: "נקודות", en: "points" } }
    mount({ ...WALLET, display: { ...DISPLAY, ...words } })
    expect(screen.getByText("points")).toBeTruthy()
    cleanup()
    useLocaleStore.setState({ locale: "he" })
    mount({ ...WALLET, display: { ...DISPLAY, ...words } })
    expect(screen.getByText("נקודות")).toBeTruthy()
  })

  it("the balance stays a button where it was one", () => {
    surface({ unitLabel: "points", unitRate: 2 })
    const onClick = vi.fn()
    mount({ ...WALLET, display: DISPLAY }, { onClick })
    screen.getByRole("button").click()
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe("a balance with no `display`: the spendable rule still decides the figure", () => {
  it("a shared wallet: its available figure, or an em dash when unknown", () => {
    m.query = { data: { ...WALLET, total: 1, externalWallet: { available: 420 } }, isLoading: false, error: null }
    render(<CreditBalance userId="u1" />)
    expect(screen.getByText("420")).toBeTruthy()
    cleanup()
    m.query = { data: { ...WALLET, total: 1, externalWallet: { available: null } }, isLoading: false, error: null }
    render(<CreditBalance userId="u1" />)
    expect(screen.getByText("—")).toBeTruthy()
  })

  it("the member's allowance", () => {
    m.query = { data: { ...WALLET, total: 1, allowance: { granted: 900, remaining: 450, enforced: false } }, isLoading: false, error: null }
    render(<CreditBalance userId="u1" />)
    expect(screen.getByText("450")).toBeTruthy()
  })

  it("the billing account's own read (allowance null, no display): the total, as always", () => {
    m.query = { data: { ...WALLET, allowance: null }, isLoading: false, error: null }
    render(<CreditBalance userId="u1" />)
    expect(screen.getByText("1,500")).toBeTruthy()
  })
})
