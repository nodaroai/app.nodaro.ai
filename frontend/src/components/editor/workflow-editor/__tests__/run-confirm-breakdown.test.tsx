import { useEffect } from "react"
import { describe, it, expect, afterEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { useLocaleStore } from "@/lib/locale-store"
import { LABELS_HE } from "@/lib/i18n/labels.he"
import { RunConfirmBreakdown } from "../run-confirm-breakdown"
import { runConfirmText, useRunConfirm } from "../run-confirm-dialog"
import { tx } from "@/lib/i18n"
import type { LocaleId } from "@nodaro/shared/i18n"
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

/** "Run up to here" (decided 2026-10-08): its own title, the price in it, and its own action. */
describe("runConfirmText — Run up to here", () => {
  const upTo = (extra: Partial<RunConfirmInfo> = {}) =>
    info({ trigger: "up-to-here", alwaysConfirm: true, estimatedCredits: 240, nodeCount: 3, lines: undefined, ...extra })

  it("titles with the figure, not with the whole-workflow question", () => {
    expect(runConfirmText(upTo(), tx).title).toBe("Run up to here · ≈240 credits")
  })

  it("a non-credit edition keeps the question, with no figure", () => {
    expect(runConfirmText(upTo({ estimatedCredits: null }), tx).title).toBe("Run up to here?")
  })

  it("the action is the button's own words, and the body counts the nodes", () => {
    const text = runConfirmText(upTo(), tx)
    expect(text.action).toBe("Run up to here")
    expect(text.body).toBe(tx("editor.runConfirmNodes", { n: 3 }))
  })

  it.each(["he", "ja", "ko", "pt-BR"] as LocaleId[])("%s: the title starts with the action and carries the figure", (locale) => {
    useLocaleStore.setState({ locale })
    const text = runConfirmText(upTo(), tx)
    expect(text.title.startsWith(text.action)).toBe(true)
    expect(text.title).toContain("240")
  })
})

describe("RunConfirmBreakdown — a macro group's sum (D5, decided 2026-10-11)", () => {
  const inGroup = (l: RunConfirmLine): RunConfirmLine => ({ ...l, group: { id: "g", label: "Reframe" } })

  it("lists the group's nodes under one header carrying their sum, and the total is unchanged", () => {
    const lines = [line("t", "Transcribe", 10), inGroup(line("f", "Speaker Frames", 7)), inGroup(line("v", "Speaker View", 11)), line("img", "Generate Image", 20)]
    render(<RunConfirmBreakdown info={info({ lines, estimatedCredits: 48, kept: [] })} />)
    const header = screen.getByTestId("run-confirm-group")
    expect(within(header).getByText("Reframe")).toBeTruthy()
    expect(within(header).getByText("18")).toBeTruthy()
    // Each node keeps its own row beneath it, and the total still counts every line once.
    expect(screen.getByText("Speaker Frames")).toBeTruthy()
    expect(screen.getByText("Speaker View")).toBeTruthy()
    expect(screen.getByText("≈48 credits")).toBeTruthy()
  })

  it("shows no group header when no line belongs to a group", () => {
    render(<RunConfirmBreakdown info={info({})} />)
    expect(screen.queryByTestId("run-confirm-group")).toBeNull()
  })
})

describe("RunConfirmBreakdown — the group's sum in a run that has no itemised table (R8, decided 2026-10-12)", () => {
  const runInfo = (extra: Partial<RunConfirmInfo> = {}): RunConfirmInfo => ({
    trigger: "all",
    nodeCount: 4,
    estimatedCredits: 220,
    alwaysConfirm: true,
    groups: [{ id: "g", label: "Reframe", credits: 210 }],
    ...extra,
  })

  it("shows the group's sum row and the run total, and no per-node table", () => {
    render(<RunConfirmBreakdown info={runInfo()} />)
    const header = screen.getByTestId("run-confirm-group")
    expect(within(header).getByText("Reframe")).toBeTruthy()
    expect(within(header).getByText("210")).toBeTruthy()
    expect(screen.getByText("≈220 credits")).toBeTruthy()
    expect(screen.queryByText("Speaker View")).toBeNull()
  })

  it.each(["all", "selected", "from-here", "up-to-here", "single"] as const)("%s shows it", (trigger) => {
    render(<RunConfirmBreakdown info={runInfo({ trigger })} />)
    expect(screen.getByTestId("run-confirm-group")).toBeTruthy()
  })

  it("renders nothing for a run with neither lines nor groups, and no numbers without credits", () => {
    const { container } = render(<RunConfirmBreakdown info={runInfo({ groups: undefined })} />)
    expect(container.textContent).toBe("")
    const none = render(<RunConfirmBreakdown info={runInfo({ estimatedCredits: null })} />)
    expect(none.container.textContent).not.toMatch(/\d/)
  })

  it("translates the group's name the way the canvas header does", () => {
    useLocaleStore.setState({ locale: "he" })
    render(<RunConfirmBreakdown info={runInfo()} />)
    expect(within(screen.getByTestId("run-confirm-group")).getByText(LABELS_HE.node["Reframe"])).toBeTruthy()
  })
})

/** A run holding UGC nodes: what the confirmation says under its figure. */
describe("the run confirmation's price notes", () => {
  function Asking({ ask }: { readonly ask: RunConfirmInfo }) {
    const { confirmRun, dialog } = useRunConfirm()
    useEffect(() => {
      void confirmRun(ask)
    }, [confirmRun, ask])
    return <>{dialog}</>
  }
  const run = (extra: Partial<RunConfirmInfo> = {}): RunConfirmInfo =>
    ({ trigger: "all", nodeCount: 8, estimatedCredits: 140, alwaysConfirm: true, ...extra })

  it("are said under the figure, one sentence each", async () => {
    render(<Asking ask={run({ priceNotes: [tx("ugc.price.holdNote"), tx("ugc.price.reuseNote")] })} />)
    await screen.findByRole("alertdialog")
    expect(screen.getAllByTestId("run-confirm-price-note").map((n) => n.textContent)).toEqual([
      "While the clips render, about twice their price is held. The part not used comes back when they finish.",
      "Clips that have not changed are reused at no cost, so the run may cost less.",
    ])
    expect(screen.getByRole("alertdialog").textContent).toContain(tx("editor.runConfirmEstimated", { nodes: tx("editor.runConfirmNodes", { n: 8 }), credits: 140 }))
  })

  it("a price that could not be checked: a title with no price, the figure in the body, and the note that says why", async () => {
    const single = run({ trigger: "single", nodeCount: 1, estimatedCredits: 0, alwaysConfirm: false, priceUnchecked: true, priceNotes: [tx("ugc.price.unchecked")] })
    const text = runConfirmText(single, tx)
    expect(text.title).toBe("Run without a checked price?")
    expect(text.body).toBe(tx("editor.runConfirmEstimated", { nodes: tx("editor.runConfirmNodeOne", { n: 1 }), credits: 0 }))
    expect(text.action).toBe("Run")
    render(<Asking ask={single} />)
    expect((await screen.findByTestId("run-confirm-price-note")).textContent).toBe(tx("ugc.price.unchecked"))
  })

  it("an unchecked Run up to here and an unchecked toolbar Run keep their own titles, which state no price", () => {
    expect(runConfirmText(run({ trigger: "up-to-here", alwaysConfirm: false, priceUnchecked: true }), tx).title).toBe("Run up to here?")
    expect(runConfirmText(run({ priceUnchecked: true }), tx).title).toBe(tx("editor.runConfirmEntireTitle"))
    expect(runConfirmText(run({ trigger: "render-final", alwaysConfirm: true, priceUnchecked: true }), tx).title).toBe("Render the final?")
  })

  it("is absent otherwise", async () => {
    render(<Asking ask={run()} />)
    await screen.findByRole("alertdialog")
    expect(screen.queryByTestId("run-confirm-price-note")).toBeNull()
  })
})

/** A continuation (Continue from failed, Finish review): always asked, in its own words, never claiming a listed step is free. */
describe("runConfirmText — a continuation", () => {
  const cont = (extra: Partial<RunConfirmInfo> = {}) =>
    info({ trigger: "continue-failed", alwaysConfirm: true, estimatedCredits: 12, nodeCount: 2, kept: ["Generate Image"], ...extra })

  it("titles with the button's words and the figure; the body says every listed step runs and is charged", () => {
    const text = runConfirmText(cont(), tx)
    expect(text.title).toBe("Continue from failed · ≈12 credits")
    expect(text.action).toBe("Continue from failed")
    expect(text.body).toBe(tx("continueFailed.confirmBody"))
    expect(text.body).not.toMatch(/not charged/i)
  })

  it("Finish review has its own words; a non-credit edition keeps the question", () => {
    const finish = runConfirmText(cont({ trigger: "finish-review" }), tx)
    expect(finish.title).toBe("Finish review · ≈12 credits")
    expect(finish.action).toBe("Finish review")
    expect(runConfirmText(cont({ estimatedCredits: null }), tx).title).toBe("Continue from failed?")
  })

  it.each(["he", "ja", "ko", "pt-BR"] as LocaleId[])("%s: the title starts with the action and carries the figure", (locale) => {
    useLocaleStore.setState({ locale })
    for (const trigger of ["continue-failed", "finish-review"] as const) {
      const text = runConfirmText(cont({ trigger }), tx)
      expect(text.title.startsWith(text.action)).toBe(true)
      expect(text.title).toContain("12")
    }
  })
})
