// The Music node's reference link: Get fetches the link's sound only under the
// content rights box ticked for that link on this node, and confirms it for
// that one fetch (`node-link-rights.ts`; the declaration's text is the shared
// box's own, stubbed here).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

const calls = vi.hoisted(() => ({ download: vi.fn(), confirm: vi.fn() }))

vi.mock("@/lib/api", () => ({ downloadYouTubeAudio: calls.download }))
vi.mock("@/lib/node-link-rights", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/node-link-rights")>()),
  confirmNodeLink: calls.confirm,
}))
vi.mock("@/components/content-rights/rights-declaration-box", () => ({
  RightsDeclarationBox: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <input type="checkbox" aria-label="rights" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
  ),
}))

import { MusicReferenceLink } from "../music-reference-link"
import { clearNodeLinkRights, isNodeLinkRightsTicked, tickNodeLinkRights } from "@/lib/node-link-rights"
import { DeclarationChangedError } from "@/lib/content-rights"

const LINK = "https://example.com/watch/track"

function renderLink(props: Partial<Parameters<typeof MusicReferenceLink>[0]> = {}) {
  const onFetched = vi.fn()
  render(<MusicReferenceLink nodeId="m1" link={LINK} ready={false} onLinkChange={vi.fn()} onFetched={onFetched} {...props} />)
  return { onFetched }
}

const box = () => screen.queryByRole("checkbox", { name: "rights" }) as HTMLInputElement | null
const getButton = () => screen.getByRole("button") as HTMLButtonElement

beforeEach(() => {
  calls.download.mockReset()
  calls.confirm.mockReset()
})
afterEach(() => clearNodeLinkRights())

describe("MusicReferenceLink — the reference link is fetched only under the content rights box", () => {
  it("shows the box under a link, unticked, and Get waits for it; ticking ticks it for that link on this node", () => {
    renderLink()
    expect(box()?.checked).toBe(false)
    expect(getButton().disabled).toBe(true)
    fireEvent.click(box()!)
    expect(isNodeLinkRightsTicked("m1", LINK)).toBe(true)
    expect(getButton().disabled).toBe(false)
    fireEvent.click(box()!)
    expect(isNodeLinkRightsTicked("m1", LINK)).toBe(false)
  })

  it("Get confirms the link on this node for that one fetch, then fetches under the confirmation and hands on the stored file", async () => {
    tickNodeLinkRights("m1", LINK)
    calls.confirm.mockResolvedValueOnce("conf-1")
    calls.download.mockResolvedValueOnce({ url: "https://cdn/ref.mp3", thumbnailUrl: null })
    const { onFetched } = renderLink()
    fireEvent.click(getButton())
    await waitFor(() => expect(onFetched).toHaveBeenCalledWith("https://cdn/ref.mp3"))
    expect(calls.confirm).toHaveBeenCalledWith("m1", LINK)
    expect(calls.download).toHaveBeenCalledWith(LINK, { confirmationId: "conf-1" })
    expect(calls.confirm.mock.invocationCallOrder[0]).toBeLessThan(calls.download.mock.invocationCallOrder[0]!)
  })

  it("a box ticked for another link, or on another node, is not this one's: Get stays disabled and nothing is fetched", () => {
    tickNodeLinkRights("m1", "https://example.com/watch/other")
    tickNodeLinkRights("m2", LINK)
    renderLink()
    expect(box()?.checked).toBe(false)
    expect(getButton().disabled).toBe(true)
    fireEvent.click(getButton())
    expect(calls.confirm).not.toHaveBeenCalled()
    expect(calls.download).not.toHaveBeenCalled()
  })

  it("a changed declaration fetches nothing and says no failure; another refusal says the download failed", async () => {
    tickNodeLinkRights("m1", LINK)
    calls.confirm.mockRejectedValueOnce(new DeclarationChangedError())
    renderLink()
    fireEvent.click(getButton())
    await waitFor(() => expect(getButton().textContent).not.toBe("..."))
    expect(calls.download).not.toHaveBeenCalled()
    expect(screen.queryByText("Download failed")).toBeNull()

    calls.confirm.mockResolvedValueOnce("conf-2")
    calls.download.mockRejectedValueOnce(new Error("refused"))
    fireEvent.click(getButton())
    await waitFor(() => expect(screen.getByText("Download failed")).toBeInTheDocument())
  })

  it("no link: no box, and Get stays disabled", () => {
    renderLink({ link: "" })
    expect(box()).toBeNull()
    expect(getButton().disabled).toBe(true)
  })

  it("no node to tick a box on: no box, and Get stays disabled", () => {
    tickNodeLinkRights("", LINK)
    renderLink({ nodeId: null })
    expect(box()).toBeNull()
    expect(getButton().disabled).toBe(true)
  })
})
