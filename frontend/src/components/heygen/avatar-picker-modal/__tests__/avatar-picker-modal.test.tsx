/**
 * The Avatar Picker modal ("Choose an avatar"): people cards from the flat
 * look catalog, search + facets + libraries, the detail column with the
 * person's looks as chips, and "Use this avatar" handing the LOOK back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import type { HeygenAvatar, HeygenVoice } from "@/lib/api"

let avatarsFixture: HeygenAvatar[] = []
let voicesFixture: HeygenVoice[] = []
let loading = false
vi.mock("@/components/heygen/heygen-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/heygen/heygen-catalog")>()
  return {
    ...actual,
    useHeygenAvatars: () => ({ data: avatarsFixture, isLoading: loading, isError: false, complete: true }),
    useHeygenVoices: () => ({ data: voicesFixture, isLoading: false, isError: false, complete: true }),
  }
})
vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: ({ src, alt }: { src?: string; alt?: string }) => <img src={src} alt={alt ?? ""} />,
}))
vi.mock("@/components/heygen/use-voice-preview", () => ({
  useVoicePreview: (url: string | undefined) => ({ isPlaying: false, canPlay: !!url, toggle: vi.fn() }),
}))

import { AvatarPickerModal } from "../avatar-picker-modal"
import { PAGE_SIZE } from "../person-grid"
import { searchShortcutLabel } from "../picker-header"

function look(name: string, id: string, extra: Partial<HeygenAvatar> = {}): HeygenAvatar {
  return { avatarId: id, name, gender: "female", previewImageUrl: `https://cdn/${id}.jpg`, defaultVoiceId: "v1", supportedEngines: ["avatar_iv"], ...extra }
}
const CATALOG: HeygenAvatar[] = [
  look("Cora Office 4", "c4", { supportedEngines: ["avatar_v", "avatar_iv"], preferredOrientation: "landscape" }),
  look("Cora Livingroom 1", "c1"),
  look("Marieke Desk 1", "m1"),
  look("Brian Office 2", "b2", { gender: "male" }),
  look("Mine Studio 1", "own1", { ownership: "private" }),
]
const VOICES: HeygenVoice[] = [
  { voiceId: "v1", name: "Chill Brian", language: "English", gender: "male", previewAudio: "https://cdn/v1.mp3", supportPause: false, emotionSupport: false, supportLocale: true },
]

const modal = () => screen.getByTestId("avatar-picker-modal")
const grid = () => within(screen.getByTestId("avatar-picker-grid"))
const detail = () => within(screen.getByTestId("avatar-picker-detail"))
const rail = () => within(screen.getByTestId("avatar-picker-rail"))
/** Person cards are named "Name, Meta, N looks[, status]" — match on the name. */
const card = (name: string) => grid().getByRole("radio", { name: new RegExp(`^${name},`) })
const cardNames = () => grid().getAllByRole("radio").map((r) => (r.getAttribute("aria-label") ?? "").split(",")[0])

beforeEach(() => {
  avatarsFixture = CATALOG
  voicesFixture = VOICES
  loading = false
  window.localStorage.clear()
})

describe("AvatarPickerModal", () => {
  it("shows one card per person (name, meta and count in the accessible name), opens on the current avatar, and lists the person's looks as chips", () => {
    render(<AvatarPickerModal open onOpenChange={() => {}} value="c1" onSelect={() => {}} />)
    expect(screen.getByRole("heading", { name: "Choose an avatar" })).toBeInTheDocument()
    expect(screen.getByTestId("avatar-picker-count")).toHaveTextContent("4 people · 5 looks in view")
    expect(cardNames()).toEqual(["Cora", "Marieke", "Brian", "Mine"])
    expect(card("Cora")).toHaveAccessibleName("Cora, Female · Office, 2 looks")
    // the current avatar's person is selected and its look is the one shown
    expect(card("Cora")).toHaveAttribute("aria-checked", "true")
    expect(detail().getByTestId("avatar-picker-detail-name")).toHaveTextContent("Cora — Livingroom 1")
    expect(detail().getByRole("radio", { name: "Livingroom 1" })).toHaveAttribute("aria-checked", "true")
    // details rows
    expect(detail().getByTestId("avatar-picker-spec-default-voice")).toHaveTextContent("Chill Brian")
    expect(detail().queryByTestId("avatar-picker-spec-cost")).toBeNull()
  })

  it("a LOOKS chip switches the look straight away — before any card was clicked (initial selection from the node's avatar)", () => {
    render(<AvatarPickerModal open onOpenChange={() => {}} value="c1" onSelect={() => {}} />)
    expect(detail().getByTestId("avatar-picker-detail-name")).toHaveTextContent("Cora — Livingroom 1")
    fireEvent.click(detail().getByRole("radio", { name: "Office 4" }))
    expect(detail().getByTestId("avatar-picker-detail-name")).toHaveTextContent("Cora — Office 4")
    expect(detail().getByRole("radio", { name: "Office 4" })).toHaveAttribute("aria-checked", "true")
  })

  it("…and with no current avatar at all (the first person in view is on show)", () => {
    render(<AvatarPickerModal open onOpenChange={() => {}} onSelect={() => {}} />)
    expect(detail().getByTestId("avatar-picker-detail-name")).toHaveTextContent("Cora — Office 4")
    fireEvent.click(detail().getByRole("radio", { name: "Livingroom 1" }))
    expect(detail().getByTestId("avatar-picker-detail-name")).toHaveTextContent("Cora — Livingroom 1")
  })

  it("search, gender, scene, Avatar V and the libraries narrow the people in view; the detail follows the view", () => {
    render(<AvatarPickerModal open onOpenChange={() => {}} onSelect={() => {}} />)
    const search = screen.getByLabelText("Search avatars") as HTMLInputElement
    fireEvent.change(search, { target: { value: "office" } })
    expect(cardNames()).toEqual(["Cora", "Brian"])
    expect(screen.getByTestId("avatar-picker-count")).toHaveTextContent("2 people · 2 looks in view")
    // the detail column shows only the surviving looks of the person on show
    expect(detail().getAllByRole("radio").map((r) => r.getAttribute("aria-label"))).toEqual(["Office 4"])
    fireEvent.change(search, { target: { value: "" } })

    fireEvent.click(within(rail().getByRole("radiogroup", { name: "Gender" })).getByRole("radio", { name: "Male" }))
    expect(cardNames()).toEqual(["Brian"])
    // Cora (picked implicitly) is out of view now → the column follows the view
    expect(detail().getByTestId("avatar-picker-detail-name")).toHaveTextContent("Brian — Office 2")
    fireEvent.click(within(rail().getByRole("radiogroup", { name: "Gender" })).getByRole("radio", { name: "All" }))

    fireEvent.click(within(rail().getByRole("radiogroup", { name: "Scene" })).getByRole("radio", { name: "Studio" }))
    expect(cardNames()).toEqual(["Mine"])
    fireEvent.click(within(rail().getByRole("radiogroup", { name: "Scene" })).getByRole("radio", { name: "All" }))

    fireEvent.click(rail().getByRole("switch", { name: "Supports Avatar V" }))
    expect(cardNames()).toEqual(["Cora"])
    fireEvent.click(rail().getByRole("switch", { name: "Supports Avatar V" }))

    fireEvent.click(within(rail().getByRole("radiogroup", { name: "Library" })).getByRole("radio", { name: /Your own looks, 1 looks/ }))
    expect(cardNames()).toEqual(["Mine"])
  })

  it("no match → says so; clearing restores everyone and the first page", () => {
    render(<AvatarPickerModal open onOpenChange={() => {}} onSelect={() => {}} initialQuery="zzz" />)
    expect(screen.getByTestId("avatar-picker-no-match")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }))
    expect(grid().getAllByRole("radio")).toHaveLength(4)
  })

  it("pages people 24 at a time; a filter change starts from the first page again", () => {
    avatarsFixture = Array.from({ length: PAGE_SIZE + 7 }, (_, i) => look(`Person${i} Office 1`, `p${i}`, { groupId: `g${i}` }))
    render(<AvatarPickerModal open onOpenChange={() => {}} onSelect={() => {}} />)
    expect(grid().getAllByRole("radio")).toHaveLength(PAGE_SIZE)
    const more = screen.getByRole("button", { name: `Load 7 more` })
    fireEvent.click(more)
    expect(grid().getAllByRole("radio")).toHaveLength(PAGE_SIZE + 7)
    expect(screen.queryByRole("button", { name: /Load \d+ more/ })).toBeNull()
    fireEvent.change(screen.getByLabelText("Search avatars"), { target: { value: "person" } })
    expect(grid().getAllByRole("radio")).toHaveLength(PAGE_SIZE) // back to page one
  })

  it("picking a person then a look, then Use this avatar, hands the LOOK back, closes, and remembers it as recently used", () => {
    const onSelect = vi.fn()
    const onOpenChange = vi.fn()
    render(<AvatarPickerModal open onOpenChange={onOpenChange} onSelect={onSelect} />)
    fireEvent.click(card("Cora"))
    fireEvent.click(detail().getByRole("radio", { name: "Livingroom 1" }))
    expect(detail().getByTestId("avatar-picker-detail-name")).toHaveTextContent("Cora — Livingroom 1")
    fireEvent.click(detail().getByRole("button", { name: "Use this avatar" }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ avatarId: "c1", name: "Cora Livingroom 1" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(JSON.parse(window.localStorage.getItem("nodaro:heygen-recent-avatars") ?? "[]")).toEqual(["c1"])
  })

  it("the Recently used library appears once something was picked, most recent first", () => {
    window.localStorage.setItem("nodaro:heygen-recent-avatars", JSON.stringify(["b2", "c4"]))
    render(<AvatarPickerModal open onOpenChange={() => {}} onSelect={() => {}} />)
    fireEvent.click(within(rail().getByRole("radiogroup", { name: "Library" })).getByRole("radio", { name: /Recently used/ }))
    expect(cardNames()).toEqual(["Brian", "Cora"])
  })

  it("list view renders rows with the look count; the modal shows the loading and keyless states", () => {
    const { unmount } = render(<AvatarPickerModal open onOpenChange={() => {}} onSelect={() => {}} />)
    fireEvent.click(screen.getByRole("radio", { name: "List" }))
    const group = grid().getByRole("radiogroup", { name: "People" })
    expect(group).toHaveAttribute("data-view", "list")
    expect(within(group).getAllByRole("radio")).toHaveLength(4)
    expect(card("Cora")).toHaveTextContent("2 looks")
    unmount()
    avatarsFixture = []
    render(<AvatarPickerModal open onOpenChange={() => {}} onSelect={() => {}} />)
    expect(screen.getByTestId("avatar-picker-empty")).toBeInTheDocument()
    expect(modal()).toBeInTheDocument()
  })

  it("shows the run cost row only when the caller passes one; a look HeyGen is still building cannot be used; no voice sample disables Preview voice", () => {
    avatarsFixture = [
      look("Cora Office 4", "c4", { defaultVoiceId: undefined }),
      look("Mine Studio 1", "own1", { ownership: "private", status: "processing", groupId: "g-mine" }),
    ]
    render(<AvatarPickerModal open onOpenChange={() => {}} onSelect={() => {}} costLabel="from 150 CR" />)
    expect(detail().getByTestId("avatar-picker-spec-cost")).toHaveTextContent("from 150 CR")
    expect(detail().getByRole("button", { name: "Preview voice" })).toBeDisabled()
    expect(detail().getByRole("button", { name: "Use this avatar" })).toBeEnabled()
    fireEvent.click(card("Mine"))
    expect(card("Mine")).toHaveAccessibleName("Mine, Female · Studio, 1 look, Processing…")
    expect(detail().getByRole("button", { name: "Use this avatar" })).toBeDisabled()
  })

  it("keyboard: arrow keys move the selection through the person radios (one tab stop); ⌘K / Ctrl+K focuses the search; Delete/Backspace never reach the document", () => {
    render(<AvatarPickerModal open onOpenChange={() => {}} onSelect={() => {}} />)
    const cora = card("Cora")
    const marieke = card("Marieke")
    expect(cora).toHaveAttribute("tabindex", "0")
    expect(marieke).toHaveAttribute("tabindex", "-1")
    fireEvent.keyDown(cora, { key: "ArrowRight" })
    expect(marieke).toHaveAttribute("aria-checked", "true")
    expect(detail().getByTestId("avatar-picker-detail-name")).toHaveTextContent("Marieke — Desk 1")
    fireEvent.keyDown(marieke, { key: "End" })
    expect(card("Mine")).toHaveAttribute("aria-checked", "true")

    const search = screen.getByLabelText("Search avatars") as HTMLInputElement
    search.blur()
    fireEvent.keyDown(card("Mine"), { key: "k", ctrlKey: true })
    expect(document.activeElement).toBe(search)

    const seen: string[] = []
    const spy = (e: KeyboardEvent) => seen.push(e.key)
    document.addEventListener("keydown", spy)
    fireEvent.keyDown(card("Mine"), { key: "Backspace" })
    fireEvent.keyDown(card("Mine"), { key: "Delete" })
    fireEvent.keyDown(card("Mine"), { key: "a" })
    document.removeEventListener("keydown", spy)
    expect(seen).toEqual(["a"])
  })

  it("Escape in a non-empty search clears it instead of closing; the shortcut hint follows the platform", () => {
    const onOpenChange = vi.fn()
    render(<AvatarPickerModal open onOpenChange={onOpenChange} onSelect={() => {}} initialQuery="cora" />)
    const search = screen.getByLabelText("Search avatars") as HTMLInputElement
    fireEvent.keyDown(search, { key: "Escape" })
    expect(search.value).toBe("")
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(searchShortcutLabel("MacIntel")).toBe("⌘K")
    expect(searchShortcutLabel("Win32")).toBe("Ctrl K")
  })
})
