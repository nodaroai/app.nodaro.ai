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
    // A REAL CDN host: the transform only rewrites hosts that serve it, so a
    // made-up one would let the raw-original bug pass this file.
    imageUrl: "https://cdn.nodaro.ai/iris.png",
    variants: [
      { bucket: "angles", bucketNoun: "angle", name: "back", imageUrl: "https://cdn.nodaro.ai/iris-back.png" },
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

describe("a thumbnail you can actually see", () => {
  // The picker looked empty for the owner: every row drew its image with a CSS
  // `background-image` pointing at the RAW asset URL, so a fourteen-row list
  // started fourteen multi-megabyte downloads and painted nothing meanwhile.
  // Every other surface in the app goes through `CachedImage`, which asks the
  // CDN for a small transformed variant and falls back to the image proxy.
  it("asks the CDN for a small transform, not the original", () => {
    const { container } = renderPicker()
    const img = container.querySelector('img[src*="iris.png"]') as HTMLImageElement | null
    expect(img, "the row must render an <img>, not a CSS background").toBeTruthy()
    expect(img!.getAttribute("src")).toContain("/cdn-cgi/image/")
    expect(img!.getAttribute("src")).toMatch(/width=\d+/)
  })

  it("leaves no CSS background-image behind", () => {
    const { container } = renderPicker()
    const withBackground = [...container.querySelectorAll<HTMLElement>("[style]")].filter((el) =>
      (el.getAttribute("style") ?? "").includes("background-image"),
    )
    expect(withBackground).toHaveLength(0)
  })

  it("is decorative — the row is not named twice", () => {
    // The name is already text beside it; an announced thumb would repeat it.
    const { container } = renderPicker()
    const img = container.querySelector('img[src*="iris.png"]') as HTMLImageElement
    expect(img.getAttribute("alt")).toBe("")
    expect(screen.getByRole("option", { name: /^Iris/ })).toBeTruthy()
  })
})

describe("the magnifier says the picture can be enlarged", () => {
  // The owner could only enlarge AFTER picking, because after picking there is
  // a chip he knows to click. "The thumbnail is a button" is not something a
  // person can see — so the row carries a magnifier.
  it("puts a zoom badge on a row that has an image", () => {
    renderPicker()
    const row = screen.getByRole("option", { name: /^Iris/ })
    const zoom = within(row).getByRole("button", { name: /Preview/i })
    expect(zoom.querySelector("svg")).toBeTruthy()
    expect(zoom.className).toContain("cursor-zoom-in")
  })

  it("shows the badge on the arrow-key row, with no pointer anywhere", () => {
    // Focus NEVER reaches a row — every one preventDefaults its mousedown so
    // the composer keeps it, and the list is driven by `aria-activedescendant`.
    // A `:focus-within` rule would read correctly in the source and never once
    // fire, so the arrow cursor is what has to drive it.
    renderPicker()
    // The element that DRAWS the magnifier — the frame around the image is
    // `aria-hidden` too, and it is first in the DOM.
    const badgeOf = (name: RegExp) => {
      const zoom = within(screen.getByRole("option", { name })).getByRole("button", { name: /Preview/i })
      return [...zoom.querySelectorAll("span")].find((s) => s.querySelector("svg"))!
    }
    // By class TOKEN, not substring: the element also carries
    // `group-hover:opacity-100`, so a substring check passes even when the
    // cursor drives nothing at all. (It did, and this mutation survived.)
    const classes = (name: RegExp) => [...badgeOf(name).classList]
    // Iris is row 0 — the cursor starts there.
    expect(classes(/^Iris/)).toContain("opacity-100")
    expect(classes(/^Iris/)).not.toContain("opacity-0")
    fireEvent.keyDown(window, { key: "ArrowDown" })
    expect(classes(/^Iris/)).toContain("opacity-0")
    expect(classes(/^Iris/)).not.toContain("opacity-100")
  })

  it("reveals on hover of the whole row — both halves of it", () => {
    // jsdom has no `:hover` and compiles no Tailwind, so the mechanism itself
    // is what gets pinned: the badge asks for `group-hover`, and the ROW is
    // the group. Drop either and hovering does nothing, which is the state the
    // owner reported — a picture that never says it can be enlarged.
    renderPicker()
    const row = screen.getByRole("option", { name: /^Iris/ })
    expect([...row.classList]).toContain("group")
    const badge = [...within(row).getByRole("button", { name: /Preview/i }).querySelectorAll("span")].find(
      (s) => s.querySelector("svg"),
    )!
    expect([...badge.classList]).toContain("group-hover:opacity-100")
  })

  it("puts none on a row that has no image — nothing to promise", () => {
    renderPicker()
    const row = screen.getByRole("option", { name: /^Eitan/ })
    expect(within(row).queryByRole("button", { name: /Preview/i })).toBeNull()
  })

  it("previews on click and leaves the picker open underneath", () => {
    renderPicker()
    const row = screen.getByRole("option", { name: /^Iris/ })
    fireEvent.click(within(row).getByRole("button", { name: /Preview/i }))
    // The preview is up…
    expect(screen.getByRole("dialog")).toBeTruthy()
    // …the row was NOT inserted…
    expect(onPick).not.toHaveBeenCalled()
    // …and the list is still there to go back to.
    expect(screen.getByRole("option", { name: /^Iris/ })).toBeTruthy()
  })

  it("the browser's tiles carry the same badge, from the same component", () => {
    render(
      <CopilotMentionModal mentions={MENTIONS} initialTab="Characters" onPick={onPick} onClose={noop} />,
    )
    const tile = screen.getByRole("button", { name: /^Iris ·/ })
    const zoom = within(tile).getByRole("button", { name: /Preview/i })
    // The BADGE, not merely a clickable thumb: a tile with its own hand-rolled
    // wrapper would still be clickable and would still be labelled, and the
    // user would still have no way to see that it can be.
    expect(zoom.querySelector("svg"), "the tile must render the shared magnifier badge").toBeTruthy()
  })
})

describe("the preview must not close the picker under it", () => {
  // The inline picker lives and dies by the composer input's blur, and the
  // preview is a PORTAL: a click on its backdrop, its Close or its Insert
  // lands outside the composer, blurs it, and the picker unmounts — taking
  // the preview with it. So "enlarge, close, keep choosing" worked with
  // Escape and died with the mouse. Verified against the real composer before
  // it was fixed: one blur removed both layers.
  //
  // jsdom moves no focus on click, so what is asserted is the mechanism: the
  // overlay cancels mousedown's default action, which is what a focus change
  // IS. Same trick every row in the picker already uses.
  const openPreview = () => {
    renderPicker()
    const row = screen.getByRole("option", { name: /^Iris/ })
    fireEvent.click(within(row).getByRole("button", { name: /Preview/i }))
    return screen.getByRole("dialog")
  }

  it("cancels mousedown on the backdrop", () => {
    const dialog = openPreview()
    const backdrop = dialog.querySelector("[aria-hidden]")!
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    backdrop.dispatchEvent(event)
    expect(event.defaultPrevented, "a click on the backdrop would blur the composer").toBe(true)
  })

  it("cancels mousedown on Close and on Insert", () => {
    const dialog = openPreview()
    for (const name of [/Close/i, /Insert/i]) {
      const button = within(dialog).getByRole("button", { name })
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
      button.dispatchEvent(event)
      expect(event.defaultPrevented, `${name} would blur the composer`).toBe(true)
    }
  })

  it("still closes on click — cancelling mousedown must not cancel the click", () => {
    const dialog = openPreview()
    fireEvent.click(within(dialog).getByRole("button", { name: /Close/i }))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getByRole("option", { name: /^Iris/ })).toBeTruthy()
  })

  it("loads the preview through the app's image pipeline, not the original", () => {
    const dialog = openPreview()
    const img = dialog.querySelector("img")!
    expect(img.getAttribute("src")).toContain("/cdn-cgi/image/")
  })
})
