/**
 * The import sources card: lists what the server has, adds a site, refuses to
 * save a bad or duplicated domain, saves the list whole and is clean after.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer t" }) }))

import { ImportSourcesCard } from "../import-sources-card"

const fetchMock = vi.fn()
const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }))

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function renderCard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ImportSourcesCard />
    </QueryClientProvider>,
  )
}

describe("ImportSourcesCard", () => {
  it("lists the sites, adds one, refuses a bad domain, and saves the list whole", async () => {
    let stored: unknown = [{ domain: "blocked.test", status: "disabled", note: "legal" }]
    let version = "1:100"
    const sentVersions: string[] = []
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { policies: unknown; version: string }
        sentVersions.push(body.version)
        stored = body.policies
        version = "2:200"
        return answer({ data: stored, version })
      }
      return answer({ data: stored, version })
    })
    renderCard()
    expect(await screen.findByLabelText("Domain of blocked.test")).toHaveValue("blocked.test")
    const save = screen.getByRole("button", { name: "Save sites" })
    expect(save).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: /Add site/ }))
    expect(save).toBeDisabled()
    expect(screen.getByRole("alert")).toHaveTextContent("Every site needs a domain such as example.com.")
    fireEvent.change(screen.getByLabelText("Domain of site 2"), { target: { value: ".fine.test" } })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Domain of .fine.test"), { target: { value: "WWW.www.Fine.test." } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/v1/admin/import-sources", expect.objectContaining({ method: "PUT" })))
    expect(sentVersions).toEqual(["1:100"])
    expect(stored).toEqual([
      { domain: "blocked.test", status: "disabled", note: "legal" },
      { domain: "fine.test", status: "approved", note: null },
    ])
    await waitFor(() => expect(screen.getByRole("button", { name: "Save sites" })).toBeDisabled())
  })

  it("a list another admin changed since it was loaded shows the server's message and keeps the edits", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "PUT"
        ? answer({ error: { code: "import_sources_changed", message: "The import sources changed since they were loaded. Reload and try again." } }, 409)
        : answer({ data: [], version: "0:0" }),
    )
    renderCard()
    expect(await screen.findByText("No sites listed: every site is approved.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Add site/ }))
    fireEvent.change(screen.getByLabelText("Domain of site 1"), { target: { value: "new.test" } })
    fireEvent.click(screen.getByRole("button", { name: "Save sites" }))
    expect(await screen.findByText("The import sources changed since they were loaded. Reload and try again.")).toBeInTheDocument()
    expect(screen.getByLabelText("Domain of new.test")).toHaveValue("new.test")
  })

  it("refuses a duplicated domain and Remove takes a site out", async () => {
    fetchMock.mockImplementation(() => answer({ data: [{ domain: "a.test", status: "approved", note: null }], version: "1:1" }))
    renderCard()
    await screen.findByLabelText("Domain of a.test")
    fireEvent.click(screen.getByRole("button", { name: /Add site/ }))
    fireEvent.change(screen.getByLabelText("Domain of site 2"), { target: { value: "a.test" } })
    expect(screen.getByRole("alert")).toHaveTextContent("A domain is listed twice.")
    expect(screen.getByRole("button", { name: "Save sites" })).toBeDisabled()
    fireEvent.click(screen.getAllByRole("button", { name: "Remove a.test" })[0]!)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    // What is left is the saved list again, so there is nothing to save.
    expect(screen.getByRole("button", { name: "Save sites" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Remove a.test" }))
    expect(screen.getByText("No sites listed: every site is approved.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save sites" })).toBeEnabled()
  })
})
