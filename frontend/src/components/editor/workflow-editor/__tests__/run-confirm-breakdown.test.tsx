import { describe, it, expect, afterEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { useLocaleStore } from "@/lib/locale-store"
import { LABELS_HE } from "@/lib/i18n/labels.he"
import { RunConfirmBreakdown } from "../run-confirm-breakdown"
import { runConfirmText } from "../run-confirm-dialog"
import { tx } from "@/lib/i18n"
import type { LocaleId } from "@nodaro/shared"
import type { RunConfirmInfo, RunConfirmLine } from "../types"

afterEach(() => {
  useLocaleStore.setState({ locale: "en" })
  delete window.__NODARO_RUNTIME__
})

/**
 * U1 (R16 a, decided 2026-10-06): the Render final and Update preview confirms
 * show a price per node, a total from those same lines, what is kept as is,
 * and what an Update preview leaves for Render final (mockups M12–M16).
 */
const line = (nodeId: string, label: string, credits: number, extra: Partial<RunConfirmLine> = {}): RunConfirmLine => ({
  nodeId,
  label,
  quantity: { fanOut: 1, units: 1, unitKind: null },
  credits,
  ...extra,
})
const CUT = line("cut", "Apply Cut", 480, { quantity: { fanOut: 1, units: 48, unitKind: "minute" }, renderQuality: "final" })
const CAP = line("cap", "Add Captions", 50)
const info = (extra: Partial<RunConfirmInfo>): RunConfirmInfo => ({
  trigger: "render-final",
  nodeCount: 2,
  estimatedCredits: 530,
  alwaysConfirm: true,
  lines: [CUT, CAP],
  kept: ["Transcribe", "Silence", "Tighten Plan"],
  gated: [],
  ...extra,
})

describe("RunConfirmBreakdown", () => {
  it("M12: one row per node with its quantity and credits, the total, and what is kept as is", () => {
    render(<RunConfirmBreakdown info={info({})} />)
    expect(screen.getByText("Apply Cut")).toBeTruthy()
    expect(screen.getByText("final · 48 min")).toBeTruthy()
    expect(screen.getByText("480")).toBeTruthy()
    expect(screen.getByText("Add Captions")).toBeTruthy()
    expect(screen.getByText("50")).toBeTruthy()
    expect(screen.getByText("Total")).toBeTruthy()
    expect(screen.getByText("≈530 credits")).toBeTruthy()
    expect(screen.getByText("Kept as is: Transcribe, Silence, Tighten Plan")).toBeTruthy()
  })

  it("M13: a node that runs before the render says so", () => {
    const cam = line("cam", "Camera Switch", 10, { rerunsFirst: true })
    render(<RunConfirmBreakdown info={info({ lines: [cam, CUT, CAP], estimatedCredits: 540 })} />)
    expect(screen.getByText("re-runs first")).toBeTruthy()
  })

  it("M14: a node that runs once per clip shows how many times, and the render its minutes in all", () => {
    const clip = line("cut", "Render Clip", 120, { quantity: { fanOut: 6, units: 2, unitKind: "minute" }, renderQuality: "final" })
    const cc = line("cc", "Caption Clip", 300, { quantity: { fanOut: 6, units: 1, unitKind: null } })
    render(<RunConfirmBreakdown info={info({ lines: [clip, cc], estimatedCredits: 420 })} />)
    expect(screen.getByText("final · ×6 · 12 min")).toBeTruthy()
    expect(screen.getByText("×6")).toBeTruthy()
  })

  it("M15: Update preview names what waits for Render final, unpriced", () => {
    const preview = line("cut", "Apply Cut", 48, { quantity: { fanOut: 1, units: 48, unitKind: "minute" }, renderQuality: "proxy" })
    render(<RunConfirmBreakdown info={info({ trigger: "update-preview", alwaysConfirm: false, lines: [preview], estimatedCredits: 48, gated: ["Add Captions"], kept: [] })} />)
    expect(screen.getByText("preview · 48 min")).toBeTruthy()
    expect(screen.getByText("After Render final, not billed now: Add Captions")).toBeTruthy()
    expect(screen.queryByText(/Kept as is/)).toBeNull()
  })

  it("M16: a non-credit edition lists what runs with no numbers", () => {
    render(<RunConfirmBreakdown info={info({ estimatedCredits: null, kept: ["Transcribe", "Tighten Plan"] })} />)
    expect(screen.getByText("Runs: Apply Cut (final · 48 min), Add Captions")).toBeTruthy()
    expect(screen.getByText("Kept as is: Transcribe, Tighten Plan")).toBeTruthy()
    expect(screen.queryByText("Total")).toBeNull()
    expect(screen.queryByText("480")).toBeNull()
  })

  it("more than 6 lines: the first 5 show, then the rest folds under one row that expands", () => {
    const many = Array.from({ length: 8 }, (_, i) => line(`n${i}`, `Node ${i}`, 10 + i))
    render(<RunConfirmBreakdown info={info({ lines: many, estimatedCredits: many.reduce((s, l) => s + l.credits, 0) })} />)
    expect(screen.getByText("Node 4")).toBeTruthy()
    expect(screen.queryByText("Node 5")).toBeNull()
    // 15 + 16 + 17 = 48
    fireEvent.click(screen.getByRole("button", { name: "+ 3 more · 48" }))
    expect(screen.getByText("Node 7")).toBeTruthy()
  })

  it("exactly 6 lines all show", () => {
    const six = Array.from({ length: 6 }, (_, i) => line(`n${i}`, `Node ${i}`, 10))
    render(<RunConfirmBreakdown info={info({ lines: six, estimatedCredits: 60 })} />)
    expect(screen.getByText("Node 5")).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("renders nothing for a run that carries no lines (every other confirm)", () => {
    const { container } = render(<RunConfirmBreakdown info={info({ lines: undefined, kept: undefined, gated: undefined })} />)
    expect(container.textContent).toBe("")
  })

  it("names translate the way the canvas header does: rows, Kept as is (grouped after translating), the gated line and the Runs list", () => {
    useLocaleStore.setState({ locale: "he" })
    const he = LABELS_HE.node
    const cut = line("cut", "Apply EDL", 480, { quantity: { fanOut: 1, units: 48, unitKind: "minute" }, renderQuality: "final" })
    const { container, unmount } = render(
      <RunConfirmBreakdown info={info({ lines: [cut, CAP], kept: ["Transcribe", "Transcribe", "Transcribe", "My Plan"], gated: ["Add Captions"] })} />,
    )
    expect(screen.getByText(he["Apply EDL"]!)).toBeTruthy()
    expect(screen.getByText(he["Add Captions"]!)).toBeTruthy()
    expect(container.textContent).toContain(`${he["Transcribe"]} ×3`)
    expect(container.textContent).toContain("My Plan") // a rename passes through
    expect(container.textContent).not.toContain("Apply EDL")
    unmount()
    const { container: plain } = render(<RunConfirmBreakdown info={info({ lines: [cut, CAP], estimatedCredits: null, kept: [] })} />)
    expect(plain.textContent).toContain(he["Apply EDL"]!)
    expect(plain.textContent).toContain(he["Add Captions"]!)
    expect(plain.textContent).not.toContain("Apply EDL")
  })

  it("rows and the total agree in a configured display unit (a valid, lossless one: H12)", () => {
    window.__NODARO_RUNTIME__ = { surface: { billing: { costTab: "inherit", sidebarCard: "inherit", selfServe: true, unitLabel: "pts", unitRate: 0.1, unitDecimals: 1 } } }
    const many = Array.from({ length: 4 }, (_, i) => line(`n${i}`, `Node ${i}`, 5 + i))
    render(<RunConfirmBreakdown info={info({ lines: many, estimatedCredits: many.reduce((s, l) => s + l.credits, 0) })} />)
    const rows = within(screen.getByTestId("run-confirm-rows")).getAllByRole("row")
    const shown = rows.map((r) => Number(r.lastElementChild!.textContent))
    expect(shown).toEqual([0.5, 0.6, 0.7, 0.8])
    expect(screen.getByText("≈2.6 credits")).toBeTruthy()
  })

  it("a long run scrolls its rows while the total stays outside the scroll box, so the dialog's buttons stay on screen", () => {
    const many = Array.from({ length: 30 }, (_, i) => line(`n${i}`, `Node ${i}`, 10))
    render(<RunConfirmBreakdown info={info({ lines: many, estimatedCredits: 300 })} />)
    fireEvent.click(screen.getByRole("button", { name: /more/ }))
    const box = screen.getByTestId("run-confirm-rows")
    expect(box.className).toMatch(/max-h-\[40vh\]/)
    expect(box.className).toMatch(/overflow-y-auto/)
    expect(within(box).getByText("Node 29")).toBeTruthy()
    expect(within(box).queryByText("Total")).toBeNull()
    expect(screen.getByText("Total")).toBeTruthy()
  })

  // Round 2 (decided 2026-10-06): a second render still set to Preview after this
  // one holds back what it feeds; the Render final confirm names those nodes.
  it("Render final names the nodes behind another Preview render: they wait for its own Render final, unpriced", () => {
    render(<RunConfirmBreakdown info={info({ waits: ["Clip Pack", "Caption Clips"] })} />)
    expect(screen.getByText("Waits for its own Render final: Clip Pack, Caption Clips")).toBeTruthy()
    expect(screen.queryByText(/After Render final/)).toBeNull()
    expect(screen.queryByText("Clip Pack")).toBeNull() // no row of its own
  })

  it("Update preview names both: what waits for this Render final, and what waits for another render's own", () => {
    const preview = line("cut", "Apply Cut", 48, { quantity: { fanOut: 1, units: 48, unitKind: "minute" }, renderQuality: "proxy" })
    render(
      <RunConfirmBreakdown
        info={info({ trigger: "update-preview", alwaysConfirm: false, lines: [preview], estimatedCredits: 48, kept: [], gated: ["Add Captions", "Render Clips"], waits: ["Clip Pack"] })}
      />,
    )
    expect(screen.getByText("After Render final, not billed now: Add Captions, Render Clips")).toBeTruthy()
    expect(screen.getByText("Waits for its own Render final: Clip Pack")).toBeTruthy()
  })

  it("the waits line shows in a non-credit edition too, and its names translate", () => {
    useLocaleStore.setState({ locale: "he" })
    const he = LABELS_HE.node
    const { container } = render(<RunConfirmBreakdown info={info({ estimatedCredits: null, waits: ["Add Captions", "My Pack"] })} />)
    expect(container.textContent).toContain(tx("renderFinal.waitsOwn", { names: [he["Add Captions"]!, "My Pack"].join(", ") }))
  })
})

/**
 * Round 2 (decided 2026-10-06): the Render final and Update preview titles take
 * the mockups' "action · ≈credits" shape, the same ≈ the total row uses.
 */
describe("runConfirmText — titles", () => {
  it("Render final · ≈530 credits, and Update preview · ≈12 credits", () => {
    expect(runConfirmText(info({}), tx).title).toBe("Render final · ≈530 credits")
    expect(runConfirmText(info({ trigger: "update-preview", alwaysConfirm: false, estimatedCredits: 12 }), tx).title).toBe("Update preview · ≈12 credits")
  })

  it("the title's figure and the total row's are written the same way", () => {
    const title = runConfirmText(info({}), tx).title
    expect(title.endsWith(tx("renderFinal.lineTotalCredits", { credits: 530 }))).toBe(true)
  })

  it.each(["he", "ja", "ko", "pt-BR"] as LocaleId[])("%s: the title starts with the button's own words and carries the figure", (locale) => {
    useLocaleStore.setState({ locale })
    const final = runConfirmText(info({}), tx)
    expect(final.title.startsWith(tx("renderFinal.action"))).toBe(true)
    expect(final.title).toContain("530")
    expect(final.title.endsWith(tx("renderFinal.lineTotalCredits", { credits: 530 }))).toBe(true)
    const preview = runConfirmText(info({ trigger: "update-preview", alwaysConfirm: false, estimatedCredits: 12 }), tx)
    expect(preview.title.startsWith(tx("renderFinal.updatePreview"))).toBe(true)
    expect(preview.title.endsWith(tx("renderFinal.lineTotalCredits", { credits: 12 }))).toBe(true)
  })

  it("a non-credit Render final keeps its question; other runs keep their titles", () => {
    expect(runConfirmText(info({ estimatedCredits: null }), tx).title).toBe(tx("renderFinal.confirmTitle"))
    expect(runConfirmText(info({ trigger: "selected", alwaysConfirm: false, estimatedCredits: 200, lines: undefined }), tx).title)
      .toBe(tx("editor.runConfirmCreditsTitle", { credits: 200 }))
  })
})
