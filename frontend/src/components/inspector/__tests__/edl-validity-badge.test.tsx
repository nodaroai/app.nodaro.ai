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
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("an invalid EDL counts its issues and lists them", async () => {
    render(<EdlValidityBadge value={BROKEN} />)
    const badge = screen.getByTestId("edl-validity-badge")
    expect(badge.dataset.ok).toBe("false")
    await userEvent.click(badge)
    expect((await screen.findAllByText(/ghost/)).length).toBeGreaterThan(0)
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
