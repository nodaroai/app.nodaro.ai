import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import AccessibilityStatementPage, { REPORT_EMAIL } from "../page"
import { STATEMENT_CONTENT, statementFor } from "../statement-content"
import { useLocaleStore } from "@/lib/locale-store"
import { axeViolations } from "@/test/axe"

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer t" }) }))

/**
 * The accessibility statement (reg 35ה): in the interface language (English for
 * a language without its own copy), every copy with the same parts (level, what
 * was done, the menu, what is not fully accessible, how to report) plus the
 * date, no coordinator (fewer than 25 employees), and a report form that either
 * reaches us or hands over the email.
 */

function useLocale(locale: "he" | "en" | "ja" | "ar") {
  useLocaleStore.setState({ locale, dir: locale === "he" || locale === "ar" ? "rtl" : "ltr" })
}

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
  useLocale("he")
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("accessibility statement page", () => {
  it("is Hebrew and right-to-left in the Hebrew interface", () => {
    const { container } = renderPage()
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute("lang")).toBe("he")
    expect(root.getAttribute("dir")).toBe("rtl")
    expect(document.title).toContain("הצהרת נגישות")
    expect(document.documentElement.lang).toBe("he")
    expect(document.documentElement.dir).toBe("rtl")
  })

  it("follows the interface language, and reads English where a language has no copy", () => {
    useLocale("en")
    const { unmount } = renderPage()
    expect(screen.getByRole("heading", { level: 1, name: "Accessibility statement" })).toBeInTheDocument()
    expect(document.documentElement.dir).toBe("ltr")
    unmount()

    useLocale("ja")
    const ja = renderPage()
    expect(screen.getByRole("heading", { level: 1, name: "アクセシビリティ方針" })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe("ja")
    ja.unmount()

    useLocale("ar")
    renderPage()
    expect(screen.getByRole("heading", { level: 1, name: "Accessibility statement" })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe("en")
    expect(document.documentElement.dir).toBe("ltr")
  })

  it("says the same thing in every language: the same parts, nothing left empty", () => {
    const he = statementFor("he")
    for (const [locale, copy] of Object.entries(STATEMENT_CONTENT)) {
      expect(copy?.done.length, locale).toBe(he.done.length)
      expect(copy?.limits.length, locale).toBe(he.limits.length)
      const strings = [
        ...Object.entries(copy ?? {}).filter(([, v]) => typeof v === "string").map(([, v]) => v as string),
        ...Object.values(copy?.form ?? {}),
        ...(copy?.done ?? []),
        ...(copy?.limits ?? []),
      ]
      for (const value of strings) expect(value.trim(), locale).not.toBe("")
      expect(copy?.level, locale).toMatch(/5568/)
      expect(copy?.level, locale).toMatch(/WCAG 2\.0/)
      expect(copy?.menu, locale).toMatch(/Alt\+A/)
    }
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
    for (const name of ["רמת הנגישות", "מה הונגש באתר", "תפריט הנגישות", "רכיבים שאינם נגישים במלואם", "נתקלתם בבעיית נגישות?"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument()
    }
    expect(screen.getByText(/ת״י 5568/)).toBeInTheDocument()
    expect(screen.getAllByText(/WCAG 2\.0 ברמה AA/).length).toBeGreaterThan(0)
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
