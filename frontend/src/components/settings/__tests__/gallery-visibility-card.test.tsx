import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, fireEvent, screen, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { en } from "@/lib/i18n/en"
import { translate } from "@/lib/i18n"
import { GalleryVisibilityCard, privateToastMessage } from "../gallery-visibility-card"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Radix AlertDialog → plain DOM: render the content only while open, and let
// Action/Cancel be the buttons they wrap (jsdom lacks the portal/focus
// machinery the real one needs).
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, onOpenChange, children }: any) =>
    open ? (
      <div role="alertdialog">
        {children}
        <button type="button" data-testid="dismiss" onClick={() => onOpenChange(false)} />
      </div>
    ) : null,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogCancel: ({ children }: any) => <button type="button">{children}</button>,
  AlertDialogAction: ({ children, onClick }: any) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

const mutateAsync = vi.fn()
vi.mock("@/hooks/queries/use-user-settings-queries", () => ({
  useUpdatePublicOutputsMutation: () => ({ mutateAsync, isPending: false }),
}))

const USER = "u1"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GalleryVisibilityCard — switching to private", () => {
  it("asks first, with the line that existing items leave the public gallery too", () => {
    render(<GalleryVisibilityCard userId={USER} publicOutputs canToggle />)

    fireEvent.click(screen.getByRole("button", { name: en["settings.makePrivate"] }))

    const dialog = screen.getByRole("alertdialog")
    expect(dialog.textContent).toContain(en["settings.makePrivateConfirmTitle"])
    expect(dialog.textContent).toContain(en["settings.makePrivateHidesExisting"])
    expect(en["settings.makePrivateHidesExisting"]).toMatch(/existing items will be removed from the public gallery too/)
    // Nothing is sent until the person confirms.
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it("cancelling sends nothing", () => {
    render(<GalleryVisibilityCard userId={USER} publicOutputs canToggle />)
    fireEvent.click(screen.getByRole("button", { name: en["settings.makePrivate"] }))
    fireEvent.click(screen.getByTestId("dismiss"))

    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it("confirming switches to private and shows how many items were hidden", async () => {
    mutateAsync.mockResolvedValue({ publicOutputs: false, hiddenFromGallery: 8221 })
    render(<GalleryVisibilityCard userId={USER} publicOutputs canToggle />)

    fireEvent.click(screen.getByRole("button", { name: en["settings.makePrivate"] }))
    const confirm = screen.getAllByRole("button", { name: en["settings.makePrivate"] }).at(-1)!
    fireEvent.click(confirm)

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(mutateAsync).toHaveBeenCalledWith({ userId: USER, publicOutputs: false })
    expect(toast.success).toHaveBeenCalledWith(
      "Outputs are now private. 8221 items were removed from the public gallery.",
    )
  })

  it("a failure shows the server's sentence, never a success", async () => {
    mutateAsync.mockRejectedValue(new Error("Couldn't make outputs private. Please try again."))
    render(<GalleryVisibilityCard userId={USER} publicOutputs canToggle />)

    fireEvent.click(screen.getByRole("button", { name: en["settings.makePrivate"] }))
    fireEvent.click(screen.getAllByRole("button", { name: en["settings.makePrivate"] }).at(-1)!)

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.error).toHaveBeenCalledWith("Couldn't make outputs private. Please try again.")
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("is disabled below the plan that allows it", () => {
    render(<GalleryVisibilityCard userId={USER} publicOutputs canToggle={false} />)
    expect((screen.getByRole("button", { name: en["settings.makePrivate"] }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe("GalleryVisibilityCard — switching back to public", () => {
  it("says items already made stay private, and switches without a dialog", async () => {
    mutateAsync.mockResolvedValue({ publicOutputs: true, hiddenFromGallery: 0 })
    render(<GalleryVisibilityCard userId={USER} publicOutputs={false} canToggle />)

    expect(screen.getByText(en["settings.galleryPrivateDesc"])).toBeTruthy()
    expect(en["settings.galleryPrivateDesc"]).toMatch(/items you already made stay private/)

    fireEvent.click(screen.getByRole("button", { name: en["settings.makePublic"] }))

    expect(screen.queryByRole("alertdialog")).toBeNull()
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(en["settings.outputsPublic"]))
    expect(mutateAsync).toHaveBeenCalledWith({ userId: USER, publicOutputs: true })
  })
})

describe("privateToastMessage", () => {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

  it("names nothing when nothing was public", () => {
    expect(privateToastMessage(t, 0)).toBe(en["settings.outputsPrivate"])
  })

  it("uses the singular for one item", () => {
    expect(privateToastMessage(t, 1)).toBe(en["settings.outputsPrivateHiddenOne"])
  })

  it("counts many", () => {
    expect(privateToastMessage(t, 3)).toBe("Outputs are now private. 3 items were removed from the public gallery.")
  })
})
