import { describe, expect, it, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { KeepersShelfButton } from "../keepers-shelf-button"

const auth = vi.hoisted(() => ({ isAdmin: true }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }))

const edition = vi.hoisted(() => ({ multiUser: true }))
vi.mock("@/lib/edition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/edition")>()
  return { ...actual, isMultiUser: () => edition.multiUser }
})

const dialog = vi.hoisted(() => ({ render: vi.fn() }))
vi.mock("@/ee/components/keepers/shelf-dialog", () => ({
  default: (props: { kind: string; entityId: string; open: boolean }) => {
    dialog.render(props)
    return props.open ? <div data-testid="shelf-dialog">{props.kind}:{props.entityId}</div> : null
  },
}))

const ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff"
const IMG = "https://r2/main.png"

beforeEach(() => {
  auth.isAdmin = true
  edition.multiUser = true
  dialog.render.mockReset()
})

describe("KeepersShelfButton", () => {
  it("renders nothing for a user who is not a platform admin", () => {
    auth.isAdmin = false
    render(<KeepersShelfButton kind="character" dbId={ID} sourceImageUrl={IMG} />)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("renders nothing on a single-user edition (the shelf has no admin there)", () => {
    edition.multiUser = false
    render(<KeepersShelfButton kind="character" dbId={ID} sourceImageUrl={IMG} />)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("is disabled until the item is saved, and does not mount the dialog without a row", () => {
    render(<KeepersShelfButton kind="location" dbId="" sourceImageUrl={IMG} />)
    expect(screen.getByRole("button", { name: /Keepers shelf/ })).toBeDisabled()
    expect(dialog.render).not.toHaveBeenCalled()
  })

  it("is disabled while the item has no main image (it would stay off the shelf even when marked)", () => {
    render(<KeepersShelfButton kind="object" dbId={ID} sourceImageUrl={null} />)
    expect(screen.getByRole("button", { name: /Keepers shelf/ })).toBeDisabled()
  })

  it("opens the shelf dialog for the item's kind and row", async () => {
    render(<KeepersShelfButton kind="creature" dbId={ID} sourceImageUrl={IMG} />)
    const button = screen.getByRole("button", { name: /Keepers shelf/ })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByTestId("shelf-dialog")).toHaveTextContent(`creature:${ID}`))
  })
})
