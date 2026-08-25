/**
 * The Studio-pattern picker: kinds on TABS with counts, search that never
 * hides a cross-tab match, a variant drill-in on characters, and the expand
 * button to the full-size browser. A variant pick reaches the composer as
 * (mention, variant) — the wire stays name+id.
 */
import { useState } from "react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { CopilotMentionPicker } from "../copilot-mention-picker"
import { CopilotMentionModal } from "../copilot-mention-modal"
import type { CopilotMention } from "@/ee/lib/copilot/types"

const MENTIONS: CopilotMention[] = [
  {
    id: "c1",
    name: "Iris",
    kind: "character",
    imageUrl: "https://cdn.test/iris.png",
    variants: [
      { bucket: "angles", bucketNoun: "angle", name: "back", imageUrl: "https://cdn.test/iris-back.png" },
      { bucket: "expressions", bucketNoun: "expression", name: "smile", imageUrl: null },
    ],
  },
  { id: "c2", name: "Eitan", kind: "character", imageUrl: null },
  { id: "o1", name: "Kettle", kind: "object", imageUrl: null },
  { id: "l1", name: "Cafe", kind: "location", imageUrl: null },
  { id: "f1", name: "cat.png", kind: "image", imageUrl: null },
]

const onPick = vi.fn()
const onExpand = vi.fn()
const noop = () => undefined

function renderPicker(query = "") {
  return render(
    <CopilotMentionPicker
      query={query}
      mentions={MENTIONS}
      onPick={onPick}
      onActiveChange={noop}
      onClose={noop}
      onExpand={onExpand}
    />,
  )
}

/** The composer wiring, minimally: expand closes the picker, the browser takes over. */
function Harness() {
  const [browserTab, setBrowserTab] = useState<string | null>(null)
  return (
    <>
      {browserTab === null && (
        <CopilotMentionPicker
          query=""
          mentions={MENTIONS}
          onPick={onPick}
          onActiveChange={noop}
          onClose={noop}
          onExpand={(tab) => setBrowserTab(tab)}
        />
      )}
      {browserTab !== null && (
        <CopilotMentionModal
          mentions={MENTIONS}
          initialTab={browserTab}
          onPick={(mention, variant) => {
            setBrowserTab(null)
            if (variant) onPick(mention, variant)
            else onPick(mention)
          }}
          onClose={() => setBrowserTab(null)}
        />
      )}
    </>
  )
}

beforeEach(() => {
  onPick.mockReset()
  onExpand.mockReset()
})

describe("tabs", () => {
  it("shows every kind as a tab with its count, characters first", () => {
    renderPicker()
    expect(screen.getByRole("tab", { name: /Characters 2/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /Objects 1/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /Files 1/ })).toBeTruthy()
    // Characters tab is active by default: its rows show, others' do not.
    expect(screen.getByRole("option", { name: /Iris/ })).toBeTruthy()
    expect(screen.queryByRole("option", { name: /Kettle/ })).toBeNull()
  })

  it("switching tab switches the list", () => {
    renderPicker()
    fireEvent.click(screen.getByRole("tab", { name: /Objects/ }))
    expect(screen.getByRole("option", { name: /Kettle/ })).toBeTruthy()
    expect(screen.queryByRole("option", { name: /Iris/ })).toBeNull()
  })

  it("a match on ANOTHER tab is never invisible — the hint names it and jumps there", () => {
    renderPicker("cat")
    // Active tab (Characters) has no match; the hint carries the Files hit.
    expect(screen.queryByRole("option", { name: /cat.png/ })).toBeNull()
    const hint = screen.getByRole("button", { name: /Files 1/ })
    fireEvent.click(hint)
    expect(screen.getByRole("option", { name: /cat.png/ })).toBeTruthy()
  })
})

describe("variant drill-in", () => {
  it("a character with looks gets a chevron; drilling lists Portrait + variants", () => {
    renderPicker()
    fireEvent.click(screen.getByLabelText("Looks of Iris"))
    expect(screen.getByRole("option", { name: "Portrait (default)" })).toBeTruthy()
    expect(screen.getByRole("option", { name: "back angle" })).toBeTruthy()
    expect(screen.getByRole("option", { name: "smile expression" })).toBeTruthy()
  })

  it("picking a variant hands the composer BOTH the mention and the variant", () => {
    renderPicker()
    fireEvent.click(screen.getByLabelText("Looks of Iris"))
    fireEvent.click(screen.getByRole("option", { name: "back angle" }))
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1", name: "Iris" }),
      expect.objectContaining({ bucket: "angles", bucketNoun: "angle", name: "back" }),
    )
  })

  it("Portrait (default) picks the plain mention — no variant", () => {
    renderPicker()
    fireEvent.click(screen.getByLabelText("Looks of Iris"))
    fireEvent.click(screen.getByRole("option", { name: "Portrait (default)" }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }))
    expect(onPick.mock.calls[0]![1]).toBeUndefined()
  })

  it("a character without looks has no chevron", () => {
    renderPicker()
    expect(screen.queryByLabelText("Looks of Eitan")).toBeNull()
  })
})

describe("the full-size browser", () => {
  it("the expand button hands the COMPOSER the active tab — the browser must not be the picker's child", () => {
    // The regression this pins: a browser rendered inside the picker died the
    // moment its own search autofocus blurred the composer input (the picker
    // unmounts on blur), so "expand" visibly did nothing.
    renderPicker()
    fireEvent.click(screen.getByRole("tab", { name: /Objects/ }))
    fireEvent.click(screen.getByLabelText("Browse everything"))
    expect(onExpand).toHaveBeenCalledWith("Objects")
    expect(screen.queryByRole("dialog", { name: /Insert a reference/ })).toBeNull()
  })

  it("composer-wired: expand opens it (portaled), a pick there closes it and reaches the composer", () => {
    render(<Harness />)
    fireEvent.click(screen.getByLabelText("Browse everything"))
    const dialog = screen.getByRole("dialog", { name: /Insert a reference/ })
    fireEvent.click(within(dialog).getByRole("tab", { name: /Locations/ }))
    fireEvent.click(within(dialog).getByRole("button", { name: /Cafe · Location/ }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "l1" }))
    expect(screen.queryByRole("dialog", { name: /Insert a reference/ })).toBeNull()
  })

  it("search in the browser filters the active tab", () => {
    render(<Harness />)
    fireEvent.click(screen.getByLabelText("Browse everything"))
    const dialog = screen.getByRole("dialog", { name: /Insert a reference/ })
    fireEvent.change(within(dialog).getByLabelText("Search by name…"), { target: { value: "iris" } })
    expect(within(dialog).getByRole("button", { name: /Iris · Character/ })).toBeTruthy()
    expect(within(dialog).queryByRole("button", { name: /Eitan · Character/ })).toBeNull()
  })
})

describe("look before you pick — the image preview", () => {
  it("clicking a row's THUMB previews it large; Insert picks from the preview", () => {
    renderPicker()
    fireEvent.click(screen.getByLabelText("Preview Iris"))
    const dialog = screen.getByRole("dialog", { name: "Preview Iris" })
    expect(within(dialog).getByRole("img", { name: "Iris" })).toBeTruthy()
    expect(onPick).not.toHaveBeenCalled() // previewing must not insert
    fireEvent.click(within(dialog).getByRole("button", { name: "Insert" }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }))
    expect(screen.queryByRole("dialog", { name: "Preview Iris" })).toBeNull()
  })

  it("a row without an image has no preview affordance", () => {
    renderPicker()
    expect(screen.queryByLabelText("Preview Eitan")).toBeNull()
  })

  it("Escape closes the preview, not the picker", () => {
    renderPicker()
    fireEvent.click(screen.getByLabelText("Preview Iris"))
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByRole("dialog", { name: "Preview Iris" })).toBeNull()
    expect(screen.getByRole("option", { name: /Iris/ })).toBeTruthy()
  })

  it("browser tiles preview from the image too, with Insert wired to the pick", () => {
    render(<Harness />)
    fireEvent.click(screen.getByLabelText("Browse everything"))
    const dialog = screen.getByRole("dialog", { name: /Insert a reference/ })
    fireEvent.click(within(dialog).getByLabelText("Preview Iris"))
    const preview = screen.getByRole("dialog", { name: "Preview Iris" })
    fireEvent.click(within(preview).getByRole("button", { name: "Insert" }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }))
  })
})
