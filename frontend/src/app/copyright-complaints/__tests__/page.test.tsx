/**
 * The public complaints page: a copyright notice cannot be sent until both
 * statements (read from the server, verbatim) are affirmed and every field
 * is filled; the submission posts the twelve fields; the answer's reference
 * is shown; another complaint needs a category and no statements; the
 * verify link's outcome is shown; the page passes the accessibility checks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import CopyrightComplaintsPage from "../page"
import { useLocaleStore } from "@/lib/locale-store"
import { axeViolations } from "@/test/axe"

const STATEMENTS = { goodFaith: "GOOD FAITH STATEMENT TEXT", accuracy: "ACCURACY STATEMENT TEXT" }

const fetchMock = vi.fn()

function renderPage(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/copyright-complaints${search}`]}>
      <CopyrightComplaintsPage />
    </MemoryRouter>,
  )
}

function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "en", dir: "ltr" })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/v1/content-complaints/statements") return json(200, { data: STATEMENTS })
    return json(202, { data: { reference: "CR-2026-000042", verificationRequired: true } })
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function fillCopyright() {
  fill("Full name", "Dana Example")
  fill("Email address", "dana@example.com")
  fill("Mailing address", "1 Street, Town")
  fill("Phone number", "+1 555 0100")
  fill("The work you hold the rights to", "A short film")
  fill("Where the content is on this service", "https://cdn.example.test/videos/abc.mp4")
  fill("What the infringement is", "Used without permission.")
  fill("Electronic signature (type your full name)", "Dana Example")
}

describe("the copyright notice", () => {
  it("shows the statements from the server and cannot be sent until both are affirmed", async () => {
    renderPage()
    expect(await screen.findByText(STATEMENTS.goodFaith)).toBeInTheDocument()
    expect(screen.getByText(STATEMENTS.accuracy)).toBeInTheDocument()
    const submit = screen.getByRole("button", { name: "Submit the complaint" })
    expect(submit).toHaveAttribute("aria-disabled", "true")
    fillCopyright()
    fireEvent.click(submit)
    expect(fetchMock).toHaveBeenCalledTimes(1) // the statements only
    fireEvent.click(screen.getByLabelText(STATEMENTS.goodFaith))
    expect(submit).toHaveAttribute("aria-disabled", "true")
    fireEvent.click(screen.getByLabelText(STATEMENTS.accuracy))
    expect(submit).not.toHaveAttribute("aria-disabled")
  })

  it("posts the twelve fields with both statements affirmed, then shows the reference", async () => {
    renderPage()
    await screen.findByText(STATEMENTS.goodFaith)
    fillCopyright()
    fireEvent.click(screen.getByLabelText(STATEMENTS.goodFaith))
    fireEvent.click(screen.getByLabelText(STATEMENTS.accuracy))
    fireEvent.click(screen.getByRole("button", { name: "Submit the complaint" }))
    await screen.findByText("Complaint received")
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe("/v1/content-complaints")
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "copyright",
      name: "Dana Example",
      email: "dana@example.com",
      reportedContent: "https://cdn.example.test/videos/abc.mp4",
      explanation: "Used without permission.",
      address: "1 Street, Town",
      phone: "+1 555 0100",
      claimantRole: "owner",
      originalWork: "A short film",
      signature: "Dana Example",
      goodFaith: true,
      accuracy: true,
    })
    expect(screen.getByText(/CR-2026-000042/)).toBeInTheDocument()
  })

  it("until the statements are here the boxes cannot be ticked; when they cannot be loaded the form says so and offers another try", async () => {
    let fail = true
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/v1/content-complaints/statements") return fail ? json(500, {}) : json(200, { data: STATEMENTS })
      return json(202, { data: { reference: "CR-2026-000042", verificationRequired: true } })
    })
    renderPage()
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded")
    expect(screen.queryByLabelText(STATEMENTS.goodFaith)).not.toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByText(STATEMENTS.goodFaith)).toBeInTheDocument()
    expect(screen.getByLabelText(STATEMENTS.goodFaith)).not.toBeDisabled()
  })

  it("a missing field is named and nothing is sent", async () => {
    renderPage()
    await screen.findByText(STATEMENTS.goodFaith)
    fillCopyright()
    fill("Electronic signature (type your full name)", "")
    fireEvent.click(screen.getByLabelText(STATEMENTS.goodFaith))
    fireEvent.click(screen.getByLabelText(STATEMENTS.accuracy))
    fireEvent.click(screen.getByRole("button", { name: "Submit the complaint" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Required.")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("another complaint", () => {
  it("needs a category and the common fields, and sends no statements", async () => {
    renderPage()
    await screen.findByText(STATEMENTS.goodFaith)
    fireEvent.click(screen.getByLabelText("Another complaint"))
    expect(screen.queryByText(STATEMENTS.goodFaith)).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("Unauthorized voice use"))
    fill("Full name", "A")
    fill("Email address", "a@example.com")
    fill("Where the content is on this service", "https://x.test/1")
    fill("What happened", "my voice")
    fireEvent.click(screen.getByRole("button", { name: "Submit the complaint" }))
    await screen.findByText("Complaint received")
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "other",
      name: "A",
      email: "a@example.com",
      reportedContent: "https://x.test/1",
      explanation: "my voice",
      category: "voice",
    })
  })

  it("a refusal is shown and the form stays", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/v1/content-complaints/statements" ? json(200, { data: STATEMENTS }) : json(429, { error: { code: "rate_limited" } }),
    )
    renderPage()
    await screen.findByText(STATEMENTS.goodFaith)
    fireEvent.click(screen.getByLabelText("Another complaint"))
    fill("Full name", "A")
    fill("Email address", "a@example.com")
    fill("Where the content is on this service", "https://x.test/1")
    fill("What happened", "my voice")
    fireEvent.click(screen.getByRole("button", { name: "Submit the complaint" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many submissions")
    expect(screen.getByRole("button", { name: "Submit the complaint" })).toBeInTheDocument()
  })
})

describe("the verify link's outcome", () => {
  it("says the email is confirmed, or that the link is no longer valid", async () => {
    const ok = renderPage("?verified=ok")
    expect(screen.getByRole("status")).toHaveTextContent("your email is confirmed")
    ok.unmount()
    renderPage("?verified=invalid")
    expect(screen.getByRole("alert")).toHaveTextContent("no longer valid")
  })
})

describe("accessibility", () => {
  it("passes the checks with the statements shown", async () => {
    const { container } = renderPage()
    await screen.findByText(STATEMENTS.goodFaith)
    await waitFor(async () => expect(await axeViolations(container)).toEqual([]))
  })
})
