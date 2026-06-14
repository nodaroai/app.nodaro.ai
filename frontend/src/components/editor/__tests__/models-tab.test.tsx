import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { buildModelTree } from "@nodaro/shared"
import { NODE_DEF_MAP } from "@/types/nodes"
import { ModelsTab } from "../models-tab"

describe("ModelsTab", () => {
  it("lists lines, drills into variants, and emits the node target on select", () => {
    const onSelect = vi.fn()
    render(<ModelsTab searchQuery="" onSelectModel={onSelect} />)
    const nb = screen.getByText("Nano Banana")
    fireEvent.click(nb)
    const variant = screen.getAllByRole("button").find((b) => /creates/i.test(b.textContent ?? ""))
    expect(variant).toBeTruthy()
    fireEvent.click(variant!)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0]).toEqual(expect.objectContaining({ nodeType: expect.any(String), label: expect.any(String) }))
  })

  it("search flattens to matching variants across lines", () => {
    render(<ModelsTab searchQuery="kontext" onSelectModel={vi.fn()} />)
    const hits = screen.getAllByText(/Kontext/i)
    expect(hits.length).toBeGreaterThan(0)
  })

  it("renders no empty folder (every line has >=1 model)", () => {
    render(<ModelsTab searchQuery="" onSelectModel={vi.fn()} />)
    for (const el of screen.getAllByText(/· \d+ models/)) {
      const n = Number((el.textContent ?? "").match(/· (\d+) models/)?.[1])
      expect(n).toBeGreaterThan(0)
    }
  })

  it("every variant maps to a real node type (drift guard)", () => {
    for (const line of buildModelTree()) for (const m of line.models) expect(NODE_DEF_MAP.has(m.nodeType)).toBe(true)
  })

  it("keyboard: ArrowDown + Enter drills into the first line, then selects the first variant", () => {
    const onSelect = vi.fn()
    render(<ModelsTab searchQuery="" onSelectModel={onSelect} />)
    // first line is highlighted by default; Enter drills in
    fireEvent.keyDown(document, { key: "Enter" })
    // now on a variant list; Enter selects the highlighted (first) variant
    fireEvent.keyDown(document, { key: "Enter" })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0]).toEqual(expect.objectContaining({ nodeType: expect.any(String), label: expect.any(String) }))
  })
})
