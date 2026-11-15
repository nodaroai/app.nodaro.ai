import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"

/**
 * `developerApps.manage: "admin"` (decided 2026-11-11): only an admin of the
 * deployment manages developer apps, so the editor does not offer the pages
 * to anyone else (the server refuses their writes either way). Unset: the
 * pages are offered exactly as before.
 */

const auth = vi.hoisted(() => ({ isAdmin: false, roleLoaded: true }))

vi.mock("react-router-dom", () => ({
  Link: ({ children }: { children: unknown }) => children,
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: "00000000-0000-4000-8000-000000000001" }),
}))
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1" }, loading: false, role: auth.isAdmin ? "admin" : null, ...auth }),
}))
vi.mock("@/lib/edition", async (importOriginal) => ({ ...(await importOriginal<object>()), hasAdmin: () => true }))
vi.mock("@/hooks/queries/use-developer-apps-queries", () => {
  const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }
  return {
    useDeveloperApps: () => ({ data: [], isLoading: false }),
    useDeveloperApp: () => ({ data: undefined, isLoading: true, error: null }),
    useCreateDeveloperAppMutation: () => mutation,
    useDeleteDeveloperAppMutation: () => mutation,
    useUpdateDeveloperAppMutation: () => mutation,
    useRotateSecretMutation: () => mutation,
  }
})
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import DeveloperAppsPage from "../page"
import DeveloperAppDetailPage from "../detail/page"

const NOTICE = /developer apps are managed by an administrator/i

function surface(value: unknown) {
  window.__NODARO_RUNTIME__ = { surface: value } as never
}

beforeEach(() => {
  auth.isAdmin = false
  auth.roleLoaded = true
})

afterEach(() => {
  delete window.__NODARO_RUNTIME__
})

describe("developer-app pages under developerApps.manage", () => {
  it("unset: a person is offered the list page as before", () => {
    render(<DeveloperAppsPage />)
    expect(screen.queryByText(NOTICE)).toBeNull()
  })

  it('"admin": a person who is not an admin gets the notice on both pages, and no create control', () => {
    surface({ developerApps: { manage: "admin" } })
    const list = render(<DeveloperAppsPage />)
    expect(screen.getByText(NOTICE)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /new app|create/i })).toBeNull()
    list.unmount()
    render(<DeveloperAppDetailPage />)
    expect(screen.getByText(NOTICE)).toBeInTheDocument()
  })

  it('"admin": an admin is offered the pages', () => {
    surface({ developerApps: { manage: "admin" } })
    auth.isAdmin = true
    render(<DeveloperAppsPage />)
    expect(screen.queryByText(NOTICE)).toBeNull()
  })

  it('"owner": everyone is offered the pages', () => {
    surface({ developerApps: { manage: "owner" } })
    render(<DeveloperAppsPage />)
    expect(screen.queryByText(NOTICE)).toBeNull()
  })
})
