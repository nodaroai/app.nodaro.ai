import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, act, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

/**
 * The sign-in page's "Start free with up to N credits" line is a promise of free
 * credits of one's own, and a deployment that sells nothing, or where one account
 * pays for everything, has none to give. So the line is gone there, and nothing
 * takes its place.
 *
 * Nodaro's own sign-in page is pinned byte for byte: the whole page, as
 * `container.innerHTML`, captured from the page before it learned of the rule
 * (the pin passed against that page, unchanged). It runs the real billing-surface
 * read over a stubbed network, so the pin covers the first paint, the settled
 * page and a surface that never answers.
 */

const surface = vi.hoisted(() => ({
  /** What GET /v1/billing/surface answers; a Promise holds the answer back. */
  answer: { deploymentPayer: false } as { deploymentPayer: boolean } | Promise<{ deploymentPayer: boolean }> | "fails",
}))

// Nodaro's configuration: the cloud edition, where the page offers Google.
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  isCloud: () => true,
  hasCredits: () => true,
  hasAdmin: () => true,
}))
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ signInWithGoogle: vi.fn(), signInWithEmail: vi.fn() }),
}))

const NODARO_SIGN_IN_PAGE = [
  "<div class=\"relative flex min-h-screen flex-col items-center justify-center px-4 bg-gradient-to-b from-background via-background to-zinc-950/40\"><div class=\"pointer-events-none absolute inset-0 opacity-[0.03]\" style=\"background-image: radial-gradient(circle, currentcolor 1px, transparent 1px); background-size: 24px 24px;\"></div>",
  "<main class=\"relative z-10 w-full max-w-sm space-y-8 text-center\"><div class=\"space-y-3\"><h1><span dir=\"ltr\" class=\"inline-flex items-center gap-[3px]\"><span class=\"size-8 inline-flex shrink-0\"><img alt=\"\" class=\"dark:hidden h-full w-full\" src=\"/logo-light.svg?v=4\"><img alt=\"\" class=\"hidden dark:block h-full w-full\" src=\"/logo-dark.svg?v=4\"></span><span class=\"font-brand font-bold text-zinc-900 dark:text-white text-[36px] leading-none\" aria-hidden=\"true\">odaro</span><span class=\"sr-only\">Nodaro</span></span></h1><p class=\"text-base text-muted-foreground animate-in fade-in duration-700\">Visual workflows for AI video generation</p></div>",
  "<div class=\"rounded-xl border border-white/[0.08] bg-card/60 backdrop-blur-sm p-6 shadow-lg space-y-4\"><div class=\"space-y-1.5\"><h2 class=\"text-lg font-semibold\">Sign in</h2></div><button data-slot=\"button\" data-variant=\"default\" data-size=\"default\" class=\"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg:not([class*='size-'])]:size-4 shrink-0 [&amp;_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-cta text-primary-foreground hover:bg-cta-hover h-9 px-4 py-2 has-[>svg]:px-3 w-full\">Continue with Google</button>",
  "<p class=\"text-xs text-muted-foreground pt-1\">Start free with up to 1,500 credits. No credit card required.</p></div></main>",
  "<footer class=\"absolute bottom-6 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground\"><a href=\"https://nodaro.ai/terms\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"hover:text-muted-foreground transition-colors\">Terms of Service</a><span>·</span><a href=\"https://nodaro.ai/privacy\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"hover:text-muted-foreground transition-colors\">Privacy Policy</a><span>·</span><a href=\"https://nodaro.ai/refund\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"hover:text-muted-foreground transition-colors\">Refund Policy</a><span aria-hidden=\"true\">·</span><a class=\"hover:text-foreground transition-colors\" href=\"/accessibility\" data-discover=\"true\">Accessibility statement</a><span aria-hidden=\"true\">·</span><a class=\"hover:text-foreground transition-colors\" href=\"/copyright-complaints\" data-discover=\"true\">Copyright &amp; content complaints</a></footer></div>"
].join("")

const FREE_CREDITS_LINE = '<p class="text-xs text-muted-foreground pt-1">Start free with up to 1,500 credits. No credit card required.</p>'
const PROMISE = /Start free|credit card|1,500/

function surfaceAnswered(): boolean {
  return vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/v1/billing/surface"))
}

/** Render the page, and let its best-effort probes and the billing surface settle. */
async function signInPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  const firstPaint = view.container.innerHTML
  await waitFor(() => expect(surfaceAnswered()).toBe(true))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return { firstPaint, settled: () => view.container.innerHTML, container: view.container }
}

beforeEach(() => {
  surface.answer = { deploymentPayer: false }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/v1/sso/providers")) return { ok: true, json: async () => ({ providers: [] }) } as Response
      if (url.includes("/v1/billing/surface")) {
        const answer = await surface.answer
        if (answer === "fails") return { ok: false, status: 500, json: async () => ({}) } as Response
        return { ok: true, status: 200, json: async () => ({ data: { displayUnit: "credits", ...answer } }) } as Response
      }
      return { ok: false, json: async () => ({}) } as Response
    }),
  )
})

afterEach(() => {
  delete window.__NODARO_RUNTIME__
  vi.unstubAllGlobals()
})

import LoginPage from "../login/page"

describe("the sign-in page's free-credits line", () => {
  it("Nodaro (no surface profile, no payer): the whole page, byte for byte, on the first paint and once settled", async () => {
    const page = await signInPage()
    expect(page.firstPaint).toBe(NODARO_SIGN_IN_PAGE)
    expect(page.settled()).toBe(NODARO_SIGN_IN_PAGE)
  })

  it("a billing surface that cannot be read changes nothing: the page stays as it was", async () => {
    surface.answer = "fails"
    const page = await signInPage()
    expect(page.firstPaint).toBe(NODARO_SIGN_IN_PAGE)
    expect(page.settled()).toBe(NODARO_SIGN_IN_PAGE)
  })

  it("selfServe: false: gone on the first paint, with no empty line and no sign-up links in its place", async () => {
    window.__NODARO_RUNTIME__ = { surface: { billing: { costTab: "inherit", sidebarCard: "inherit", selfServe: false } } }
    const page = await signInPage()
    for (const html of [page.firstPaint, page.settled()]) {
      expect(html).not.toMatch(PROMISE)
      expect(html).not.toContain("text-xs text-muted-foreground pt-1")
      expect(html).not.toContain("Create an account")
    }
    expect(page.settled()).toBe(NODARO_SIGN_IN_PAGE.replace(FREE_CREDITS_LINE, ""))
  })

  it("a deployment payer: the line goes as soon as the surface says so, and nothing else on the page moves", async () => {
    surface.answer = { deploymentPayer: true }
    const page = await signInPage()
    await waitFor(() => expect(page.settled()).not.toMatch(PROMISE))
    expect(page.settled()).toBe(NODARO_SIGN_IN_PAGE.replace(FREE_CREDITS_LINE, ""))
  })

  it("the known cost of failing open: a payer deployment with self-serve on shows the line until the surface answers", async () => {
    let answer: (value: { deploymentPayer: boolean }) => void = () => {}
    surface.answer = new Promise((resolve) => {
      answer = resolve
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(view.container.innerHTML).toMatch(PROMISE)
    await act(async () => {
      answer({ deploymentPayer: true })
    })
    await waitFor(() => expect(view.container.innerHTML).not.toMatch(PROMISE))
  })
})
