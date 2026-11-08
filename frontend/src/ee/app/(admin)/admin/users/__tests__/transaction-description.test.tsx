/**
 * A ledger line on the Users page: one charged for a job links to that job's
 * own page (the narrow column cuts the id out of the text), and the whole
 * text is on hover either way.
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TransactionDescription } from "../user-expanded-row"

function renderLine(tx: { description: string | null; job_id?: string | null }) {
  return render(
    <MemoryRouter>
      <TransactionDescription tx={tx} />
    </MemoryRouter>,
  )
}

describe("TransactionDescription", () => {
  it("links a job's line to the job's own page, its whole text on hover", () => {
    const description = "Job 3f2a9c1e-0b7d-4e55-9a10-6c2d8e4f7b21: seedance-2-5"
    renderLine({ description, job_id: "3f2a9c1e-0b7d-4e55-9a10-6c2d8e4f7b21" })
    const link = screen.getByRole("link", { name: description })
    expect(link).toHaveAttribute("href", "/admin/job/3f2a9c1e-0b7d-4e55-9a10-6c2d8e4f7b21")
    expect(link).toHaveAttribute("title", description)
  })

  it("leaves a line with no job as text", () => {
    renderLine({ description: "Monthly grant", job_id: null })
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(screen.getByText("Monthly grant")).toHaveAttribute("title", "Monthly grant")
  })

  it("shows a dash for a line with no description", () => {
    renderLine({ description: null })
    expect(screen.getByText("-")).not.toHaveAttribute("title")
  })
})
