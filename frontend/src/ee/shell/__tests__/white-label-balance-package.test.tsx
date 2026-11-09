import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient } from "@tanstack/react-query"
import type { ComponentType } from "react"
import type { NodaroClient } from "@nodaro/sdk/client"
import { unitTranslator, withHeaderBalance, type UnitWords } from "../white-label"
import type { SiteHeaderProps, SiteHeaderTranslate } from "../types"

/**
 * The white-label balance as the pinned package actually draws it: what the
 * app hands the header (`headerBalance`) is only right if the header's own
 * rules (which figure it spends from, where it draws its month meter) still
 * read it the way the app means. So here the real header draws a deployment's
 * balance: the allowance of a single payer keeps its meter, in credits and in
 * the deployment's own unit.
 *
 * Runs wherever the package is installed — the shared-header contract job
 * installs it and sets SHARED_HEADER_TESTS_REQUIRE_PACKAGE=1, under which a
 * missing package fails instead of skipping. Public CI has no package, so
 * there it skips.
 */

const env = vi.hoisted(() => ({
  // Built from fragments: a computed specifier keeps Vite from resolving it where it is absent.
  specifier: ["@nodaroai", "shell"].join("/"),
  require: process.env.SHARED_HEADER_TESTS_REQUIRE_PACKAGE === "1",
}))

interface PackageRoot {
  readonly NodaroShell: ComponentType<SiteHeaderProps>
  readonly shellTranslator: (locale: string | undefined) => SiteHeaderTranslate
}

let pkg: PackageRoot | null = null
try {
  pkg = (await import(/* @vite-ignore */ env.specifier)) as PackageRoot
} catch (error) {
  if (env.require) throw error
}

const WALLET = { subscription: 0, topup: 0, monthlyAllocation: 0, tier: "free", effectiveTier: "free", dailySpent: 0, dailyLimit: null, appCreditsAllowance: 0 }
const WORDS: UnitWords = {
  label: "tokens",
  balance: (credits) => `${credits} tokens`,
  pill: (credits) => `${credits} tokens — get more tokens`,
  loading: "Loading tokens",
  left: "tokens left",
  meter: (left, total) => `tokens left: ${left} of ${total}`,
}

function fakeSupabase() {
  const session = { user: { id: "u1" }, access_token: "access", refresh_token: "refresh" }
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => ({ error: null }),
    },
  }
}

function mount(balance: Record<string, unknown>, t?: SiteHeaderTranslate) {
  const sdk = {
    credits: { balance: async () => balance, claimSignupGrant: async () => ({ state: "granted", granted: false }) },
    billing: { plans: async () => ({ data: [], topUps: [], topUpRange: { min: 0, max: 0, currency: "USD" } }) },
    me: async () => ({ id: "u1", email: "ada@example.com", displayName: null, avatarUrl: null, tier: "free", isAdmin: false }),
    connectedApps: async () => [],
    models: { list: async () => ({ sections: [], recommendations: [], totalModels: 0 }) },
    request: async () => ({}),
  }
  const Shell = pkg!.NodaroShell
  render(
    <Shell
      sdk={withHeaderBalance(sdk as unknown as NodaroClient)}
      supabase={fakeSupabase() as never}
      queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      sourceApp="app"
      whiteLabel
      worlds={["image", "app"]}
      worldHrefs={{ image: "/image", app: "/projects" }}
      urls={{ app: window.location.origin, login: "/login", home: "/" }}
      homeUrl="/"
      selfServe={false}
      cookieDomain={null}
      claimSignupGrant={false}
      welcomeOfferAutoOpen={false}
      accountPages="in-app"
      {...(t ? { t } : {})}
    />,
  )
}

const bar = () => document.querySelector("[data-ns-desktop-only]") as HTMLElement

async function openAccountMenu() {
  fireEvent.click(await within(bar()).findByRole("button", { name: "Account menu" }))
  return screen.findByRole("menu", { name: "Account menu" })
}

beforeEach(() => {
  window.history.replaceState(null, "", "/projects")
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe.skipIf(!pkg)("a white-label balance, drawn by the pinned header", () => {
  it("a single payer in credits: the allowance is the figure, and its meter is drawn", async () => {
    mount({ ...WALLET, total: 300, allowance: { granted: 2000, remaining: 1500, enforced: true } })
    const menu = await openAccountMenu()
    expect(await within(menu).findByText("1,500")).toBeInTheDocument()
    expect(within(menu).queryByText("300")).toBeNull()
    expect(within(menu).getByText("Credits left this month: 1,500 of 2,000")).toBeInTheDocument()
    expect(menu.querySelector(".ns-menu-meter")).toHaveStyle({ width: "75%" })
  })

  it("a single payer in the deployment's unit: the allowance in the unit, its meter, in the app's words", async () => {
    const display = { unit: "tokens", decimals: 0, ...WALLET, total: 1200, allowance: { granted: 8000000, remaining: 6000000 } }
    mount({ ...WALLET, total: 300, allowance: { granted: 2000, remaining: 1500, enforced: false }, display }, unitTranslator(pkg!.shellTranslator("en"), WORDS))
    expect(await within(bar()).findByText("6,000,000 tokens")).toBeInTheDocument()
    const menu = await openAccountMenu()
    expect(await within(menu).findByText("6,000,000")).toBeInTheDocument()
    expect(within(menu).getByText("tokens left")).toBeInTheDocument()
    expect(within(menu).getByText("tokens left: 6,000,000 of 8,000,000")).toBeInTheDocument()
    expect(menu.querySelector(".ns-menu-meter")).toHaveStyle({ width: "75%" })
  })

  it("an outside wallet: its figure and no meter, as before", async () => {
    mount({ ...WALLET, total: 300, externalWallet: { available: 420 } })
    const menu = await openAccountMenu()
    expect(await within(menu).findByText("420")).toBeInTheDocument()
    expect(menu.querySelector(".ns-menu-meter")).toBeNull()
  })
})
