import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { BoardCreateModal } from "../board-create-modal"
import { MAX_CHARACTER_BOARDS } from "../board-constants"

vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 4 }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))

const groups = [
  { id: "portrait", label: "Portrait", items: [{ name: "Portrait", url: "https://r2/p.png" }] },
  {
    id: "expressions",
    label: "Expressions",
    items: [
      { name: "smile", url: "https://r2/s.png" },
      { name: "frown", url: "https://r2/f.png" },
    ],
  },
]

function renderModal(over: Partial<Parameters<typeof BoardCreateModal>[0]> = {}) {
  const onGenerate = vi.fn()
  render(
    <BoardCreateModal
      open
      onClose={vi.fn()}
      groups={groups}
      boards={[]}
      generatingNames={[]}
      initial={null}
      onGenerate={onGenerate}
      {...over}
    />,
  )
  return { onGenerate }
}

describe("BoardCreateModal", () => {
  it("renders group headers and disables Generate below the minimum", () => {
    renderModal()
    // Scoped to the `heading` role (the group's <h3>), not plain getByText:
    // the "portrait" group's only item is itself named "Portrait", so its
    // thumbnail's name-badge <span> also renders the literal text "Portrait"
    // and a text-only query matches both nodes. The heading role targets only
    // the section header, which is what "renders group headers" means to test.
    expect(screen.getByRole("heading", { name: "Portrait" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Expressions" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled()
  })

  it("numbers selections in click order and enables Generate at 2", () => {
    const { onGenerate } = renderModal()
    fireEvent.click(screen.getByRole("button", { name: "smile" }))
    fireEvent.click(screen.getByRole("button", { name: "Portrait" }))
    expect(screen.getByText("2/12 selected")).toBeInTheDocument()
    const gen = screen.getByRole("button", { name: /generate/i })
    expect(gen).toBeEnabled()
    fireEvent.change(screen.getByLabelText("Board name"), { target: { value: "My look" } })
    fireEvent.click(gen)
    expect(onGenerate).toHaveBeenCalledWith({
      name: "My look",
      imageUrls: ["https://r2/s.png", "https://r2/p.png"], // click order = collage order
    })
  })

  it("collision-suffixes the name against existing + generating boards", () => {
    const { onGenerate } = renderModal({
      boards: [{ name: "My look", url: "https://r2/b.png", type: "identity", sourceImages: ["https://r2/p.png"] }],
      generatingNames: ["My look 2"],
    })
    fireEvent.click(screen.getByRole("button", { name: "smile" }))
    fireEvent.click(screen.getByRole("button", { name: "frown" }))
    fireEvent.change(screen.getByLabelText("Board name"), { target: { value: "My look" } })
    fireEvent.click(screen.getByRole("button", { name: /generate/i }))
    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ name: "My look 3" }))
  })

  it("'Start from a board' replaces the selection with the board's sourceImages still in the pool", () => {
    renderModal({
      boards: [{
        name: "Base",
        url: "https://r2/b.png",
        type: "identity",
        sourceImages: ["https://r2/p.png", "https://r2/GONE.png", "https://r2/f.png"],
      }],
    })
    fireEvent.click(screen.getByRole("button", { name: "smile" })) // pre-existing selection
    fireEvent.click(screen.getByRole("button", { name: /start from base/i }))
    expect(screen.getByText("2/12 selected")).toBeInTheDocument() // GONE.png dropped
  })

  it("applies the duplicate-flow initial selection + name", () => {
    renderModal({ initial: { name: "Base 2", selectedUrls: ["https://r2/p.png", "https://r2/f.png"] } })
    expect(screen.getByLabelText("Board name")).toHaveValue("Base 2")
    expect(screen.getByText("2/12 selected")).toBeInTheDocument()
  })

  it("disables Generate and shows the cap hint when capReached, even with 2+ selected", () => {
    renderModal({ capReached: true })
    fireEvent.click(screen.getByRole("button", { name: "smile" }))
    fireEvent.click(screen.getByRole("button", { name: "Portrait" }))
    expect(screen.getByText("2/12 selected")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled()
    expect(screen.getByText(`Up to ${MAX_CHARACTER_BOARDS} boards — delete one first.`)).toBeInTheDocument()
  })

  it("keeps the in-progress selection when groups changes identity mid-edit (resets only on closed→open)", () => {
    const props = {
      open: true,
      onClose: vi.fn(),
      boards: [],
      generatingNames: [],
      initial: null,
      onGenerate: vi.fn(),
    }
    const { rerender } = render(<BoardCreateModal {...props} groups={groups} />)
    fireEvent.click(screen.getByRole("button", { name: "smile" }))
    fireEvent.click(screen.getByRole("button", { name: "frown" }))
    expect(screen.getByText("2/12 selected")).toBeInTheDocument()
    // The Board page rebuilds `groups` from studio staged state on every patch
    // (debounced saves, job-poll appends), so a NEW array identity with the
    // same contents routinely lands while the modal is open. That must NOT
    // clobber the user's in-progress selection.
    const rebuiltGroups = groups.map((g) => ({ ...g, items: g.items.map((it) => ({ ...it })) }))
    rerender(<BoardCreateModal {...props} groups={rebuiltGroups} />)
    expect(screen.getByText("2/12 selected")).toBeInTheDocument()
  })
})
