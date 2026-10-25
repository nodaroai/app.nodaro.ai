// The "upstream hasn't run" state of a node that reads an upstream result
// (Speaker View, Apply EDL), decided 2026-10-08: it says so and offers
// "Run up to here · ≈N". Which nodes count is the run's own set; nothing shows
// once upstream has run.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

const runUpToHere = vi.fn()
let mockRun: unknown = runUpToHere
let mockCredits = true
let mockPrice: { credits: number; hold: number; estimating: boolean; unchecked?: string; approx?: boolean; unpriced?: { message?: string } } = { credits: 240, hold: 240, estimating: false }
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign((s: (x: unknown) => unknown) => s({ runUpToHere: mockRun }), { getState: () => ({}) }),
}))
vi.mock("@/hooks/use-run-from-here-credits", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRunSetPrice: () => mockPrice,
}))
vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasCredits: () => mockCredits,
}))

import { RunUpToHereNotice } from "../run-up-to-here-notice"
import { translate } from "@/lib/i18n"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)
const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } })
const edge = (source: string, target: string) => ({ id: `${source}->${target}`, source, target, targetHandle: "edl" })
const ranPlan = { generatedJson: { version: 1, clock: "master", sources: [], segments: [] } }

afterEach(() => {
  cleanup()
  runUpToHere.mockClear()
  mockRun = runUpToHere
  mockCredits = true
  mockPrice = { credits: 240, hold: 240, estimating: false }
})

const unrun = () => <RunUpToHereNotice nodeId="sv" nodes={[node("plan", "edit-plan"), node("sv", "speaker-view")] as never} edges={[edge("plan", "sv")] as never} />

describe("RunUpToHereNotice", () => {
  it("says upstream has not run and offers Run up to here with the run's price", () => {
    render(unrun())
    expect(screen.getByText(t("runUpToHere.upstreamNotRun"))).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Run up to here · ≈240" }))
    expect(runUpToHere).toHaveBeenCalledWith("sv")
  })

  it("drops the figure where nothing is charged", () => {
    mockCredits = false
    render(unrun())
    expect(screen.getByRole("button", { name: "Run up to here" })).toBeTruthy()
  })

  it("shows nothing once upstream has run", () => {
    const { container } = render(
      <RunUpToHereNotice nodeId="sv" nodes={[node("plan", "edit-plan", ranPlan), node("sv", "speaker-view")] as never} edges={[edge("plan", "sv")] as never} />,
    )
    expect(container.textContent).toBe("")
  })

  it("shows nothing for a node with nothing wired in", () => {
    const { container } = render(<RunUpToHereNotice nodeId="sv" nodes={[node("sv", "speaker-view")] as never} edges={[]} />)
    expect(container.textContent).toBe("")
  })

  it("while the video's price is checked: the editor's own figure, marked as an estimate, and why", () => {
    mockPrice = { credits: 240, hold: 240, estimating: true, unchecked: "checking" }
    render(unrun())
    const button = screen.getByRole("button", { name: t("runUpToHere.buttonEstimate", { credits: 240 }) })
    // `≈` before every estimate (the owner's rule), as the Execute button's `(≈N CR)`.
    expect(button.textContent).toContain("Run up to here · ≈240")
    expect(button.getAttribute("title")).toBe(t("ugc.price.checking"))
  })

  it("a figure that could not be had, or a last answer not checked again: marked, and its own reason", () => {
    mockPrice = { credits: 240, hold: 240, estimating: true, unchecked: "editor" }
    const { unmount } = render(unrun())
    expect(screen.getByRole("button", { name: t("runUpToHere.buttonEstimate", { credits: 240 }) }).getAttribute("title")).toBe(t("ugc.price.unchecked"))
    unmount()
    mockPrice = { credits: 240, hold: 240, estimating: true, unchecked: "held" }
    render(unrun())
    expect(screen.getByRole("button", { name: t("runUpToHere.buttonEstimate", { credits: 240 }) }).getAttribute("title")).toBe(t("ugc.price.uncheckedHeld"))
  })

  it("a figure holding a metered LLM call's estimate reads `≈N`, as Execute does — in every locale", () => {
    mockPrice = { credits: 240, hold: 240, estimating: false, approx: true }
    render(unrun())
    const button = screen.getByRole("button", { name: "Run up to here · ≈240" })
    expect(button.getAttribute("title")).toBe(t("runUpToHere.tooltip"))
    for (const locale of ["en", "he", "ja", "ko", "pt-BR"] as const) {
      const label = translate(locale, "runUpToHere.buttonEstimate", { credits: 240 })
      expect(label, locale).toContain("≈240")
      expect(label, locale).not.toContain("~")
      expect(translate(locale, "runUpToHere.buttonUnpriced"), locale).not.toContain("{")
    }
  })

  it("a node the server refuses to price (llm_model_unpriced): no figure — it says not priced yet, the server's sentence on hover", () => {
    const message = 'The model "x" has no price yet, so it cannot be run. Choose another model.'
    mockPrice = { credits: 200, hold: 200, estimating: false, approx: true, unpriced: { message } }
    render(unrun())
    const button = screen.getByRole("button", { name: "Run up to here · not priced yet" })
    expect(button.getAttribute("title")).toBe(message)
    expect(button.textContent).not.toContain("200")
  })

  it("once the server's figure is in: the plain price and the usual tooltip", () => {
    render(unrun())
    expect(screen.getByRole("button", { name: "Run up to here · ≈240" }).getAttribute("title")).toBe(t("runUpToHere.tooltip"))
  })

  it("where nothing is charged no estimate is marked", () => {
    mockCredits = false
    mockPrice = { credits: 0, hold: 0, estimating: true, unchecked: "checking" }
    render(unrun())
    expect(screen.getByRole("button", { name: "Run up to here" }).getAttribute("title")).toBe(t("runUpToHere.tooltip"))
  })

  it("the button is disabled while no run action is registered (a read-only canvas)", () => {
    mockRun = null
    render(unrun())
    expect((screen.getByRole("button", { name: "Run up to here · ≈240" }) as HTMLButtonElement).disabled).toBe(true)
  })
})
