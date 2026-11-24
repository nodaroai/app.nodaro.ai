import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const auth = vi.hoisted(() => ({ userId: undefined as string | undefined }))
const importer = vi.hoisted(() => ({
  importFrom: vi.fn(async (read: () => Promise<string>) => {
    await read()
  }),
  isImporting: false,
}))
vi.mock("@/hooks/use-auth", () => ({ useCachedUserId: () => auth.userId }))
vi.mock("@/hooks/use-import-workflow-json", () => ({ useImportWorkflowJson: () => importer }))
vi.mock("@/lib/api", () => ({ workflowViewExportPath: (token: string) => `https://api.test/v1/workflow-views/${token}/export` }))
vi.mock("@/lib/i18n", () => ({ useT: () => (key: string) => key }))

import { CopyToAccountButton } from "../copy-to-account-button"

const TOKEN = "t".repeat(43)

function renderButton() {
  return render(
    <MemoryRouter>
      <CopyToAccountButton token={TOKEN} />
    </MemoryRouter>,
  )
}

describe("CopyToAccountButton", () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, text: async () => '{"nodes":[],"edges":[]}' })
    vi.stubGlobal("fetch", fetchMock)
    importer.importFrom.mockClear()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    auth.userId = undefined
  })

  it("signed out: a link to sign in that comes back to this page, and nothing is fetched or imported", () => {
    renderButton()
    const link = screen.getByRole("link", { name: "workflowView.signInToCopy" })
    expect(link).toHaveAttribute("href", `/login?redirect=${encodeURIComponent(`/view/${TOKEN}`)}`)
    expect(screen.queryByRole("button")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("signed in: imports the owner's saved copy, read without the session", async () => {
    auth.userId = "user-1"
    renderButton()
    fireEvent.click(screen.getByRole("button", { name: "workflowView.copyToAccount" }))
    await waitFor(() => expect(importer.importFrom).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(`https://api.test/v1/workflow-views/${TOKEN}/export`, { credentials: "omit" })
  })

  it("signed in: a saved copy that is gone fails the import instead of importing nothing", async () => {
    auth.userId = "user-1"
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => "" })
    let failure: unknown = null
    importer.importFrom.mockImplementationOnce(async (read) => {
      await read().catch((err: unknown) => {
        failure = err
      })
    })
    renderButton()
    fireEvent.click(screen.getByRole("button", { name: "workflowView.copyToAccount" }))
    await waitFor(() => expect(failure).toBeInstanceOf(Error))
  })
})
