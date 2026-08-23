import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const h = vi.hoisted(() => {
  class FakeOrgApiError extends Error {
    code: string
    status: number
    constructor(code: string, message: string, status = 400) {
      super(message)
      this.code = code
      this.status = status
    }
  }
  return {
    FakeOrgApiError,
    createOrganization: vi.fn(),
    hydrateWorkspaces: vi.fn(async () => {}),
    navigate: vi.fn(),
  }
})
const FakeOrgApiError = h.FakeOrgApiError

vi.mock("@/ee/lib/orgs-api", () => ({
  OrgApiError: h.FakeOrgApiError,
  createOrganization: h.createOrganization,
}))
vi.mock("@/lib/workspace-context", () => ({ hydrateWorkspaces: h.hydrateWorkspaces }))
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>()
  return { ...actual, useNavigate: () => h.navigate }
})

import NewOrgPage, { slugify } from "../new-org-page"

const ORG = {
  id: "o-1",
  slug: "sunrise-school",
  name: "Sunrise School",
  kind: "school" as const,
  status: "active" as const,
  ownerUserId: "u-1",
  settings: {},
  termsAcceptedAt: null,
  createdAt: "",
  updatedAt: "",
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NewOrgPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const name = () => screen.getByLabelText("Name")
const address = () => screen.getByLabelText("Address")
const create = () => screen.getByRole("button", { name: /create organization/i })
const school = () => screen.getByRole("radio", { name: /School/ })

beforeEach(() => {
  h.createOrganization.mockResolvedValue(ORG)
})
afterEach(() => vi.clearAllMocks())

describe("the kind", () => {
  it("is a choice between two described things, not two words", async () => {
    renderPage()
    expect(school()).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /Team/ })).toBeInTheDocument()
    // What each kind DOES, which is the part that is irreversible.
    expect(screen.getByText(/Work starts private/)).toBeInTheDocument()
    expect(screen.getByText(/Work is visible to the team by default/)).toBeInTheDocument()
  })

  it("defaults to team, and switching is reflected in the control's state", async () => {
    renderPage()
    expect(screen.getByRole("radio", { name: /Team/ })).toHaveAttribute("aria-checked", "true")
    await userEvent.click(school())
    expect(school()).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: /Team/ })).toHaveAttribute("aria-checked", "false")
  })
})

describe("the address field", () => {
  it("follows the name until it is edited, then stops", async () => {
    renderPage()
    await userEvent.type(name(), "Sunrise School")
    expect(address()).toHaveValue("sunrise-school")

    await userEvent.clear(address())
    await userEvent.type(address(), "sunrise")
    await userEvent.type(name(), " North")
    // A field that keeps overwriting what you typed is worse than one that
    // occasionally needs a second look.
    expect(address()).toHaveValue("sunrise")
  })

  it("derives what the server would derive", () => {
    expect(slugify("Sunrise School")).toBe("sunrise-school")
    expect(slugify("  Acme   Design!! ")).toBe("acme-design")
    expect(slugify("!!!")).toBe("")
    expect(slugify("x".repeat(80))).toHaveLength(50)
  })
})

describe("creating", () => {
  it("sends no slug when it was never edited — a derived one is the server's job", async () => {
    renderPage()
    await userEvent.type(name(), "Acme Design")
    await userEvent.click(create())
    await waitFor(() => expect(h.createOrganization).toHaveBeenCalled())
    expect(h.createOrganization).toHaveBeenCalledWith({ name: "Acme Design", kind: "team" })
  })

  it("sends the slug when it WAS chosen", async () => {
    renderPage()
    await userEvent.type(name(), "Acme Design")
    await userEvent.clear(address())
    await userEvent.type(address(), "acme")
    await userEvent.click(create())
    await waitFor(() =>
      expect(h.createOrganization).toHaveBeenCalledWith({ name: "Acme Design", kind: "team", slug: "acme" }),
    )
  })

  it("reloads the memberships and lands in the new organization", async () => {
    h.createOrganization.mockResolvedValue({ ...ORG, kind: "team", slug: "acme" })
    renderPage()
    await userEvent.type(name(), "Acme")
    await userEvent.click(create())
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/org/acme", { replace: true }))
    expect(h.hydrateWorkspaces).toHaveBeenCalled()
  })

  it("explains a PENDING organization instead of navigating into an empty console", async () => {
    h.createOrganization.mockResolvedValue({ ...ORG, status: "pending" })
    renderPage()
    await userEvent.click(school())
    await userEvent.type(name(), "Sunrise School")
    await userEvent.click(screen.getByLabelText(/accept the organization terms/i))
    await userEvent.click(create())
    expect(await screen.findByText(/waiting for approval/i)).toBeInTheDocument()
    expect(screen.getByText(/create classes as soon as it is approved/i)).toBeInTheDocument()
    expect(h.navigate).not.toHaveBeenCalled()
  })
})

describe("the school attestation", () => {
  it("is asked for only by a school, and gates the button", async () => {
    renderPage()
    await userEvent.type(name(), "Acme")
    expect(screen.queryByLabelText(/accept the organization terms/i)).not.toBeInTheDocument()
    expect(create()).toBeEnabled()

    await userEvent.click(school())
    expect(screen.getByLabelText(/accept the organization terms/i)).toBeInTheDocument()
    expect(create()).toBeDisabled()

    await userEvent.click(screen.getByLabelText(/accept the organization terms/i))
    expect(create()).toBeEnabled()
  })

  it("is sent with the request", async () => {
    renderPage()
    await userEvent.click(school())
    await userEvent.type(name(), "Sunrise School")
    await userEvent.click(screen.getByLabelText(/accept the organization terms/i))
    await userEvent.click(create())
    await waitFor(() =>
      expect(h.createOrganization).toHaveBeenCalledWith({
        name: "Sunrise School",
        kind: "school",
        acceptTerms: true,
      }),
    )
  })
})

describe("when it fails", () => {
  async function failWith(error: unknown) {
    h.createOrganization.mockRejectedValue(error)
    renderPage()
    await userEvent.type(name(), "Acme")
    await userEvent.click(create())
  }

  it.each([
    ["name_taken", /address is already taken/i],
    ["rate_limit_exceeded", /created several organizations recently/i],
    ["terms_required", /needs the attestation/i],
  ])("%s is explained", async (code, matcher) => {
    await failWith(new FakeOrgApiError(code, "no"))
    expect(await screen.findByText(matcher)).toBeInTheDocument()
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it("a validation error shows the server's own words", async () => {
    await failWith(new FakeOrgApiError("validation_error", "Slug must be lower-case"))
    expect(await screen.findByText("Slug must be lower-case")).toBeInTheDocument()
  })

  it("leaves the form usable after a transient failure", async () => {
    await failWith(new Error("network"))
    expect(await screen.findByText(/something went wrong creating/i)).toBeInTheDocument()
    expect(create()).toBeEnabled()
  })

  it("will not submit without a name", () => {
    renderPage()
    expect(create()).toBeDisabled()
  })
})
