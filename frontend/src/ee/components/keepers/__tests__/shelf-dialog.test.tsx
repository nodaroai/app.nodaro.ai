import { describe, expect, it, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { KeeperShelfDialog } from "../shelf-dialog"
import { STUDIO_CHILD_DIALOG_Z, STUDIO_MODAL_Z_VALUE } from "@/components/editor/studio-shell/studio-modal-z"

const api = vi.hoisted(() => ({
  readKeeperShelf: vi.fn(),
  setKeeperCatalog: vi.fn(),
}))
vi.mock("@/lib/api", () => api)

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff"

const parseZ = (cls: string): number => {
  const m = cls.match(/z-\[(\d+)\]/)
  if (!m) throw new Error(`expected a z-[N] arbitrary value, got "${cls}"`)
  return Number(m[1])
}

beforeEach(() => {
  api.readKeeperShelf.mockReset()
  api.setKeeperCatalog.mockReset()
  toast.success.mockReset()
  toast.error.mockReset()
})

describe("KeeperShelfDialog", () => {
  it("prefills from the item's own shelf state on open", async () => {
    api.readKeeperShelf.mockResolvedValue({ catalog: true, sort: 3, category: "Heroes" })
    render(<KeeperShelfDialog kind="character" entityId={ID} open onOpenChange={vi.fn()} />)

    expect(api.readKeeperShelf).toHaveBeenCalledWith("character", ID)
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"))
    expect(screen.getByLabelText("Shelf heading")).toHaveValue("Heroes")
    expect(screen.getByLabelText("Shelf order (lowest first)")).toHaveValue(3)
  })

  it("saves the toggle, the heading and the order through the kind's catalog route; a blank heading clears it", async () => {
    api.readKeeperShelf.mockResolvedValue({ catalog: false, sort: 0, category: null })
    api.setKeeperCatalog.mockResolvedValue({ id: ID, kind: "creature", catalog: true, sort: 7, category: null })
    const onOpenChange = vi.fn()
    render(<KeeperShelfDialog kind="creature" entityId={ID} open onOpenChange={onOpenChange} />)

    await waitFor(() => expect(screen.getByRole("switch")).not.toBeDisabled())
    fireEvent.click(screen.getByRole("switch"))
    fireEvent.change(screen.getByLabelText("Shelf heading"), { target: { value: "   " } })
    fireEvent.change(screen.getByLabelText("Shelf order (lowest first)"), { target: { value: "7" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(api.setKeeperCatalog).toHaveBeenCalledTimes(1))
    expect(api.setKeeperCatalog).toHaveBeenCalledWith("creature", ID, { catalog: true, sort: 7, category: null })
    expect(toast.success).toHaveBeenCalledWith("On the Keepers shelf")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("says the item was taken off when the server answers catalog: false", async () => {
    api.readKeeperShelf.mockResolvedValue({ catalog: true, sort: 1, category: "Heroes" })
    api.setKeeperCatalog.mockResolvedValue({ id: ID, kind: "character", catalog: false, sort: 1, category: "Heroes" })
    render(<KeeperShelfDialog kind="character" entityId={ID} open onOpenChange={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"))
    fireEvent.click(screen.getByRole("switch"))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(api.setKeeperCatalog).toHaveBeenCalledWith("character", ID, { catalog: false, sort: 1, category: "Heroes" }))
    expect(toast.success).toHaveBeenCalledWith("Taken off the Keepers shelf")
  })

  it("refuses an order outside the route's bound and a non-integer, without calling the server", async () => {
    api.readKeeperShelf.mockResolvedValue({ catalog: false, sort: 0, category: null })
    render(<KeeperShelfDialog kind="object" entityId={ID} open onOpenChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole("switch")).not.toBeDisabled())

    const sort = screen.getByLabelText("Shelf order (lowest first)")
    fireEvent.change(sort, { target: { value: "1000001" } })
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    expect(sort).toHaveAttribute("aria-invalid", "true")

    fireEvent.change(sort, { target: { value: "1.5" } })
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()

    fireEvent.change(sort, { target: { value: "-1000000" } })
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled()
    expect(api.setKeeperCatalog).not.toHaveBeenCalled()
  })

  it("keeps the form closed to edits and Save off when the state could not be read", async () => {
    api.readKeeperShelf.mockRejectedValue(new Error("Could not read the shelf state"))
    render(<KeeperShelfDialog kind="location" entityId={ID} open onOpenChange={vi.fn()} />)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not read the shelf state"))
    expect(screen.getByRole("switch")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("shows the server's message when the save fails and stays open", async () => {
    api.readKeeperShelf.mockResolvedValue({ catalog: false, sort: 0, category: null })
    api.setKeeperCatalog.mockRejectedValue(new Error("Admin only"))
    const onOpenChange = vi.fn()
    render(<KeeperShelfDialog kind="character" entityId={ID} open onOpenChange={onOpenChange} />)
    await waitFor(() => expect(screen.getByRole("switch")).not.toBeDisabled())

    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Admin only"))
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("caps the heading at the route's 80 characters", async () => {
    api.readKeeperShelf.mockResolvedValue({ catalog: false, sort: 0, category: null })
    render(<KeeperShelfDialog kind="character" entityId={ID} open onOpenChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole("switch")).not.toBeDisabled())
    expect(screen.getByLabelText("Shelf heading")).toHaveAttribute("maxlength", "80")
  })

  it("lifts the content AND the backdrop above the studio modal it opens from", async () => {
    // jsdom has no stacking contexts: the real bug (a dialog buried behind the
    // opaque studio, the button "doing nothing") only shows in a browser, so
    // the class wiring itself is what is guarded (board-dialogs-zindex pattern).
    api.readKeeperShelf.mockResolvedValue({ catalog: false, sort: 0, category: null })
    render(<KeeperShelfDialog kind="character" entityId={ID} open onOpenChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument())

    const content = screen.getByRole("dialog")
    expect(content.className).toContain(STUDIO_CHILD_DIALOG_Z)
    expect(parseZ(content.className)).toBeGreaterThan(STUDIO_MODAL_Z_VALUE)
    const overlay = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement
    expect(overlay).not.toBeNull()
    expect(overlay.className).toContain(STUDIO_CHILD_DIALOG_Z)
  })
})
