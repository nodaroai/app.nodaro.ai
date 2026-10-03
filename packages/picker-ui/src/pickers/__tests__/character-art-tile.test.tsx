import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CharacterArt, CharacterArtTile, CharacterThumb, type CharacterArtTileProps } from "../character-art-tile"
import { characterArtShape, characterArtUrl } from "../../icons/character-art"

// A person option with a photo, and one added after the photos were made.
const WITH_PHOTO = "face-round"
const NO_PHOTO = "texture-natural"

function tile(overrides: Partial<CharacterArtTileProps> = {}) {
  const props: CharacterArtTileProps = {
    family: "person",
    id: WITH_PHOTO,
    shape: "square",
    label: "Round",
    title: "Soft circular face",
    selected: false,
    multi: false,
    onPick: () => {},
    ...overrides,
  }
  return render(<CharacterArtTile {...props} />)
}

describe("characterArtUrl", () => {
  it("is root-relative for an option with a photo and undefined without one", () => {
    expect(characterArtUrl("person", WITH_PHOTO)).toMatch(/^\/picker-art\/character\/person\/face-round\.[0-9a-f]{8}\.webp$/)
    expect(characterArtUrl("person", NO_PHOTO)).toBeUndefined()
  })

  it("folds a non-ASCII option id to an ASCII file name", () => {
    expect(characterArtUrl("person", "madrileña")).toMatch(/\/madrilena\.[0-9a-f]{8}\.webp$/)
  })

  it("gives Type portrait tiles and the hair strips a strip", () => {
    expect(characterArtShape("person", "type")).toBe("portrait")
    expect(characterArtShape("person", "hair-base")).toBe("strip")
    expect(characterArtShape("person", "skin-texture")).toBe("wide")
    expect(characterArtShape("person", "age")).toBe("square")
  })
})

describe("CharacterArt", () => {
  it("renders the photo as a decorative, lazy image", () => {
    const { container } = render(<CharacterArt family="person" id={WITH_PHOTO} fallback={<span>fb</span>} />)
    const img = container.querySelector("img")!
    expect(img.getAttribute("src")).toBe(characterArtUrl("person", WITH_PHOTO))
    expect(img.getAttribute("alt")).toBe("")
    expect(img.getAttribute("loading")).toBe("lazy")
  })

  it("shows the fallback without a photo, and when the photo fails to load", () => {
    const { rerender, container } = render(<CharacterArt family="person" id={NO_PHOTO} fallback={<span>fb</span>} />)
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText("fb")).toBeInTheDocument()

    rerender(<CharacterArt family="person" id={WITH_PHOTO} fallback={<span>fb</span>} />)
    fireEvent.error(container.querySelector("img")!)
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText("fb")).toBeInTheDocument()
  })
})

describe("CharacterArtTile", () => {
  it("is a radio named by its label, with the photo inside", () => {
    const { container } = tile()
    const radio = screen.getByRole("radio", { name: "Round" })
    expect(radio).toHaveAttribute("aria-checked", "false")
    expect(radio).toHaveAttribute("title", "Soft circular face")
    expect(container.querySelector("img")?.getAttribute("src")).toBe(characterArtUrl("person", WITH_PHOTO))
  })

  it("is a checkbox in a multi-pick setting", () => {
    tile({ multi: true })
    expect(screen.getByRole("checkbox", { name: "Round" })).toBeInTheDocument()
  })

  it("calls onPick on click", () => {
    const onPick = vi.fn()
    tile({ onPick })
    fireEvent.click(screen.getByRole("radio", { name: "Round" }))
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it("marks a picked tile with a check, which a badge replaces", () => {
    const { container, rerender } = tile({ selected: true })
    expect(screen.getByRole("radio", { name: "Round" })).toHaveAttribute("aria-checked", "true")
    expect(container.querySelector("svg.lucide-check")).not.toBeNull()

    rerender(
      <CharacterArtTile family="person" id={WITH_PHOTO} shape="square" label="Round" selected multi onPick={() => {}} badge={<span>badge</span>} />,
    )
    expect(screen.getByText("badge")).toBeInTheDocument()
    expect(container.querySelector("svg.lucide-check")).toBeNull()
  })

  it("shows the drawn fallback in the picture box when the option has no photo", () => {
    const { container } = tile({ id: NO_PHOTO, label: "Natural", fallback: <span>drawn</span> })
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText("drawn")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Natural" })).toBeInTheDocument()
  })
})

describe("CharacterThumb", () => {
  it("crops a hair strip from its front view", () => {
    const { container } = render(<CharacterThumb family="person" id="base-short-wavy" shape="strip" className="size-[52px]" />)
    expect((container.querySelector("img") as HTMLImageElement).style.objectPosition).toBe("0% 50%")
  })
})

describe("CharacterArtTile — double-click", () => {
  // The full-screen settings close on a double-click on an option tile; only
  // the Person tiles (whose Compact popover lives in a portal) opt out.
  it("lets a double-click reach the full-screen settings by default", () => {
    const onDoubleClick = vi.fn()
    render(
      <div onDoubleClick={onDoubleClick}>
        <CharacterArtTile family="animals" id="lion" shape="square" label="Lion" selected={false} multi={false} onPick={() => {}} />
      </div>,
    )
    fireEvent.doubleClick(screen.getByRole("radio", { name: "Lion" }))
    expect(onDoubleClick).toHaveBeenCalledTimes(1)
  })

  it("keeps it inside when the tile asks to", () => {
    const onDoubleClick = vi.fn()
    render(
      <div onDoubleClick={onDoubleClick}>
        <CharacterArtTile family="person" id={WITH_PHOTO} shape="square" label="Round" selected={false} multi={false} onPick={() => {}} stopDoubleClick />
      </div>,
    )
    fireEvent.doubleClick(screen.getByRole("radio", { name: "Round" }))
    expect(onDoubleClick).not.toHaveBeenCalled()
  })

  it("names a shortened option by its full label", () => {
    tile({ label: "any", ariaLabel: "Asian (any)" })
    expect(screen.getByRole("radio", { name: "Asian (any)" })).toBeInTheDocument()
    expect(screen.getByText("any")).toBeInTheDocument()
  })
})
