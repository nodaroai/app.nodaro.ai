/**
 * The sidebar's collapse behaviour and its persistence.
 *
 * The data layer is covered in node-families.test.ts; what is easy to get
 * wrong and invisible in review is the state: whether a toggle touches only
 * its own section, and whether "everything collapsed" survives a reload.
 * That last one is the interesting case — an empty selection and a
 * never-configured one are both falsy-looking, and conflating them makes
 * Collapse all silently undo itself on the next visit.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))
vi.mock("@/lib/utils", () => ({ cn: (...a: unknown[]) => a.filter(Boolean).join(" ") }))

import { SidebarSection } from "../sidebar-section"
import {
  readOpenSections,
  persistOpenSections,
  SIDEBAR_DEFAULT_OPEN,
} from "@/lib/sidebar-sections-open"
import type { SidebarSection as Section } from "@/lib/node-picker-sections"

const header = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[aria-controls="sidebar-section-${id}"]`)!

const section = (id: string, label: string): Section => ({
  id,
  label,
  count: 2,
  families: [
    {
      id: `${id}-create`,
      label: "Create",
      options: [
        { type: "generate-image", label: "Generate Image", icon: null, category: "AI" },
        { type: "upload-image", label: "Upload Image", icon: null, category: "Input" },
      ],
    },
  ],
})

describe("SidebarSection", () => {
  it("hides its nodes when closed and shows them when open", () => {
    const { rerender } = render(
      <SidebarSection section={section("image", "Image")} open={false} onToggle={() => {}} onAdd={() => {}} />,
    )
    expect(header("image")).toHaveAttribute("aria-expanded", "false")
    // Not merely `hidden` — not rendered. A closed section that still mounts
    // its rows puts the whole catalogue in the DOM behind an attribute, and an
    // assertion on `[hidden]` alone would pass while that happened.
    expect(screen.queryByText("Generate Image")).toBeNull()
    // The panel itself stays, so aria-controls always resolves.
    expect(document.getElementById("sidebar-section-image")).not.toBeNull()

    rerender(
      <SidebarSection section={section("image", "Image")} open onToggle={() => {}} onAdd={() => {}} />,
    )
    expect(header("image")).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Generate Image")).toBeVisible()
  })

  it("points aria-controls at the panel it actually toggles", () => {
    render(<SidebarSection section={section("video", "Video")} open onToggle={() => {}} onAdd={() => {}} />)
    const id = header("video").getAttribute("aria-controls")
    expect(id).toBe("sidebar-section-video")
    expect(document.getElementById(id!)).not.toBeNull()
  })

  it("reports its own id when toggled, and adds the node that was clicked", () => {
    const onToggle = vi.fn()
    const onAdd = vi.fn()
    render(<SidebarSection section={section("audio", "Audio")} open onToggle={onToggle} onAdd={onAdd} />)
    fireEvent.click(header("audio"))
    expect(onToggle).toHaveBeenCalledWith("audio")
    fireEvent.click(screen.getByText("Upload Image"))
    expect(onAdd).toHaveBeenCalledWith("upload-image")
  })

  it("shows the node count beside the header", () => {
    render(<SidebarSection section={section("image", "Image")} open={false} onToggle={() => {}} onAdd={() => {}} />)
    expect(screen.getByText("2")).toBeInTheDocument()
  })
})

describe("open-section persistence", () => {
  beforeEach(() => localStorage.clear())

  it("opens Image only on a first run", () => {
    expect([...readOpenSections()]).toEqual([...SIDEBAR_DEFAULT_OPEN])
    expect(readOpenSections().has("image")).toBe(true)
    expect(readOpenSections().has("controls")).toBe(false)
  })

  it("round-trips a selection", () => {
    persistOpenSections(new Set(["video", "audio"]))
    expect([...readOpenSections()].sort()).toEqual(["audio", "video"])
  })

  it("keeps everything-collapsed collapsed across a reload", () => {
    // The regression this exists for: an empty array must not be mistaken for
    // "never configured" and reset to the default.
    persistOpenSections(new Set())
    expect([...readOpenSections()]).toEqual([])
  })

  it("falls back to the default when the stored value is corrupt", () => {
    localStorage.setItem("nodaro:sidebarOpenSections", "{not json")
    expect([...readOpenSections()]).toEqual([...SIDEBAR_DEFAULT_OPEN])
    localStorage.setItem("nodaro:sidebarOpenSections", '{"image":true}')
    expect([...readOpenSections()]).toEqual([...SIDEBAR_DEFAULT_OPEN])
  })

  it("drops non-string entries rather than trusting the payload", () => {
    localStorage.setItem("nodaro:sidebarOpenSections", '["video",7,null,"audio"]')
    expect([...readOpenSections()].sort()).toEqual(["audio", "video"])
  })
})
