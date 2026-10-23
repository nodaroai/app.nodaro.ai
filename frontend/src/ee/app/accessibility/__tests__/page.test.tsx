import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import AccessibilityStatementPage, { REPORT_EMAIL } from "../page"
import { axeViolations } from "@/test/axe"

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer t" }) }))

/**
 * The accessibility statement (reg 35ה): Hebrew whatever the interface
 * language, the three required parts (what was done, what is not accessible
 * yet, how to report) plus the date, no coordinator (fewer than 25 employees),
 * and a report form that either reaches us or hands over the email.
 */

function renderPage() {
  return render(
    <MemoryRouter>
      <AccessibilityStatementPage />
    </MemoryRouter>,
  )
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("accessibility statement page", () => {
  it("is Hebrew and right-to-left whatever the interface language", () => {
    const { container } = renderPage()
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute("lang")).toBe("he")
    expect(root.getAttribute("dir")).toBe("rtl")
    expect(document.title).toContain("הצהרת נגישות")
    expect(document.documentElement.lang).toBe("he")
    expect(document.documentElement.dir).toBe("rtl")
  })

  it("gives the interface its own language back on leave", () => {
    document.documentElement.lang = "en"
    document.documentElement.dir = "ltr"
    const { unmount } = renderPage()
    unmount()
    expect(document.documentElement.lang).toBe("en")
    expect(document.documentElement.dir).toBe("ltr")
  })

  it("has the required parts: level, what was done, what is not accessible, how to report, the date", () => {
    renderPage()
    expect(screen.getByRole("heading", { level: 1, name: "הצהרת נגישות" })).toBeInTheDocument()
    for (const name of ["רמת הנגישות", "מה כבר עשינו", "מה עוד לא נגיש", "נתקלתם בבעיית נגישות?"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument()
    }
    expect(screen.getByText(/ת״י 5568/)).toBeInTheDocument()
    expect(screen.getByText(/WCAG 2\.0 ברמה AA/)).toBeInTheDocument()
    expect(screen.getByText(/עודכנה לאחרונה/)).toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: REPORT_EMAIL })[0]).toHaveAttribute("href", `mailto:${REPORT_EMAIL}`)
  })

  it("names no accessibility coordinator", () => {
    const { container } = renderPage()
    expect(container.textContent).not.toMatch(/רכז/)
  })

  it("passes the automated WCAG 2.0 A/AA checks", async () => {
    const { container } = renderPage()
    expect(await axeViolations(container)).toEqual([])
  })
})

describe("report form", () => {
  it("asks for a description before sending anything", async () => {
    renderPage()
    fireEvent.click(screen.getByRole("button", { name: "שליחת הדיווח" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("כתבו כמה מילים")
    expect(document.activeElement).toBe(screen.getByLabelText(/מה הבעיה/))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sends the report and confirms it arrived", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    renderPage()
    fireEvent.change(screen.getByLabelText(/מה הבעיה/), { target: { value: "אין שם לכפתור ההפעלה" } })
    fireEvent.change(screen.getByLabelText(/באיזה דף/), { target: { value: "/projects" } })
    fireEvent.click(screen.getByRole("button", { name: "שליחת הדיווח" }))
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("הדיווח הגיע אלינו"))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/v1/accessibility/report")
    expect(JSON.parse(init.body as string)).toEqual({ message: "אין שם לכפתור ההפעלה", page: "/projects" })
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t")
  })

  it("hands over the email when the report could not be delivered", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }))
    renderPage()
    fireEvent.change(screen.getByLabelText(/מה הבעיה/), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: "שליחת הדיווח" }))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("הדיווח לא נשלח")
    expect(alert.querySelector(`a[href="mailto:${REPORT_EMAIL}"]`)).not.toBeNull()
  })
})
