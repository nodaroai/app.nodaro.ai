/**
 * The Header versions page: the header on top with its newest release and how
 * many sites run it; under it a card per product with its live and test site,
 * the version each serves and how it stands; a site that hides the header
 * says so before its version; a deploy on its way or a failed one is said
 * under the version still live; below, what each newer release brought and
 * the sites without it; without the GitHub token the page names what to set
 * and the repositories it must read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { HeaderVersionsReport, ProductView, ReleaseNote, SiteEnvironment, SiteResult } from "../types"

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
  releasesBehind: null,
  ...extra,
})

const product = (id: string, production: SiteResult, staging: SiteResult, icon: string | null = null): ProductView => ({
  id,
  label: id,
  repo: `acme/${id}`,
  icon,
  sites: {
    production: { host: `${id}.example.com`, url: `https://${id}.example.com`, result: production },
    staging: { host: `next.${id}.example.com`, url: `https://next.${id}.example.com`, result: staging },
  },
})

const NOTE: ReleaseNote = {
  version: "0.13.0",
  summary: "Products can hide the row of links. Nothing changes for a product that does not.",
  releasedAt: "2026-11-01T10:00:00.000Z",
  url: "https://github.com/nodaroai/shell/compare/v0.12.0...v0.13.0",
  changes: [{ title: "a row that can be turned off", kind: "feature", url: "https://github.com/nodaroai/shell/pull/22" }],
  missingOn: [
    { productId: "app", environment: "production" },
    { productId: "app", environment: "staging" },
    { productId: "tools", environment: "production" },
  ],
}

const REPORT: HeaderVersionsReport = {
  configured: true,
  invalidProducts: [],
  headerPackage: "@acme/header",
  latest: { status: "ok", version: "0.13.0", tagsUrl: "https://github.com/nodaroai/shell/tags" },
  releaseNotes: { status: "ok", releases: [NOTE], older: 0, compared: 9 },
  checkedAt: "2026-11-01T12:05:00.000Z",
  products: [
    product(
      "app",
      ok("0.12.0", { header: false, source: "site-file", standing: "behind", releasesBehind: 1 }),
      ok("0.12.0", { source: "site-file", standing: "behind", releasesBehind: 1 }),
      "workflow",
    ),
    product("studio", ok("0.6.2", { standing: "behind", releasesBehind: 7 }), ok("0.13.0", { standing: "newest", deploy: deploy("1234567890", { deploying: true }) }), "constructor"),
    product("tools", ok("0.12.0", { standing: "behind", deploy: deploy("feedface00", { lastFailed: true }) }), { status: "error", message: "GitHub answered 404: Not Found" }),
    product("person", { status: "no_deploy" }, ok("^0.12.0", { source: "package-json" })),
    product("recast", ok("0.8.0", { header: null, source: "pin" }), ok("0.12.0", { header: null, source: "pin" })),
    product("voice", ok("0.13.0", { standing: "newest" }), ok("0.14.0", { standing: "ahead" })),
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

const card = (productId: string) => screen.getByTestId(`product-${productId}`)
const site = (productId: string, environment: SiteEnvironment) => within(card(productId)).getByTestId(`site-${environment}`)
const version = (productId: string, environment: SiteEnvironment) => within(site(productId, environment)).getByTestId("site-version")

describe("HeaderVersionsPage", () => {
  it("shows the header on top: its name from the server, the newest release, and how many sites run it", async () => {
    fetchMock.mockImplementation(() => answer(REPORT))
    renderPage()
    await screen.findByTestId("product-app")
    expect(screen.getByText("@acme/header")).toBeInTheDocument()
    // Every link opens a new tab and says so to a screen reader.
    const releaseLinks = screen.getAllByRole("link", { name: /^0\.13\.0\s*\(opens in a new tab\)$/ })
    expect(releaseLinks.map((link) => link.getAttribute("href"))).toContain("https://github.com/nodaroai/shell/tags")
    // Up to date: on the newest release or past it, header shown — studio's test site and both of voice's.
    expect(screen.getByTestId("up-to-date")).toHaveTextContent("3 of 12 sites up to date")
    const legend = screen.getByRole("list", { name: "Legend" })
    for (const label of ["Live site", "Test site", "Newest", "Behind", "Header off"]) expect(legend).toHaveTextContent(label)
  })

  it("each product's card: its live and test site, the version each serves and how it stands", async () => {
    fetchMock.mockImplementation(() => answer(REPORT))
    renderPage()
    await screen.findByTestId("product-app")

    // The App's live site hides the header: said first, the package it installs under it, no ranking.
    expect(version("app", "production")).toHaveTextContent("Header off")
    expect(within(site("app", "production")).getByText("0.12.0 installed")).toBeInTheDocument()
    expect(within(site("app", "production")).queryByText(/behind/)).toBeNull()
    // A site behind says by how many releases, and links to what they brought.
    expect(within(site("app", "staging")).getByRole("link", { name: "1 version behind" })).toHaveAttribute("href", "#whats-new")
    expect(within(site("studio", "production")).getByText("7 versions behind")).toBeInTheDocument()

    // A deploy on its way is said under the version still live.
    expect(version("studio", "staging")).toHaveTextContent("0.13.0")
    expect(within(site("studio", "staging")).getByText("Newest")).toBeInTheDocument()
    expect(within(site("studio", "staging")).getByText("Deploying…")).toBeInTheDocument()
    expect(within(site("studio", "staging")).getByRole("link", { name: /^1234567\s*\(opens in a new tab\)$/ })).toHaveAttribute("href", "https://github.com/acme/repo/commit/1234567890")

    expect(within(site("tools", "production")).getByText("Last deploy failed")).toBeInTheDocument()
    expect(version("tools", "staging")).toHaveTextContent("Unreadable")
    expect(within(site("tools", "staging")).getByText("GitHub answered 404: Not Found")).toBeInTheDocument()

    expect(within(site("person", "production")).getByText("No successful deploy found")).toBeInTheDocument()
    expect(version("person", "staging")).toHaveTextContent("^0.12.0")
    expect(within(site("person", "staging")).getByText("Declared range, not installed")).toBeInTheDocument()
    expect(within(site("person", "staging")).getByRole("link", { name: /next\.person\.example\.com/ })).toHaveAttribute("href", "https://next.person.example.com")

    // A pin is what the commit would install, not what the site shows: never the headline.
    expect(version("recast", "production")).toHaveTextContent("Unknown yet")
    expect(within(site("recast", "production")).getByText("The commit pins 0.8.0; the site does not say yet")).toBeInTheDocument()

    expect(within(site("voice", "staging")).getByText("Ahead of the release")).toBeInTheDocument()

    // The solid Live tag keeps its own colours under strong contrast, which forces text but not fills; the dashed Test tag needs nothing.
    expect(site("app", "production").querySelector("[data-a11y-keep-colour]")).toHaveTextContent("Live")
    expect(site("app", "staging").querySelector("[data-a11y-keep-colour]")).toBeNull()

    expect(screen.queryByTestId("header-versions-setup")).toBeNull()
    expect(screen.queryByTestId("header-versions-products")).toBeNull()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["/v1/admin/header-versions"])
  })

  it("a product's picture is the one its setting names; an unknown name or none draws its first letter", async () => {
    fetchMock.mockImplementation(() => answer(REPORT))
    renderPage()
    await screen.findByTestId("product-app")
    const tile = (id: string) => card(id).querySelector("[data-icon]")
    expect(tile("app")).toHaveAttribute("data-icon", "workflow")
    // "constructor" passes the setting's shape but is no picture: an object's own properties are never looked up.
    expect(tile("studio")).toHaveAttribute("data-icon", "letter")
    expect(tile("studio")).toHaveTextContent("S")
    expect(tile("tools")).toHaveAttribute("data-icon", "letter")
  })

  it("what changed: each newer release in plain words, its changes, and the sites without it", async () => {
    fetchMock.mockImplementation(() => answer(REPORT))
    renderPage()
    const section = await screen.findByRole("region", { name: "What changed between the versions" })
    expect(within(section).getByTestId("release-summary")).toHaveTextContent(NOTE.summary!)
    expect(within(section).getByText("a row that can be turned off")).toBeInTheDocument()
    expect(within(section).getByRole("link", { name: /^#22\s*\(opens in a new tab\)$/ })).toHaveAttribute("href", "https://github.com/nodaroai/shell/pull/22")
    const missing = within(section).getByText("Not yet on:").parentElement!
    expect(missing).toHaveTextContent(/app\s*Live\s*Test/)
    expect(missing).toHaveTextContent(/tools\s*Live/)
    expect(missing).not.toHaveTextContent("studio")
  })

  it.each([
    [{ status: "ok", releases: [], older: 0, compared: 4 }, "Every site serves the newest release."],
    // Nothing compared is never said as every site current.
    [{ status: "ok", releases: [], older: 0, compared: 0 }, "No site's version could be compared with a release yet."],
    [{ status: "error", message: "GitHub answered 403: rate limit" }, "GitHub answered 403: rate limit"],
  ])("what changed with no release to list says why: %o", async (releaseNotes, said) => {
    fetchMock.mockImplementation(() => answer({ ...REPORT, releaseNotes }))
    renderPage()
    const section = await screen.findByRole("region", { name: "What changed between the versions" })
    expect(within(section).getByText(said)).toBeInTheDocument()
    if (said !== "Every site serves the newest release.") expect(within(section).queryByText("Every site serves the newest release.")).toBeNull()
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
    expect(screen.queryAllByRole("article")).toHaveLength(0)
    expect(screen.queryByRole("region", { name: "What changed between the versions" })).toBeNull()
  })

  it("without the GitHub token, names the variable and every repository it must read", async () => {
    fetchMock.mockImplementation(() =>
      answer({
        ...REPORT,
        configured: false,
        headerPackage: null,
        latest: { status: "not_configured" },
        releaseNotes: { status: "not_configured" },
        products: [product("tools", { status: "not_configured" }, { status: "not_configured" })],
      }),
    )
    renderPage()
    const setup = await screen.findByTestId("header-versions-setup")
    expect(within(setup).getByText("HEADER_VERSIONS_GITHUB_TOKEN")).toBeInTheDocument()
    expect(within(setup).getByText("acme/tools")).toBeInTheDocument()
    expect(within(setup).getByText("nodaroai/shell")).toBeInTheDocument()
    expect(screen.getAllByText("Needs the GitHub token")).toHaveLength(2)
    // No name to title the header with, no count to give, no releases to list.
    expect(screen.getByText("Shared header")).toBeInTheDocument()
    expect(screen.queryByTestId("up-to-date")).toBeNull()
    expect(screen.queryByRole("region", { name: "What changed between the versions" })).toBeNull()
  })

  it("Refresh asks past the server's kept answer and shows the new one", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("?fresh=1") ? answer({ ...REPORT, products: [product("tools", ok("0.13.0", { standing: "newest" }), ok("0.13.0", { standing: "newest" }))] }) : answer(REPORT),
    )
    renderPage()
    await screen.findByTestId("product-app")
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }))
    await waitFor(() => expect(screen.queryByTestId("product-app")).toBeNull())
    expect(within(site("tools", "production")).getByText("Newest")).toBeInTheDocument()
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
