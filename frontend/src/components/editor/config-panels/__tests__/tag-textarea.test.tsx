import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TagTextarea, type RefImageItem } from "../tag-textarea"

/**
 * Task 5.3 — the `@` autocomplete in `TagTextarea` must insert the right
 * reference token per modality, mirroring the existing `{image:N}` insertion:
 *   - source "video" → `{video:N(:label)?}`
 *   - source "audio" → `{audio:N(:label)?}`
 *   - source image/uploaded/wired → unchanged `{image:N:label}`
 *
 * The grammar is byte-parallel to the TipTap `videoRef`/`audioRef` round-trip
 * (`serializeRefToken`): labelled → `{kind:N:label}`, label-less → `{kind:N}`
 * (a trailing-colon empty label `{kind:N:}` is NOT a valid token).
 *
 * Each case renders the component, types `@` to open the ref autocomplete, then
 * clicks the row (found by its stable `#N <label>` text). `insertTag` appends a
 * trailing space, so the inserted value is `<token> `.
 */
function insertRef(ref: RefImageItem): ReturnType<typeof vi.fn> {
  const onChange = vi.fn()
  render(<TagTextarea value="" onChange={onChange} referenceImages={[ref]} />)
  const textarea = screen.getByRole("textbox")
  // Type `@` with the cursor immediately after it → opens the ref autocomplete.
  fireEvent.change(textarea, { target: { value: "@", selectionStart: 1 } })
  // Click the autocomplete row (its `#N <label>` text is independent of the
  // inserted token, so the click target is stable across the RED→GREEN change).
  fireEvent.mouseDown(screen.getByText(`#${ref.index} ${ref.label}`))
  return onChange
}

describe("TagTextarea ref-token insertion (Task 5.3)", () => {
  it("inserts {video:N} for a label-less video ref", () => {
    const onChange = insertRef({
      url: "https://example.test/clip.mp4",
      label: "Clip",
      source: "video",
      index: 1,
      defaultLabel: "",
    })
    expect(onChange).toHaveBeenLastCalledWith("{video:1} ")
  })

  it("inserts {audio:N} for a label-less audio ref", () => {
    const onChange = insertRef({
      url: "https://example.test/music.mp3",
      label: "Music",
      source: "audio",
      index: 1,
      defaultLabel: "",
    })
    expect(onChange).toHaveBeenLastCalledWith("{audio:1} ")
  })

  it("inserts {video:N:label} when a video ref carries a non-empty label", () => {
    const onChange = insertRef({
      url: "https://example.test/clip.mp4",
      label: "Clip",
      source: "video",
      index: 3,
      defaultLabel: "intro",
    })
    expect(onChange).toHaveBeenLastCalledWith("{video:3:intro} ")
  })

  it("still inserts {image:N:label} for an uploaded image ref (regression guard)", () => {
    const onChange = insertRef({
      url: "https://example.test/photo.png",
      label: "Photo",
      source: "uploaded",
      index: 2,
      defaultLabel: "object",
    })
    expect(onChange).toHaveBeenLastCalledWith("{image:2:object} ")
  })

  it("still inserts {image:N:label} for a wired image ref (regression guard)", () => {
    const onChange = insertRef({
      url: "https://example.test/wired.png",
      label: "Person",
      source: "wired",
      index: 1,
      defaultLabel: "person",
    })
    expect(onChange).toHaveBeenLastCalledWith("{image:1:person} ")
  })
})

/**
 * The prompt box is two layers: the transparent textarea (caret, selection)
 * over the highlighted backdrop (the visible text). Both get ONE explicit
 * direction computed from the text, so the caret and the text it edits never
 * sit on different edges; an empty box leaves both to the UI direction.
 */
describe("TagTextarea text direction (both layers)", () => {
  function layers(value: string) {
    const { container } = render(<TagTextarea value={value} onChange={() => {}} placeholder="Type a prompt" />)
    const textarea = container.querySelector("textarea")!
    const backdrop = container.querySelector(".tag-textarea-backdrop")!
    return { textarea: textarea.getAttribute("dir"), backdrop: backdrop.getAttribute("dir") }
  }

  it.each([
    ["Hebrew", "צלם את המוצר על שולחן עץ.", "rtl"],
    ["English", "Shoot the product on a wooden table.", "ltr"],
    ["mixed, Hebrew first", "צלם את Kettlefin Bottle על שולחן.", "rtl"],
    ["mixed, English first", "Kettlefin Bottle על שולחן עץ.", "ltr"],
    ["Hebrew after digits and punctuation", "3. «צלם» את המוצר", "rtl"],
    ["Hebrew opening with an image reference", "{image:1} צלם את המוצר על שולחן.", "rtl"],
    ["Hebrew opening with a node reference", "{Person} מחזיק את המוצר ביד.", "rtl"],
    ["Hebrew opening with a labelled reference", "{image:2:object} ו-{video:1} צלם את זה.", "rtl"],
    ["English opening with a reference", "{תמונה} hold the bottle up.", "ltr"],
  ])("%s → %s on both layers", (_name, value, dir) => {
    expect(layers(value)).toEqual({ textarea: dir, backdrop: dir })
  })

  it("an empty box carries no dir on either layer, so its placeholder keeps the UI direction", () => {
    expect(layers("")).toEqual({ textarea: null, backdrop: null })
  })

  it("a box holding only references keeps the UI direction", () => {
    expect(layers("{image:1} {Person}")).toEqual({ textarea: null, backdrop: null })
  })

  it("audio tags drawn as pills are skipped too", () => {
    const { container } = render(<TagTextarea value="[whispers] שלום לכולם" onChange={() => {}} tagMode="audio" />)
    expect(container.querySelector("textarea")!.getAttribute("dir")).toBe("rtl")
    expect(container.querySelector(".tag-textarea-backdrop")!.getAttribute("dir")).toBe("rtl")
  })

  it("a box holding no letter (only digits/symbols) also keeps the UI direction", () => {
    expect(layers("123 — 456")).toEqual({ textarea: null, backdrop: null })
  })

  it("re-derives the direction when the text changes", () => {
    const { container, rerender } = render(<TagTextarea value="Hello" onChange={() => {}} />)
    rerender(<TagTextarea value="שלום" onChange={() => {}} />)
    expect(container.querySelector("textarea")!.getAttribute("dir")).toBe("rtl")
    expect(container.querySelector(".tag-textarea-backdrop")!.getAttribute("dir")).toBe("rtl")
  })
})
