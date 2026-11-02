/**
 * The Header versions page: each product's live and test site with the
 * version it serves and how it stands against the newest release; a site that
 * hides the header says so before its version; a deploy on its way or a failed
 * one is said beside the live version; without the GitHub token the page names
 * what to set and the repositories it must read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { HeaderVersionsReport, ProductView, SiteResult } from "../types"

const edition = vi.hoisted(() => ({ cloud: true }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer t" }) }))
vi.mock("@/lib/edition", () => ({ isCloud: () => edition.cloud }))

import HeaderVersionsPage from "../page"

const fetchMock = vi.fn()

beforeEach(() => {
  edition.cloud = true
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const deploy = (sha: string, extra: Partial<{ deploying: boolean; lastFailed: boolean }> = {}) => ({
  sha,
  commitUrl: `https://github.com/acme/repo/commit/${sha}`,
  deployedAt: "2026-11-01T12:00:00.000Z",
  deploying: false,
  lastFailed: false,
  ...extra,
})

const ok = (version: string | null, extra: Partial<Extract<SiteResult, { status: "ok" }>> = {}): SiteResult => ({
  status: "ok",
  version,
  header: true,
  source: "lockfile",
  deploy: deploy("abcdef1234567"),
  standing: null,
  ...extra,
})

const product = (id: string, production: SiteResult, staging: SiteResult): ProductView => ({
  id,
  label: id,
  repo: `acme/${id}`,
  sites: {
    production: { host: `${id}.example.com`, url: `https://${id}.example.com`, result: production },
    staging: { host: `next.${id}.example.com`, url: `https://next.${id}.example.com`, result: staging },
  },
})

const REPORT: HeaderVersionsReport = {
  configured: true,
  invalidProducts: [],
  latest: { status: "ok", version: "0.13.0", tagsUrl: "https://github.com/nodaroai/shell/tags" },
  checkedAt: "2026-11-01T12:05:00.000Z",
  products: [
    product("app", ok("0.12.0", { header: false, source: "site-file", standing: "behind" }), ok("0.12.0", { source: "site-file", standing: "behind" })),
    product("studio", ok("0.6.2", { standing: "behind" }), ok("0.13.0", { standing: "newest", deploy: deploy("1234567890", { deploying: true }) })),
    product("tools", ok("0.12.0", { standing: "behind", deploy: deploy("feedface00", { lastFailed: true }) }), { status: "error", message: "GitHub answered 404: Not Found" }),
    product("person", { status: "no_deploy" }, ok("^0.12.0", { source: "package-json" })),
    product("recast", ok("0.8.0", { header: null, source: "pin" }), ok("0.12.0", { header: null, source: "pin" })),
  ],
}

const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <HeaderVersionsPage />
    </QueryClientProvider>,
  )
  return client
}

const cell = (productId: string, column: 1 | 2) => within(screen.getByTestId(`product-${productId}`)).getAllByRole("cell")[column - 1] as HTMLElement

describe("HeaderVersionsPage", () => {
  it("shows every product's live and test site against the newest release", async () => {
    fetchMock.mockImplementation(() => answer(REPORT))
    renderPage()
    // Every link opens a new tab and says so to a screen reader.
    expect(await screen.findByRole("link", { name: /^0\.13\.0\s*\(opens in a new tab\)$/ })).toHaveAttribute("href", "https://github.com/nodaroai/shell/tags")

    // The App's live site hides the header: said first, the package it installs in small print, no ranking.
    const appLive = cell("app", 1)
    expect(within(appLive).getByTestId("site-version")).toHaveTextContent("Header off")
    expect(within(appLive).getByText("Package 0.12.0 installed, header not shown")).toBeInTheDocument()
    expect(within(appLive).queryByText("Behind")).toBeNull()
    expect(within(cell("app", 2)).getByText("Behind")).toBeInTheDocument()

    // A deploy on its way is said beside the version still live.
    const studioTest = cell("studio", 2)
    expect(within(studioTest).getByTestId("site-version")).toHaveTextContent("0.13.0")
    expect(within(studioTest).getByText("Newest")).toBeInTheDocument()
    expect(within(studioTest).getByText("Deploying…")).toBeInTheDocument()
    expect(within(studioTest).getByRole("link", { name: /^1234567\s*\(opens in a new tab\)$/ })).toHaveAttribute("href", "https://github.com/acme/repo/commit/1234567890")

    const toolsLive = cell("tools", 1)
    expect(within(toolsLive).getByText("Last deploy failed")).toBeInTheDocument()
    expect(within(cell("tools", 2)).getByText("GitHub answered 404: Not Found")).toBeInTheDocument()

    expect(within(cell("person", 1)).getByText("No successful deploy found")).toBeInTheDocument()
    expect(within(cell("person", 2)).getByTestId("site-version")).toHaveTextContent("^0.12.0 (declared)")
    expect(within(cell("person", 2)).getByRole("link", { name: /next\.person\.example\.com/ })).toHaveAttribute("href", "https://next.person.example.com")

    // A pin is what the commit would install, not what the site shows: never the headline.
    const pinned = cell("recast", 1)
    expect(within(pinned).getByTestId("site-version")).toHaveTextContent("Unknown yet")
    expect(within(pinned).getByText("The commit pins 0.8.0; this site does not publish what it installed yet.")).toBeInTheDocument()

    expect(screen.queryByTestId("header-versions-setup")).toBeNull()
    expect(screen.queryByTestId("header-versions-products")).toBeNull()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["/v1/admin/header-versions"])
  })

  it("no products listed: names the setting and its shape; refused entries are said, never hidden", async () => {
    fetchMock.mockImplementation(() =>
      answer({ ...REPORT, products: [], invalidProducts: [{ index: 1, reason: "production: Invalid string" }, { index: -1, reason: "HEADER_VERSIONS_PRODUCTS is not valid JSON." }] }),
    )
    renderPage()
    const notice = await screen.findByTestId("header-versions-products")
    expect(within(notice).getByText("HEADER_VERSIONS_PRODUCTS")).toBeInTheDocument()
    expect(within(notice).getByText("Entry 2: production: Invalid string")).toBeInTheDocument()
    expect(within(notice).getByText("HEADER_VERSIONS_PRODUCTS is not valid JSON.")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("without the GitHub token, names the variable and every repository it must read", async () => {
    fetchMock.mockImplementation(() =>
      answer({
        ...REPORT,
        configured: false,
        latest: { status: "not_configured" },
        products: [product("tools", { status: "not_configured" }, { status: "not_configured" })],
      }),
    )
    renderPage()
    const setup = await screen.findByTestId("header-versions-setup")
    expect(within(setup).getByText("HEADER_VERSIONS_GITHUB_TOKEN")).toBeInTheDocument()
    expect(within(setup).getByText("acme/tools")).toBeInTheDocument()
    expect(within(setup).getByText("nodaroai/shell")).toBeInTheDocument()
    expect(screen.getAllByText("Needs the GitHub token")).toHaveLength(2)
  })

  it("Refresh asks past the server's kept answer and shows the new one", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("?fresh=1") ? answer({ ...REPORT, products: [product("tools", ok("0.13.0", { standing: "newest" }), ok("0.13.0", { standing: "newest" }))] }) : answer(REPORT),
    )
    renderPage()
    await screen.findByTestId("product-app")
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }))
    await waitFor(() => expect(screen.queryByTestId("product-app")).toBeNull())
    expect(within(cell("tools", 1)).getByText("Newest")).toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain("/v1/admin/header-versions?fresh=1")
  })

  it("while loading, says so to a screen reader", async () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined))
    renderPage()
    expect(await screen.findByRole("status")).toHaveTextContent("Loading header versions")
  })

  it("a refused report shows the server's reason", async () => {
    fetchMock.mockImplementation(() => answer({ error: { code: "forbidden", message: "Admin access required" } }, 403))
    renderPage()
    expect(await screen.findByText("Admin access required")).toBeInTheDocument()
  })

  it("a background poll that fails keeps the last answer on screen and says so", async () => {
    fetchMock.mockImplementation(() => answer(REPORT))
    const client = renderPage()
    await screen.findByTestId("product-app")
    fetchMock.mockImplementation(() => answer({ error: { code: "internal", message: "Server restarting" } }, 503))
    await act(() => client.refetchQueries())
    expect(await screen.findByText(/Could not refresh: Server restarting\. Showing the last answer\./)).toBeInTheDocument()
    expect(screen.getByTestId("product-app")).toBeInTheDocument()
  })

  it("outside Cloud, says the page is Cloud only and asks nothing", async () => {
    edition.cloud = false
    renderPage()
    expect(await screen.findByText("Header versions are tracked on Nodaro Cloud only.")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
