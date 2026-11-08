import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createMemoryRouter, RouterProvider } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/ee/hooks/queries/use-admin-queries", () => ({
  useAdminJobDetail: vi.fn(),
  useAdminJobs: vi.fn(),
  useAdminJobsInfinite: vi.fn(),
  useAdminJobSources: vi.fn(),
}))
vi.mock("@/ee/hooks/queries/use-admin-user-lookup", () => ({
  useAdminAccounts: vi.fn(),
  useAdminUserByEmail: vi.fn(),
  useAdminUserSearch: vi.fn(),
  // The debounce is the hooks' own; here a value settles at once.
  useDebouncedValue: <T,>(v: T) => v,
}))

import {
  useAdminJobDetail,
  useAdminJobs,
  useAdminJobsInfinite,
  useAdminJobSources,
} from "@/ee/hooks/queries/use-admin-queries"
import { useAdminAccounts, useAdminUserByEmail, useAdminUserSearch } from "@/ee/hooks/queries/use-admin-user-lookup"
import AdminJobsPage from "../page"

const ADMINS = [{ id: "a1", email: "admin@x.test", fullName: null, role: "admin" as const }]
/** An account no list loaded up front: the server finds it by part of its address, or by the whole of it. */
const LEAD = { id: "t1", email: "ops.lead@example.com", fullName: "Ops Lead", role: "super_admin" as const }

function usersLoaded(loaded: boolean) {
  vi.mocked(useAdminAccounts).mockReturnValue(
    (loaded
      ? { data: ADMINS, isSuccess: true, isError: false }
      : { data: undefined, isSuccess: false, isError: false }) as unknown as ReturnType<typeof useAdminAccounts>,
  )
}

function serverAccounts() {
  vi.mocked(useAdminUserSearch).mockImplementation(
    (term: string) =>
      ({
        data: term && "ops.lead@example.com ops lead".includes(term.toLowerCase()) ? [LEAD] : [],
        isFetching: false,
      }) as unknown as ReturnType<typeof useAdminUserSearch>,
  )
  vi.mocked(useAdminUserByEmail).mockImplementation(
    (email: string | undefined) =>
      ({
        data: !email ? undefined : email === LEAD.email ? LEAD : null,
        isFetching: false,
        isError: false,
      }) as unknown as ReturnType<typeof useAdminUserByEmail>,
  )
}

function renderAt(url: string) {
  const router = createMemoryRouter([{ path: "/admin/jobs", element: <AdminJobsPage /> }], { initialEntries: [url] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const lastJobsCall = () => vi.mocked(useAdminJobs).mock.calls.at(-1)!

beforeEach(() => {
  vi.mocked(useAdminJobs).mockReturnValue({
    data: { jobs: [], userNotFound: true, filtersUnavailable: false },
    isLoading: false,
  } as unknown as ReturnType<typeof useAdminJobs>)
  vi.mocked(useAdminJobSources).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useAdminJobSources>)
  vi.mocked(useAdminJobDetail).mockReturnValue({ data: undefined, isError: false } as unknown as ReturnType<typeof useAdminJobDetail>)
  usersLoaded(true)
  serverAccounts()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("AdminJobsPage", () => {
  it("opens with the URL's filters applied, and says when the address matches no account", () => {
    renderAt("/admin/jobs?user=dana@x.test&kind=video&minCredits=100")
    const [page, size, filters, , options] = lastJobsCall()
    expect([page, size]).toEqual([0, 50])
    expect(filters).toMatchObject({ userEmail: "dana@x.test", kind: "video", minCredits: 100, view: "table" })
    expect(options).toEqual({ enabled: true })
    expect(screen.getByRole("button", { name: "Clear Credits ≥ 100" })).toBeTruthy()
    expect(screen.getByText("No user with that email")).toBeTruthy()
  })

  it("a pick writes the URL as a new step; a typed search replaces the current one", async () => {
    const router = renderAt("/admin/jobs?kind=video")
    await userEvent.click(screen.getByRole("button", { name: "pending_review" }))
    expect(router.state.location.search).toBe("?status=pending_review&kind=video")
    expect(router.state.historyAction).toBe("PUSH")
    expect(lastJobsCall()[2]).toMatchObject({ status: "pending_review", kind: "video" })

    vi.useFakeTimers()
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "cats" } })
    act(() => vi.advanceTimersByTime(300))
    expect(router.state.location.search).toBe("?status=pending_review&kind=video&q=cats")
    expect(router.state.historyAction).toBe("REPLACE")
  })

  it("says the list failed to load instead of finding no jobs", () => {
    vi.mocked(useAdminJobs).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useAdminJobs>)
    renderAt("/admin/jobs")
    expect(screen.getByText("Couldn't load jobs. Try again.")).toBeTruthy()
    expect(screen.queryByText("No jobs found.")).toBeNull()
  })

  it("a link that hides the admins waits for the admin list before asking for jobs", () => {
    usersLoaded(false)
    renderAt("/admin/jobs?user=admins-hidden")
    expect(lastJobsCall()[4]).toEqual({ enabled: false })
    expect(screen.queryByText("No jobs found.")).toBeNull()
    cleanup()
    usersLoaded(true)
    renderAt("/admin/jobs?user=admins-hidden")
    const [, , filters, excluded, options] = lastJobsCall()
    expect(filters).toMatchObject({ excludeAdmins: true })
    expect(excluded).toEqual(["a1"])
    expect(options).toEqual({ enabled: true })
  })

  describe("finding an account", () => {
    it("the picked account is named from the server, whatever the loaded lists hold", () => {
      renderAt("/admin/jobs?user=ops.lead@example.com")
      expect(vi.mocked(useAdminUserByEmail)).toHaveBeenCalledWith("ops.lead@example.com")
      expect(screen.getByRole("combobox", { name: /user/i }).textContent).toContain("Ops Lead")
    })

    it("the User picker searches every account on the server", async () => {
      const router = renderAt("/admin/jobs")
      await userEvent.click(screen.getByRole("combobox", { name: /user/i }))
      await userEvent.type(screen.getByPlaceholderText(/search/i), "ops.le")
      expect(vi.mocked(useAdminUserSearch)).toHaveBeenCalledWith("ops.le")
      await userEvent.click(screen.getByRole("option", { name: /ops\.lead@example\.com/ }))
      expect(router.state.location.search).toBe("?user=ops.lead%40example.com")
    })

    it("part of an address in the search box offers the account; picking it sets the User filter", async () => {
      const router = renderAt("/admin/jobs")
      const box = screen.getByRole("searchbox", { name: "Search" })
      await userEvent.type(box, "ops.lead")
      const offered = screen.getByRole("list", { name: "Accounts matching" })
      await userEvent.click(within(offered).getByRole("button", { name: /ops\.lead@example\.com/ }))
      expect(router.state.location.search).toBe("?user=ops.lead%40example.com")
      expect((box as HTMLInputElement).value).toBe("")
    })

    it("a whole address that is an account becomes the User filter, never a prompt search", () => {
      const router = renderAt("/admin/jobs")
      fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "Ops.Lead@example.com" } })
      expect(router.state.location.search).toBe("?user=ops.lead%40example.com")
      expect(lastJobsCall()[2]).toMatchObject({ userEmail: "ops.lead@example.com" })
      expect(lastJobsCall()[2].q).toBeUndefined()
    })

    it("a whole address no account has is searched as text", () => {
      const router = renderAt("/admin/jobs")
      fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "nobody@x.test" } })
      expect(router.state.location.search).toBe("?q=nobody%40x.test")
    })
  })

  const NOTICE = "These filters arrive with the next release — showing jobs by status and user only."

  it("the table says when the server could not apply the newer filters", () => {
    vi.mocked(useAdminJobs).mockReturnValue({
      data: { jobs: [], userNotFound: false, filtersUnavailable: true },
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminJobs>)
    renderAt("/admin/jobs?kind=video")
    expect(screen.getByText(NOTICE)).toBeTruthy()
  })

  it("the table shows no notice when every filter applied", () => {
    renderAt("/admin/jobs?kind=video")
    expect(screen.queryByText(NOTICE)).toBeNull()
  })

  it("the gallery says when the server could not apply the newer filters", () => {
    vi.mocked(useAdminJobsInfinite).mockReturnValue({
      data: { pages: [{ jobs: [], userNotFound: false, filtersUnavailable: true }] },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useAdminJobsInfinite>)
    renderAt("/admin/jobs?view=gallery&kind=video")
    expect(screen.getByText(NOTICE)).toBeTruthy()
  })

  describe("the detail view", () => {
    // A list row: its input and output are previews (the type; the output's addresses).
    const ROW = {
      id: "0b1c2d3e-0000-4000-8000-000000000001", status: "completed", job_type: null, credits: 30, credit: null,
      provider: "kie", provider_cost: null, display_cost: null, error_message: null,
      input_data: { type: "generate-image" }, output_data: { imageUrl: "https://cdn.test/fox.png" },
      created_at: "2026-11-01T12:00:00Z", started_at: null, completed_at: null, user_id: "u1", user_email: "dana@x.test",
      workflow_id: null, workflow_name: "Unknown", workflow_execution_id: null, source: null, source_detail: null,
      source_app_name: null, workflow_project_id: null, provider_kind: null, provider_task_id: null,
      reconcile_attempts: 0, reconcile_last_error: null, provider_call_started_at: null,
    }

    function openDetail() {
      vi.mocked(useAdminJobs).mockReturnValue({
        data: { jobs: [ROW], userNotFound: false, filtersUnavailable: false },
        isLoading: false,
      } as unknown as ReturnType<typeof useAdminJobs>)
      renderAt("/admin/jobs")
      const row = screen.getByText(ROW.id.slice(0, 8)).closest("tr")!
      fireEvent.click(within(row).getAllByRole("button").at(-1)!)
      return screen.getByRole("dialog")
    }

    it("reads the whole job when it opens, and shows a loader — never the list's preview — until it is in", () => {
      const dialog = openDetail()
      expect(vi.mocked(useAdminJobDetail).mock.lastCall?.[0]).toMatchObject({ id: ROW.id, status: ROW.status, completed_at: ROW.completed_at })
      expect(within(dialog).getByLabelText("Loading the job's input and output")).toBeTruthy()
    })

    it("shows the whole input once it is read", () => {
      vi.mocked(useAdminJobDetail).mockReturnValue({
        data: { input_data: { type: "generate-image", prompt: "a red fox in the snow" }, output_data: { imageUrl: "https://cdn.test/fox.png", seed: 7 } },
        isError: false,
      } as unknown as ReturnType<typeof useAdminJobDetail>)
      const dialog = openDetail()
      expect(within(dialog).getByText("a red fox in the snow")).toBeTruthy()
    })

    it("a row has two info buttons: the dialog, and the job's page in a new tab; the dialog links the page too", () => {
      vi.mocked(useAdminJobs).mockReturnValue({
        data: { jobs: [ROW], userNotFound: false, filtersUnavailable: false },
        isLoading: false,
      } as unknown as ReturnType<typeof useAdminJobs>)
      renderAt("/admin/jobs")
      const row = screen.getByText(ROW.id.slice(0, 8)).closest("tr")!
      expect(within(row).getByRole("button", { name: "Job details" })).toBeTruthy()
      const page = within(row).getByRole("link", { name: "Open the job page in a new tab" })
      expect(page.getAttribute("href")).toBe(`/admin/job/${ROW.id}`)
      expect(page.getAttribute("target")).toBe("_blank")
      expect(page.getAttribute("rel")).toContain("noopener")
      fireEvent.click(within(row).getByRole("button", { name: "Job details" }))
      const inDialog = within(screen.getByRole("dialog")).getByRole("link", { name: "Open the job page in a new tab" })
      expect(inDialog.getAttribute("href")).toBe(`/admin/job/${ROW.id}`)
    })

    it("says when the whole job could not be read", () => {
      vi.mocked(useAdminJobDetail).mockReturnValue({ data: undefined, isError: true } as unknown as ReturnType<typeof useAdminJobDetail>)
      const dialog = openDetail()
      expect(within(dialog).getByText("Couldn't load the job's input and output.")).toBeTruthy()
    })
  })
})
