// The five UGC panels: UGC Creator's options and re-draw, its category and seed;
// UGC Script's lines and their edit (written where a run hands it on); UGC
// Clips' voice; UGC Clip's per-clip Re-render; UGC Cards' Notes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { ugcScriptOutputs } from "@nodaro/shared"

const h = vi.hoisted(() => ({
  pick: vi.fn(),
  reroll: vi.fn(),
  categories: [] as Array<{ id: string; label: string }>,
  credits: false,
  voice: { props: undefined as undefined | Record<string, any> },
  /** The plan's line limits as the server hands them (placeholders); undefined: none handed. */
  limits: undefined as undefined | { hook: number; beatLine: number; closerLine: number },
}))

vi.mock("@/lib/ugc-creator-run", () => ({ pickUgcCreator: h.pick, rerollUgcCreator: h.reroll }))
vi.mock("@/hooks/use-ugc-categories", () => ({ useUgcCategories: () => h.categories }))
vi.mock("@/hooks/use-ugc-plan-line-limits", () => ({ useUgcPlanLineLimits: () => h.limits }))
vi.mock("@/hooks/use-workflow-store", () => ({ useWorkflowStore: (selector: any) => selector({ isReadOnly: false }) }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => h.credits }))
vi.mock("@/components/ui/cached-image", () => ({ CachedImage: (p: { src: string; alt: string }) => <img src={p.src} alt={p.alt} /> }))
vi.mock("../voice-browser", () => ({
  VoiceBrowser: (props: Record<string, any>) => {
    h.voice.props = props
    return <button type="button" id={props.triggerId} onClick={() => props.onSelect("voice-1", "Rachel", "premade")}>pick-a-voice</button>
  },
}))
// The Radix select as a native one: each option is an <option>, a change calls onValueChange.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <select value={value} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

import { UgcCardsConfig, UgcClipConfig, UgcClipsConfig, UgcCreatorConfig, UgcScriptConfig } from "../ugc-configs"
import { translate } from "@/lib/i18n"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)
const rec = (u: string) => ({ v: 1, kind: "sampled", gender: "woman", identityImages: [u], traits: { t: 1 } })
const PAIR = [{ imageUrl: "https://cdn.example/a.png", record: rec("https://cdn.example/a.png") }, { imageUrl: "https://cdn.example/b.png", record: rec("https://cdn.example/b.png") }]

function props(data: Record<string, unknown>) {
  const onUpdate = vi.fn()
  return { onUpdate, p: { data: { label: "n", fieldMappings: {}, ...data }, onUpdate, sources: [], fieldMappings: {}, onMapField: vi.fn(), nodes: [], nodeId: "c" } as any }
}
const selectWithOption = (label: string) => screen.getByRole("option", { name: label }).closest("select") as HTMLSelectElement
/** A Re-render button's name begins with the action and goes on to name its clip. */
const rerenderName = new RegExp(`^${translate("en", "ugc.clip.rerender").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)

beforeEach(() => {
  h.pick.mockClear()
  h.reroll.mockClear()
  h.categories = []
  h.credits = false
  h.voice.props = undefined
  h.limits = undefined
})
afterEach(() => cleanup())

describe("UGC Creator's panel", () => {
  const creator = (data: Record<string, unknown> = {}) => props({ source: "sampled", gender: "woman", keepResult: false, ...data })

  it("puts the waiting options first, then Show new options; each picks or draws again for this node", () => {
    const { p } = creator({ candidates: PAIR, executionStatus: "completed" })
    render(<UgcCreatorConfig {...p} />)
    const uses = screen.getAllByText(t("ugc.creator.useThis"))
    expect(uses).toHaveLength(2)
    const again = screen.getByRole("button", { name: t("ugc.creator.newOptions") })
    expect(uses[1]!.compareDocumentPosition(again) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(uses[0]!)
    expect(h.pick).toHaveBeenCalledWith("c", 0)
    fireEvent.click(again)
    expect(h.reroll).toHaveBeenCalledWith("c")
  })

  it("the panel's copy of the options is no second status region: the card already says it", () => {
    render(<UgcCreatorConfig {...creator({ candidates: PAIR, executionStatus: "completed" }).p} />)
    expect(screen.getByText(t("ugc.creator.pickPrompt"))).toBeTruthy()
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("after a pick in the panel, focus moves to Show new options, never to the page", () => {
    h.pick.mockReturnValueOnce(true)
    const { p } = creator({ candidates: PAIR, executionStatus: "completed" })
    const view = render(<UgcCreatorConfig {...p} />)
    fireEvent.click(screen.getAllByText(t("ugc.creator.useThis"))[0]!)
    view.rerender(<UgcCreatorConfig {...p} data={{ ...p.data, candidates: undefined, keepResult: true, result: rec("https://cdn.example/a.png") }} />)
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t("ugc.creator.newOptions") }))
  })

  it("offers Show new options for an AI creator whose options wait or that keeps a creator, and never for a photo", () => {
    const cases: Array<[Record<string, unknown>, boolean]> = [
      [{ candidates: PAIR }, true],
      [{ keepResult: true, result: rec("https://cdn.example/a.png") }, true],
      [{ keepResult: false, result: rec("https://cdn.example/a.png") }, false],
      [{ keepResult: true }, false],
      [{}, false],
      [{ source: "photo", keepResult: true, result: rec("https://cdn.example/a.png") }, false],
    ]
    for (const [data, shown] of cases) {
      render(<UgcCreatorConfig {...creator(data).p} />)
      expect(!!screen.queryByRole("button", { name: t("ugc.creator.newOptions") }), JSON.stringify(data)).toBe(shown)
      cleanup()
    }
  })

  it("hides the options while the node runs, and says when an option could not be made", () => {
    render(<UgcCreatorConfig {...creator({ candidates: PAIR, executionStatus: "running" }).p} />)
    expect(screen.queryByText(t("ugc.creator.useThis"))).toBeNull()
    cleanup()
    render(<UgcCreatorConfig {...creator({ candidates: PAIR.slice(0, 1), optionFailed: true }).p} />)
    expect(screen.getByText(t("ugc.creator.optionFailed"))).toBeTruthy()
  })

  it("while a run is starting (pending), neither an option nor Show new options can be pressed", () => {
    render(<UgcCreatorConfig {...creator({ candidates: PAIR, executionStatus: "pending" }).p} />)
    const uses = screen.getAllByText(t("ugc.creator.useThis")).map((b) => b.closest("button") as HTMLButtonElement)
    expect(uses).toHaveLength(2)
    expect(uses.every((b) => b.disabled)).toBe(true)
    expect((screen.getByRole("button", { name: t("ugc.creator.newOptions") }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("a photo creator shows the photo stored on it, with Remove and the consent line; Remove clears it", () => {
    const { p, onUpdate } = creator({ source: "photo", photoUrl: "https://cdn.example/me.png" })
    render(<UgcCreatorConfig {...p} />)
    expect(screen.getByRole("img", { name: t("creatorCard.myPhoto") }).getAttribute("src")).toBe("https://cdn.example/me.png")
    expect(screen.getByText(t("creatorCard.photoConsent"))).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: t("present.removeImage") }))
    expect(onUpdate).toHaveBeenLastCalledWith({ photoUrl: undefined })
  })

  it("no photo stored, or an AI creator, shows no photo", () => {
    render(<UgcCreatorConfig {...creator({ source: "photo" }).p} />)
    expect(screen.queryByRole("button", { name: t("present.removeImage") })).toBeNull()
    cleanup()
    render(<UgcCreatorConfig {...creator({ source: "sampled", photoUrl: "https://cdn.example/me.png" }).p} />)
    expect(screen.queryByRole("img")).toBeNull()
    expect(screen.queryByText(t("creatorCard.photoConsent"))).toBeNull()
  })

  it("the source, the gender and Keep this creator write the node's own fields", () => {
    const { p, onUpdate } = creator()
    render(<UgcCreatorConfig {...p} />)
    fireEvent.change(selectWithOption(t("creatorCard.myPhoto")), { target: { value: "photo" } })
    expect(onUpdate).toHaveBeenLastCalledWith({ source: "photo" })
    fireEvent.change(selectWithOption(t("creatorCard.man")), { target: { value: "man" } })
    expect(onUpdate).toHaveBeenLastCalledWith({ gender: "man" })
    fireEvent.click(screen.getByRole("switch", { name: t("ugc.creator.keep") }))
    expect(onUpdate).toHaveBeenLastCalledWith({ keepResult: true })
  })

  it("the product category comes from the live list; From the script leaves it unset", () => {
    h.categories = [{ id: "beauty", label: "Beauty" }, { id: "tech", label: "Tech" }]
    const { p, onUpdate } = creator({ categoryOverride: "beauty" })
    render(<UgcCreatorConfig {...p} />)
    const select = selectWithOption(t("ugc.creator.categoryFromScript"))
    expect([...select.options].map((o) => o.textContent)).toEqual([t("ugc.creator.categoryFromScript"), "Beauty", "Tech"])
    expect(select.value).toBe("beauty")
    fireEvent.change(select, { target: { value: "tech" } })
    expect(onUpdate).toHaveBeenLastCalledWith({ categoryOverride: "tech" })
    fireEvent.change(select, { target: { value: select.options[0]!.value } })
    expect(onUpdate).toHaveBeenLastCalledWith({ categoryOverride: undefined })
  })

  it("a saved category the list does not name (or no list at all) still shows, as it is stored", () => {
    render(<UgcCreatorConfig {...creator({ categoryOverride: "retired-category" }).p} />)
    const select = selectWithOption(t("ugc.creator.categoryFromScript"))
    expect([...select.options].map((o) => o.textContent)).toEqual([t("ugc.creator.categoryFromScript"), "retired-category"])
    expect(select.value).toBe("retired-category")
  })

  it("the seed is a whole number from 0, unset when cleared", () => {
    const { p, onUpdate } = creator({ seed: 7 })
    render(<UgcCreatorConfig {...p} />)
    const seed = screen.getByLabelText(t("field.seedOptional"))
    fireEvent.change(seed, { target: { value: "42.6" } })
    fireEvent.blur(seed)
    expect(onUpdate).toHaveBeenLastCalledWith({ seed: 43 })
    fireEvent.change(seed, { target: { value: "-5" } })
    fireEvent.blur(seed)
    expect(onUpdate).toHaveBeenLastCalledWith({ seed: 0 })
    fireEvent.change(seed, { target: { value: "" } })
    fireEvent.blur(seed)
    expect(onUpdate).toHaveBeenLastCalledWith({ seed: undefined })
  })

  it("a photo creator shows neither the category nor the seed", () => {
    render(<UgcCreatorConfig {...creator({ source: "photo" }).p} />)
    expect(screen.queryByRole("option", { name: t("ugc.creator.categoryFromScript") })).toBeNull()
    expect(screen.queryByLabelText(t("field.seedOptional"))).toBeNull()
  })

  it("shows the price line where credits are billed", () => {
    render(<UgcCreatorConfig {...creator().p} />)
    expect(screen.queryByText(t("ugc.creator.priceLine"))).toBeNull()
    cleanup()
    h.credits = true
    render(<UgcCreatorConfig {...creator().p} />)
    expect(screen.getByText(t("ugc.creator.priceLine"))).toBeTruthy()
  })
})

describe("UGC Script's panel", () => {
  const PLAN = { v: 1, hook: "Open", beats: [{ sectionLabel: "s1", line: "One" }, { line: "Two" }], closer: { line: "Close", action: "a" }, extra: { k: [1] } }
  const RESULT = { plan: PLAN, productCategory: "beauty", warnings: [], notes: [], rounds: 2 }
  const script = (data: Record<string, unknown> = {}) => props({ targetDurationSec: 15, keepResult: false, result: RESULT, ...data })

  it("shows the opening line, each beat's line and the closing line, and how many rounds wrote them", () => {
    render(<UgcScriptConfig {...script().p} />)
    for (const text of ["Open", "One", "Two", "Close"]) expect(screen.getByText(text)).toBeTruthy()
    expect(screen.getByText(t("ugc.script.hookLabel"))).toBeTruthy()
    expect(screen.getByText(t("ugc.script.beatLabel", { n: 2 }))).toBeTruthy()
    expect(screen.getByText(t("ugc.script.closerLabel"))).toBeTruthy()
    expect(screen.getByText(t("ugc.script.roundsMany", { n: 2 }))).toBeTruthy()
    expect(document.body.textContent).not.toContain("s1")
    expect(screen.queryByText(t("ugc.script.linesOnly"))).toBeNull()
  })

  it("a saved script that cannot be edited shows its lines read only, with no Edit, and says how to get a new one", () => {
    const broken = { ...RESULT, plan: { v: 1, hook: "Open", beats: [{ line: "One" }], closer: "Close" } }
    render(<UgcScriptConfig {...script({ keepResult: true, result: broken }).p} />)
    for (const text of ["Open", "One"]) expect(screen.getByText(text)).toBeTruthy()
    expect(screen.queryByRole("button", { name: t("common.edit") })).toBeNull()
    expect(screen.queryByRole("textbox", { name: t("ugc.script.hookLabel") })).toBeNull()
    expect(within(screen.getByTestId("ugc-script-lines")).getByText(t("ugc.script.linesOnly"))).toBeTruthy()
  })

  it("kept: the length shows what the saved script was written to, locked, with why", () => {
    const { p, onUpdate } = script({ keepResult: true, targetDurationSec: 15, result: { ...RESULT, plan: { ...PLAN, targetDurationSec: 45 } } })
    render(<UgcScriptConfig {...p} />)
    const length = screen.getByLabelText(t("ugc.script.length")) as HTMLInputElement
    expect(length.value).toBe("45")
    expect(length.disabled).toBe(true)
    expect(length.getAttribute("aria-describedby")).toBe("ugc-script-length-kept")
    expect(document.getElementById("ugc-script-length-kept")?.textContent).toBe(t("ugc.script.lengthKept"))
    fireEvent.change(length, { target: { value: "20" } })
    fireEvent.blur(length)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("kept with a saved script of no readable length: the setting, still locked", () => {
    render(<UgcScriptConfig {...script({ keepResult: true, targetDurationSec: 30 }).p} />)
    const length = screen.getByLabelText(t("ugc.script.length")) as HTMLInputElement
    expect([length.value, length.disabled]).toEqual(["30", true])
  })

  it("not kept, or kept with nothing saved: the setting, free to change", () => {
    const { p, onUpdate } = script({ result: { ...RESULT, plan: { ...PLAN, targetDurationSec: 45 } } })
    render(<UgcScriptConfig {...p} />)
    const length = screen.getByLabelText(t("ugc.script.length")) as HTMLInputElement
    expect([length.value, length.disabled]).toEqual(["15", false])
    expect(screen.queryByText(t("ugc.script.lengthKept"))).toBeNull()
    fireEvent.change(length, { target: { value: "20" } })
    fireEvent.blur(length)
    expect(onUpdate).toHaveBeenCalledWith({ targetDurationSec: 20 })
    cleanup()
    render(<UgcScriptConfig {...script({ keepResult: true, result: undefined }).p} />)
    expect((screen.getByLabelText(t("ugc.script.length")) as HTMLInputElement).disabled).toBe(false)
  })

  it("Edit writes the lines into the script it hands on, and keeps it", () => {
    const { p, onUpdate } = script()
    render(<UgcScriptConfig {...p} />)
    fireEvent.click(screen.getByRole("button", { name: t("common.edit") }))
    const boxes = screen.getAllByRole("textbox")
    expect(boxes).toHaveLength(4)
    fireEvent.change(boxes[1]!, { target: { value: "Uno" } })
    fireEvent.click(screen.getByRole("button", { name: t("common.save") }))
    const plan = { ...PLAN, beats: [{ sectionLabel: "s1", line: "Uno" }, { line: "Two" }] }
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ result: { ...RESULT, plan }, ugcOutputs: ugcScriptOutputs({ plan, productCategory: "beauty" }), keepResult: true })
    // Out of edit mode again.
    expect(screen.queryAllByRole("textbox")).toHaveLength(0)
  })

  it("a blank line is refused with the line named, and nothing is written", () => {
    const { p, onUpdate } = script()
    render(<UgcScriptConfig {...p} />)
    fireEvent.click(screen.getByRole("button", { name: t("common.edit") }))
    fireEvent.change(screen.getAllByRole("textbox")[2]!, { target: { value: "   " } })
    fireEvent.click(screen.getByRole("button", { name: t("common.save") }))
    expect(screen.getByRole("alert").textContent).toBe(t("ugc.script.beatEmpty", { n: 2 }))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getAllByRole("textbox")).toHaveLength(4)
  })

  it("a line longer than the server's limit for it is refused with the line named, and nothing is written", () => {
    h.limits = { hook: 12, beatLine: 20, closerLine: 16 }
    const { p, onUpdate } = script()
    render(<UgcScriptConfig {...p} />)
    fireEvent.click(screen.getByRole("button", { name: t("common.edit") }))
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "a".repeat(13) } })
    fireEvent.click(screen.getByRole("button", { name: t("common.save") }))
    expect(screen.getByRole("alert").textContent).toBe(t("ugc.script.hookTooLong", { max: 12 }))
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("with no limits from the server, a long line is saved: UGC Clips refuses it as before", () => {
    const { p, onUpdate } = script()
    render(<UgcScriptConfig {...p} />)
    fireEvent.click(screen.getByRole("button", { name: t("common.edit") }))
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "a".repeat(500) } })
    fireEvent.click(screen.getByRole("button", { name: t("common.save") }))
    expect(screen.queryByRole("alert")).toBeNull()
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it("a script that lands with other lines ends an edit begun on the old one", () => {
    const { p } = script()
    const { rerender } = render(<UgcScriptConfig {...p} />)
    fireEvent.click(screen.getByRole("button", { name: t("common.edit") }))
    fireEvent.change(screen.getAllByRole("textbox")[1]!, { target: { value: "Uno" } })
    rerender(<UgcScriptConfig {...p} data={{ ...p.data, result: { ...RESULT, plan: { ...PLAN, hook: "A new opening" } } }} />)
    expect(screen.queryAllByRole("textbox")).toHaveLength(0)
    expect(screen.getByText("A new opening")).toBeTruthy()
  })

  it("the same script read again (a save made elsewhere) keeps the edit and what was typed", () => {
    const { p } = script()
    const { rerender } = render(<UgcScriptConfig {...p} />)
    fireEvent.click(screen.getByRole("button", { name: t("common.edit") }))
    fireEvent.change(screen.getAllByRole("textbox")[1]!, { target: { value: "Uno" } })
    rerender(<UgcScriptConfig {...p} data={{ ...p.data, result: JSON.parse(JSON.stringify(RESULT)) }} />)
    const boxes = screen.getAllByRole("textbox") as HTMLTextAreaElement[]
    expect(boxes).toHaveLength(4)
    expect(boxes[1]!.value).toBe("Uno")
  })

  it("Edit moves focus to the first line, Save and Cancel bring it back to Edit, and a script that lands takes no focus", () => {
    const { p } = script()
    const view = render(<UgcScriptConfig {...p} />)
    fireEvent.click(screen.getByRole("button", { name: t("common.edit") }))
    expect(document.activeElement).toBe(screen.getAllByRole("textbox")[0])
    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }))
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t("common.edit") }))
    fireEvent.click(screen.getByRole("button", { name: t("common.edit") }))
    fireEvent.click(screen.getByRole("button", { name: t("common.save") }))
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t("common.edit") }))
    // An edit a newly landed script ends leaves focus where the person put it.
    fireEvent.click(screen.getByRole("button", { name: t("common.edit") }))
    const length = screen.getByLabelText(t("ugc.script.length"))
    length.focus()
    view.rerender(<UgcScriptConfig {...p} data={{ ...p.data, result: { ...RESULT, plan: { ...PLAN, hook: "A new opening" } } }} />)
    expect(document.activeElement).toBe(length)
  })

  it("Cancel leaves the script as it was", () => {
    const { p, onUpdate } = script()
    render(<UgcScriptConfig {...p} />)
    fireEvent.click(screen.getByRole("button", { name: t("common.edit") }))
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "Changed" } })
    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByText("Open")).toBeTruthy()
  })

  it("offers no edit before a run has written a script", () => {
    render(<UgcScriptConfig {...script({ result: undefined }).p} />)
    expect(screen.queryByRole("button", { name: t("common.edit") })).toBeNull()
  })

  it("the length is 4 to 300 seconds, and Keep this script writes keepResult", () => {
    const { p, onUpdate } = script()
    render(<UgcScriptConfig {...p} />)
    const length = screen.getByLabelText(t("ugc.script.length"))
    expect((length as HTMLInputElement).value).toBe("15")
    fireEvent.change(length, { target: { value: "500" } })
    fireEvent.blur(length)
    expect(onUpdate).toHaveBeenLastCalledWith({ targetDurationSec: 300 })
    fireEvent.change(length, { target: { value: "2" } })
    fireEvent.blur(length)
    expect(onUpdate).toHaveBeenLastCalledWith({ targetDurationSec: 4 })
    fireEvent.click(screen.getByRole("switch", { name: t("ugc.script.keep") }))
    expect(onUpdate).toHaveBeenLastCalledWith({ keepResult: true })
  })
})

describe("UGC Clips' panel", () => {
  it("unset is the default voice; a picked voice is stored with its name", () => {
    const { p, onUpdate } = props({})
    render(<UgcClipsConfig {...p} />)
    expect(h.voice.props?.valueLabel).toBe(t("ugc.clips.defaultVoice"))
    expect(screen.queryByRole("button", { name: t("ugc.clips.useDefaultVoice") })).toBeNull()
    fireEvent.click(screen.getByText("pick-a-voice"))
    expect(onUpdate).toHaveBeenCalledWith({ voiceId: "voice-1", voiceDisplayName: "Rachel" })
  })

  it("the voice picker is named by the field's label", () => {
    render(<UgcClipsConfig {...props({}).p} />)
    const labelId = h.voice.props?.triggerLabelledBy as string
    expect(document.getElementById(labelId)?.textContent).toBe(t("field.voice"))
  })

  it("Use the default voice clears the picked one; the empty field still reads Default voice", () => {
    expect(t("ugc.clips.useDefaultVoice")).toBe("Use the default voice")
    const { p, onUpdate } = props({ voiceId: "voice-1", voiceDisplayName: "Rachel" })
    render(<UgcClipsConfig {...p} />)
    expect(h.voice.props).toMatchObject({ value: "voice-1", valueLabel: "Rachel" })
    expect(screen.queryByRole("button", { name: t("ugc.clips.defaultVoice") })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: t("ugc.clips.useDefaultVoice") }))
    expect(onUpdate).toHaveBeenCalledWith({ voiceId: undefined, voiceDisplayName: undefined })
  })

  it("hides the last run's quote while the node runs again, as the card does", () => {
    h.credits = true
    render(<UgcClipsConfig {...props({ executionStatus: "running", quote: { lines: [{ label: "Clip 1", credits: 100 }], expected: 100, ceiling: 200 } }).p} />)
    expect(screen.queryByTestId("ugc-clips-quote")).toBeNull()
  })

  it("after Use the default voice clears the pick, focus returns to the voice picker", () => {
    const { p } = props({ voiceId: "voice-1", voiceDisplayName: "Rachel" })
    const view = render(<UgcClipsConfig {...p} />)
    fireEvent.click(screen.getByRole("button", { name: t("ugc.clips.useDefaultVoice") }))
    view.rerender(<UgcClipsConfig {...p} data={{ ...p.data, voiceId: undefined, voiceDisplayName: undefined }} />)
    expect(document.activeElement).toBe(screen.getByText("pick-a-voice"))
  })

  it("shows the last run's quote where credits are billed", () => {
    h.credits = true
    render(<UgcClipsConfig {...props({ quote: { lines: [{ label: "Clip 1", credits: 100 }], expected: 100, ceiling: 200 } }).p} />)
    expect(within(screen.getByTestId("ugc-clips-quote")).getByText(t("ugc.clips.expected"))).toBeTruthy()
    expect(within(screen.getByTestId("ugc-clips-quote")).getByText(t("ugc.clips.held"))).toBeTruthy()
  })
})

describe("UGC Clip's panel", () => {
  const META = [{ warnings: [], durationSec: 12 }, { warnings: ["a", "b"], durationSec: 7.25 }]

  it("lists the last run's clips with their length and warnings; Re-render bumps that clip alone", () => {
    const { p, onUpdate } = props({ rerender: { "1": 1 }, __listResultMeta: META, generatedVideoUrl: "https://cdn.example/1.mp4" })
    render(<UgcClipConfig {...p} />)
    expect(screen.getByText(t("ugc.clips.clipLength", { n: 1, seconds: "12" }))).toBeTruthy()
    expect(screen.getByText(t("ugc.clips.clipLength", { n: 2, seconds: "7.3" }))).toBeTruthy()
    expect(screen.getByText(t("ugc.clip.warningsMany", { n: 2 }))).toBeTruthy()
    const buttons = screen.getAllByRole("button", { name: rerenderName })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1]!)
    expect(onUpdate).toHaveBeenLastCalledWith({ rerender: { "1": 1, "2": 1 }, rerenderPending: { "2": true } })
    fireEvent.click(buttons[0]!)
    expect(onUpdate).toHaveBeenLastCalledWith({ rerender: { "1": 2 }, rerenderPending: { "1": true } })
  })

  it("a clip pressed for Re-render says it will render again on the next run, until that run starts", () => {
    const { p } = props({ rerender: { "2": 1 }, rerenderPending: { "2": true }, __listResultMeta: META, generatedVideoUrl: "https://cdn.example/1.mp4" })
    const { rerender: renderAgain } = render(<UgcClipConfig {...p} />)
    const rows = screen.getAllByRole("listitem")
    expect(within(rows[1]!).getByText(t("ugc.clip.rerenderNext"))).toBeTruthy()
    expect(within(rows[0]!).queryByText(t("ugc.clip.rerenderNext"))).toBeNull()
    // The run starts: its reset takes the mark away.
    renderAgain(<UgcClipConfig {...p} data={{ ...p.data, rerenderPending: undefined }} />)
    expect(screen.queryByText(t("ugc.clip.rerenderNext"))).toBeNull()
  })

  it("each Re-render has a name of its own: the action, then the clip it renders again", () => {
    render(<UgcClipConfig {...props({ rerender: {}, __listResultMeta: META, generatedVideoUrl: "https://cdn.example/1.mp4" }).p} />)
    expect(screen.getByRole("button", { name: `${t("ugc.clip.rerender")} ${t("ugc.clips.clipLength", { n: 1, seconds: "12" })}` })).toBeTruthy()
    expect(screen.getByRole("button", { name: `${t("ugc.clip.rerender")} ${t("ugc.clips.clipLength", { n: 2, seconds: "7.3" })}` })).toBeTruthy()
  })

  it("a single run lists clip 1; a count that is not a whole number starts again at 1", () => {
    const { p, onUpdate } = props({ rerender: { "1": "x" }, generatedVideoUrl: "https://cdn.example/1.mp4", clipWarnings: ["w"], durationSec: 9 })
    render(<UgcClipConfig {...p} />)
    expect(screen.getByText(t("ugc.clips.clipLength", { n: 1, seconds: "9" }))).toBeTruthy()
    expect(screen.getByText(t("ugc.clip.warningsOne", { n: 1 }))).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: rerenderName }))
    expect(onUpdate).toHaveBeenLastCalledWith({ rerender: { "1": 1 }, rerenderPending: { "1": true } })
  })

  it("before any run there is nothing to re-render, and the note still says how re-runs work", () => {
    render(<UgcClipConfig {...props({ rerender: {} }).p} />)
    expect(screen.queryByRole("button", { name: rerenderName })).toBeNull()
    expect(screen.getByText(t("ugc.clip.reuseNote"))).toBeTruthy()
  })
})

describe("UGC Cards' panel", () => {
  it("shows the last run's Notes below the line that says what the node does", () => {
    render(<UgcCardsConfig {...props({ result: { layerPlan: "[]", captionPlan: "{}", report: "No issues." } }).p} />)
    const note = screen.getByText(t("ugc.cards.panelNote"))
    const report = screen.getByText("No issues.")
    expect(note.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText("Notes")).toBeTruthy()
  })

  it("before a run, one line says what the node does: never an empty panel", () => {
    const { container } = render(<UgcCardsConfig {...props({}).p} />)
    expect(container.textContent).toBe(t("ugc.cards.panelNote"))
  })
})
