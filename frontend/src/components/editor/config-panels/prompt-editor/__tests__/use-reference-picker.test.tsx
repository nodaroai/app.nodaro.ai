import { describe, it, expect, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useReferenceSwapPicker } from "../use-reference-picker"
import type { RefImageItem } from "../../tag-textarea"

interface Calls {
  deleteRange: Array<{ from: number; to: number }>
  insertContentAt: Array<{ pos: number; content: unknown[] }>
}

function mockProps(items: RefImageItem[]) {
  const calls: Calls = { deleteRange: [], insertContentAt: [] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {}
  chain.focus = () => chain
  chain.deleteRange = (r: { from: number; to: number }) => { calls.deleteRange.push(r); return chain }
  chain.insertContentAt = (pos: number, content: unknown[]) => { calls.insertContentAt.push({ pos, content }); return chain }
  chain.run = vi.fn(() => true)
  const editor = {
    storage: { imageRef: { referenceImages: items } },
    getText: () => "@kira:1 already",
    chain: () => chain,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props = { editor, node: { nodeSize: 1 }, getPos: () => 3 } as any
  return { props, calls }
}

const charItem: RefImageItem =
  ({ url: "u", label: "Kira", source: "character", index: 1, defaultLabel: "", characterSlug: "kira" }) as RefImageItem
const imgItem: RefImageItem =
  ({ url: "u2", label: "Image 2", source: "wired", index: 2, defaultLabel: "" }) as RefImageItem

describe("useReferenceSwapPicker", () => {
  it("exposes the full attached-reference list from imageRef storage", () => {
    const { props } = mockProps([charItem, imgItem])
    const { result } = renderHook(() => useReferenceSwapPicker(props))
    expect(result.current.items).toHaveLength(2)
  })

  it("openPicker / closePicker toggle the anchor", () => {
    const { props } = mockProps([imgItem])
    const { result } = renderHook(() => useReferenceSwapPicker(props))
    expect(result.current.pickerAnchor).toBeNull()
    act(() => result.current.openPicker({ top: 1 } as DOMRect))
    expect(result.current.pickerAnchor).not.toBeNull()
    act(() => result.current.closePicker())
    expect(result.current.pickerAnchor).toBeNull()
  })

  it("swap replaces the chip in place with the chosen character pill (fresh mention index)", () => {
    const { props, calls } = mockProps([charItem])
    const { result } = renderHook(() => useReferenceSwapPicker(props))
    act(() => result.current.swap(charItem))
    // Deletes THIS chip (pos 3 .. pos + nodeSize 1).
    expect(calls.deleteRange).toEqual([{ from: 3, to: 4 }])
    // Inserts the character pill at the same pos, NO trailing space.
    const ins = calls.insertContentAt[0]
    expect(ins.pos).toBe(3)
    expect(ins.content).toHaveLength(1)
    // getText has "@kira:1" → next mention index is 2.
    expect(ins.content[0]).toMatchObject({ type: "characterRef", attrs: { characterSlug: "kira", imageIndex: 2 } })
  })

  it("swap to a plain image uses the item's positional index", () => {
    const { props, calls } = mockProps([imgItem])
    const { result } = renderHook(() => useReferenceSwapPicker(props))
    act(() => result.current.swap(imgItem))
    expect(calls.insertContentAt[0].content[0]).toMatchObject({ type: "imageRef", attrs: { imageIndex: 2 } })
  })
})
