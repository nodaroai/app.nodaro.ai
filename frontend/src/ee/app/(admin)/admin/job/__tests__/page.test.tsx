import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createMemoryRouter, RouterProvider } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/ee/hooks/queries/use-admin-job-page", () => ({
  useAdminJobPage: vi.fn(),
  useAdminChildJobs: vi.fn(),
}))
// The Cast Swap steps box reads its own route; nothing here is a Cast Swap run.
vi.mock("../../jobs/job-generation-details", () => ({
  JobGenerationDetails: () => null,
  JobSkippedSteps: () => null,
  JobStepOutputs: () => null,
}))

import { useAdminChildJobs, useAdminJobPage } from "@/ee/hooks/queries/use-admin-job-page"
import AdminJobPage from "../page"

const ID = "0b1c2d3e-0000-4000-8000-000000000001"

function job(over: Record<string, unknown> = {}) {
  return {
    id: ID, status: "completed", job_type: null, credits: 30, credit: null,
    provider: "kie", provider_cost: null, display_cost: null, error_message: null,
    input_data: { type: "generate-image", prompt: "a red fox in the snow" },
    output_data: { imageUrl: "https://cdn.test/fox.png", text: "the fox, rendered" },
    created_at: "2026-11-01T12:00:00Z", started_at: null, completed_at: null, user_id: "u1", user_email: "dana@x.test",
    workflow_id: null, workflow_name: "Unknown", workflow_execution_id: null, source: null, source_detail: null,
    source_app_name: null, workflow_project_id: null, provider_kind: null, provider_task_id: null,
    reconcile_attempts: 0, reconcile_last_error: null, provider_call_started_at: null,
    parent_job_id: null, child_count: 0,
    ...over,
  }
}

function pageReturns(value: unknown) {
  vi.mocked(useAdminJobPage).mockReturnValue(value as ReturnType<typeof useAdminJobPage>)
}

function renderAt(url: string) {
  const router = createMemoryRouter([
    { path: "/admin/job/:id", element: <AdminJobPage /> },
    { path: "/admin/jobs", element: <p>jobs list</p> },
  ], { initialEntries: [url] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  vi.mocked(useAdminChildJobs).mockReturnValue({ data: undefined, isError: false } as unknown as ReturnType<typeof useAdminChildJobs>)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("AdminJobPage", () => {
  it("reads the job named in the address and shows its input and output together, rendered, without tabs", () => {
    pageReturns({ data: { kind: "found", job: job() }, isError: false })
    renderAt(`/admin/job/${ID}`)
    expect(vi.mocked(useAdminJobPage)).toHaveBeenCalledWith(ID)
    expect(screen.getByText(ID)).toBeTruthy()
    const input = screen.getByRole("region", { name: "Input" })
    const output = screen.getByRole("region", { name: "Output" })
    expect(within(input).getByText("a red fox in the snow")).toBeTruthy()
    expect(within(output).getByText("the fox, rendered")).toBeTruthy()
    expect(within(output).getByRole("img").getAttribute("src")).toBe("https://cdn.test/fox.png")
    expect(screen.queryByRole("tablist")).toBeNull()
    expect(screen.getByText("dana@x.test")).toBeTruthy()
    // No child jobs: no child-jobs section, and none are read.
    expect(screen.queryByRole("region", { name: "Child jobs" })).toBeNull()
    expect(vi.mocked(useAdminChildJobs).mock.lastCall?.[1]).toBe(false)
  })

  it("shows the error in full beside the input and output", () => {
    pageReturns({ data: { kind: "found", job: job({ status: "failed", error_message: "provider said no" }) }, isError: false })
    renderAt(`/admin/job/${ID}`)
    expect(within(screen.getByRole("region", { name: "Error" })).getByText("provider said no")).toBeTruthy()
  })

  it("says when there is no such job, and when it could not be read", () => {
    pageReturns({ data: { kind: "missing" }, isError: false })
    renderAt(`/admin/job/${ID}`)
    expect(screen.getByText(/No job with the id/)).toBeTruthy()
    cleanup()
    pageReturns({ data: undefined, isError: true })
    renderAt(`/admin/job/${ID}`)
    expect(screen.getByText("Couldn't load the job. Try again.")).toBeTruthy()
  })

  it("links a step to the job it is a step of", () => {
    const parent = "9f8e7d6c-0000-4000-8000-000000000009"
    pageReturns({ data: { kind: "found", job: job({ parent_job_id: parent }) }, isError: false })
    renderAt(`/admin/job/${ID}`)
    expect(screen.getByRole("link", { name: parent.slice(0, 8) }).getAttribute("href")).toBe(`/admin/job/${parent}`)
  })

  describe("child jobs", () => {
    const CHILDREN = [
      job({ id: "c1000000-0000-4000-8000-000000000001", job_type: "image-to-image", depth: 1, parent_job_id: ID, input_data: { prompt: "the reference sheet" } }),
      job({ id: "c2000000-0000-4000-8000-000000000002", job_type: "image-to-image", depth: 2, parent_job_id: "c1000000-0000-4000-8000-000000000001", status: "failed" }),
      job({ id: "c3000000-0000-4000-8000-000000000003", job_type: "image-to-video", depth: 1, parent_job_id: ID }),
    ]

    it("offers the child jobs and turns them on in the address", () => {
      pageReturns({ data: { kind: "found", job: job({ child_count: 2 }) }, isError: false })
      const router = renderAt(`/admin/job/${ID}`)
      expect(screen.getByRole("heading", { name: "Child jobs (2 direct)" })).toBeTruthy()
      fireEvent.click(screen.getByRole("button", { name: "Show child jobs" }))
      expect(router.state.location.search).toBe("?children=1")
      expect(vi.mocked(useAdminChildJobs).mock.lastCall).toEqual([ID, true])
    })

    it("with ?children=1, lists the flow in order and shows each step whole", () => {
      pageReturns({ data: { kind: "found", job: job({ child_count: 2 }) }, isError: false })
      vi.mocked(useAdminChildJobs).mockReturnValue({
        data: { jobs: CHILDREN, truncated: false },
        isError: false,
      } as unknown as ReturnType<typeof useAdminChildJobs>)
      renderAt(`/admin/job/${ID}?children=1`)
      expect(vi.mocked(useAdminChildJobs).mock.lastCall).toEqual([ID, true])
      const flow = screen.getByRole("list", { name: "Flow" })
      expect(within(flow).getAllByRole("listitem").map((li) => li.textContent?.match(/^\d+\./)?.[0])).toEqual(["1.", "2.", "3."])
      // Each step: its own page link, and its input rendered.
      for (const c of CHILDREN) {
        const card = document.getElementById(`job-${c.id}`)!
        expect(within(card).getByRole("link", { name: "Open the job page in a new tab" }).getAttribute("href")).toBe(`/admin/job/${c.id}`)
      }
      expect(within(document.getElementById(`job-${CHILDREN[0]!.id}`)!).getByText("the reference sheet")).toBeTruthy()
      expect(screen.getByRole("button", { name: "Hide child jobs" })).toBeTruthy()
    })

    it("says when the child jobs could not be read, or when the run lists more than the page shows", () => {
      pageReturns({ data: { kind: "found", job: job({ child_count: 2 }) }, isError: false })
      vi.mocked(useAdminChildJobs).mockReturnValue({ data: undefined, isError: true } as unknown as ReturnType<typeof useAdminChildJobs>)
      renderAt(`/admin/job/${ID}?children=1`)
      expect(screen.getByText("Couldn't load the child jobs. Try again.")).toBeTruthy()
      cleanup()
      vi.mocked(useAdminChildJobs).mockReturnValue({ data: { jobs: CHILDREN, truncated: true }, isError: false } as unknown as ReturnType<typeof useAdminChildJobs>)
      renderAt(`/admin/job/${ID}?children=1`)
      expect(screen.getByText(/more child jobs than the page lists/)).toBeTruthy()
    })
  })
})
