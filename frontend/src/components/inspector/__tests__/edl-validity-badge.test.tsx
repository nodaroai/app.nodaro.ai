import { describe, it, expect, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { fireEvent } from "@testing-library/react"
import { EdlValidityBadge } from "../edl-validity-badge"

const seg = (id: string, inMs: number, outMs: number, video = "v") => ({ id, inMs, outMs, video })
const edlOf = (...segments: Array<Record<string, unknown>>) => ({
  version: 1, clock: "master", sources: [{ id: "v", url: "https://cdn/v.mp4", kind: "video" }], segments,
})
const VALID = edlOf(seg("s0", 0, 5000))
const BROKEN = edlOf(seg("s0", 0, 5000, "ghost"))

describe("EdlValidityBadge", () => {
  it("says nothing when there is no EDL", () => {
    const { container } = render(<EdlValidityBadge value={undefined} />)
    expect(container.innerHTML).toBe("")
  })

  // It promises structure only: "Well-formed", never "Valid" (decided 2026-10-04 —
  // the render's own rule judges whatever is anchored at a render).
  it("a well-formed EDL reads 'Well-formed EDL', with nothing to open", () => {
    render(<EdlValidityBadge value={VALID} />)
    expect(screen.getByTestId("edl-validity-badge").textContent).toContain("Well-formed EDL")
    expect(screen.getByTestId("edl-validity-badge").textContent).not.toMatch(/\bValid\b/)
    expect(screen.getByTestId("edl-validity-badge").dataset.mode).toBe("structure")
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("an invalid EDL counts its issues and lists them", async () => {
    render(<EdlValidityBadge value={BROKEN} />)
    const badge = screen.getByTestId("edl-validity-badge")
    expect(badge.dataset.ok).toBe("false")
    await userEvent.click(badge)
    expect((await screen.findAllByText(/ghost/)).length).toBeGreaterThan(0)
  })

  // The Apply EDL panel's badge (A2b): judged with Apply EDL's own render rule,
  // which refuses what a well-formed EDL can still describe and this renderer
  // cannot draw. Its pass reads "Ready to render".
  describe("in render mode", () => {
    const RENDER = { clipList: false, output: "video", crossfadeMs: 0, sources: [] } as const
    const LAYOUT = {
      ...VALID,
      sources: [...VALID.sources, { id: "w", url: "https://cdn/w.mp4", kind: "video" }],
      segments: [
        seg("s0", 0, 3000),
        { ...seg("s1", 3000, 6000), layout: { mode: "side-by-side", slots: [{ source: "v" }, { source: "w" }] } },
      ],
    }

    it("a renderable EDL reads 'Ready to render', with nothing to open", () => {
      render(<EdlValidityBadge value={VALID} render={RENDER} />)
      const badge = screen.getByTestId("edl-validity-badge")
      expect(badge.textContent).toContain("Ready to render")
      expect(badge.textContent).not.toContain("Well-formed")
      expect(badge.dataset.mode).toBe("render")
      expect(screen.queryByRole("button")).toBeNull()
    })

    it("a well-formed EDL the renderer cannot draw is an issue, listed in the rule's words", async () => {
      const { unmount } = render(<EdlValidityBadge value={LAYOUT} />)
      expect(screen.getByTestId("edl-validity-badge").textContent).toContain("Well-formed EDL")
      unmount()
      render(<EdlValidityBadge value={LAYOUT} render={RENDER} />)
      const badge = screen.getByTestId("edl-validity-badge")
      expect(badge.dataset.ok).toBe("false")
      expect(badge.textContent).toContain("2 EDL issues")
      await userEvent.click(badge)
      expect((await screen.findAllByText(/layout mode "side-by-side"/)).length).toBeGreaterThan(0)
    })

    it("judges with the node's settings: an audio render needs no picture", () => {
      const noPicture = {
        ...VALID,
        sources: [...VALID.sources, { id: "m", url: "https://cdn/m.wav", kind: "audio", role: "master-audio" }],
        segments: [seg("s0", 0, 3000), { id: "s1", inMs: 3000, outMs: 6000 }],
      }
      const { unmount } = render(<EdlValidityBadge value={noPicture} render={RENDER} />)
      expect(screen.getByTestId("edl-validity-badge").dataset.ok).toBe("false")
      unmount()
      render(<EdlValidityBadge value={noPicture} render={{ ...RENDER, output: "audio" }} />)
      expect(screen.getByTestId("edl-validity-badge").textContent).toContain("Ready to render")
    })

    it("an inline list is an issue", () => {
      render(<EdlValidityBadge value={[VALID]} render={RENDER} />)
      expect(screen.getByTestId("edl-validity-badge").dataset.ok).toBe("false")
    })

    it("says nothing when there is nothing to render", () => {
      const { container } = render(<EdlValidityBadge value={undefined} render={RENDER} />)
      expect(container.innerHTML).toBe("")
    })
  })

  // Review of #1789: on the canvas node, the popover's keys reached React Flow
  // (arrows moved the node, Backspace deleted it); inside the inspector, the
  // modal's scroll lock swallowed the list's wheel events.
  describe("its popover stays out of the canvas's way", () => {
    let wheels = 0
    const onDocWheel = () => { wheels++ }
    afterEach(() => document.removeEventListener("wheel", onDocWheel))

    it("trigger and popover are .nokey, and the list's wheel stays in the popover", async () => {
      render(<EdlValidityBadge value={BROKEN} />)
      const trigger = screen.getByTestId("edl-validity-badge")
      expect(trigger.classList.contains("nokey")).toBe(true)
      await userEvent.click(trigger)
      const content = (await screen.findAllByText(/ghost/))[0]!.closest('[data-slot="popover-content"]') as HTMLElement
      expect(content).not.toBeNull()
      expect(content.classList.contains("nokey")).toBe(true)
      wheels = 0
      document.addEventListener("wheel", onDocWheel)
      fireEvent.wheel(content, { deltaY: 100 })
      expect(wheels).toBe(0) // stopped before a document-level scroll lock can cancel it
    })
  })
})
