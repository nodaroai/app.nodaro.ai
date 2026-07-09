import { describe, it, expect, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useReferenceSwapPicker } from "../use-reference-picker"
import type { RefImageItem } from "../../tag-textarea"

interface Calls {
  deleteRange: Array<{ from: number; to: number }>
  insertContentAt: Array<{ pos: number; content: unknown[] }>
}

function mockProps(
  items: RefImageItem[],
  node: { typeName?: string; attrs?: Record<string, unknown> } = {},
) {
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
  const props = {
    editor,
    node: { nodeSize: 1, type: { name: node.typeName ?? "imageRef" }, attrs: node.attrs ?? {} },
    getPos: () => 3,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
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

describe("same-entity swap preserves the role (Variant + Role Separation)", () => {
  const kiraWalking: RefImageItem = ({
    url: "u-walk", label: "Kira / walking", source: "character", index: 1,
    defaultLabel: "", characterSlug: "kira", variantSlug: "walking",
  }) as RefImageItem

  it("same-character swap to a VARIANT carries the role into the 4th segment", () => {
    // Current pill: canonical @kira:1:clothes (role in the seg3 slot).
    const { props, calls } = mockProps([charItem, kiraWalking], {
      typeName: "characterRef",
      attrs: { characterSlug: "kira", variantSlug: "clothes", usageMode: null, role: null },
    })
    const { result } = renderHook(() => useReferenceSwapPicker(props))
    act(() => result.current.swap(kiraWalking))
    expect(calls.insertContentAt[0].content[0]).toMatchObject({
      type: "characterRef",
      attrs: { characterSlug: "kira", variantSlug: "walking", usageMode: null, role: "clothes" },
    })
  })

  it("same-character swap to CANONICAL re-routes the role back to the seg3 slot", () => {
    // Current pill: @kira:1:walking:clothes (variant + 4th-segment role).
    const { props, calls } = mockProps([charItem, kiraWalking], {
      typeName: "characterRef",
      attrs: { characterSlug: "kira", variantSlug: "walking", usageMode: null, role: "clothes" },
    })
    const { result } = renderHook(() => useReferenceSwapPicker(props))
    act(() => result.current.swap(charItem))
    expect(calls.insertContentAt[0].content[0]).toMatchObject({
      type: "characterRef",
      attrs: { characterSlug: "kira", variantSlug: "clothes", usageMode: null, role: null },
    })
  })

  it("a usage-mode role (face) survives a same-character swap in the usageMode slot", () => {
    const { props, calls } = mockProps([charItem, kiraWalking], {
      typeName: "characterRef",
      attrs: { characterSlug: "kira", variantSlug: null, usageMode: "face", role: null },
    })
    const { result } = renderHook(() => useReferenceSwapPicker(props))
    act(() => result.current.swap(kiraWalking))
    expect(calls.insertContentAt[0].content[0]).toMatchObject({
      type: "characterRef",
      attrs: { variantSlug: "walking", usageMode: "face", role: null },
    })
  })

  it("the lock flag survives a same-character swap", () => {
    const { props, calls } = mockProps([charItem, kiraWalking], {
      typeName: "characterRef",
      attrs: { characterSlug: "kira", variantSlug: null, usageMode: null, role: null, lock: true },
    })
    const { result } = renderHook(() => useReferenceSwapPicker(props))
    act(() => result.current.swap(kiraWalking))
    expect(calls.insertContentAt[0].content[0]).toMatchObject({
      attrs: { variantSlug: "walking", lock: true },
    })
  })

  it("a DIFFERENT character gets fresh defaults (no role carry-over)", () => {
    const abi: RefImageItem = ({
      url: "u-abi", label: "Abi", source: "character", index: 1,
      defaultLabel: "", characterSlug: "abi",
    }) as RefImageItem
    const { props, calls } = mockProps([charItem, abi], {
      typeName: "characterRef",
      attrs: { characterSlug: "kira", variantSlug: "clothes", usageMode: null, role: null },
    })
    const { result } = renderHook(() => useReferenceSwapPicker(props))
    act(() => result.current.swap(abi))
    expect(calls.insertContentAt[0].content[0]).toMatchObject({
      type: "characterRef",
      attrs: { characterSlug: "abi", variantSlug: null, role: null },
    })
  })

  it("a REAL current variant is NOT treated as a role (swap to canonical drops it cleanly)", () => {
    // Current pill: @kira:1:walking (real variant, no role). Swapping to
    // canonical must NOT resurrect "walking" as a role.
    const { props, calls } = mockProps([charItem, kiraWalking], {
      typeName: "characterRef",
      attrs: { characterSlug: "kira", variantSlug: "walking", usageMode: null, role: null },
    })
    const { result } = renderHook(() => useReferenceSwapPicker(props))
    act(() => result.current.swap(charItem))
    expect(calls.insertContentAt[0].content[0]).toMatchObject({
      type: "characterRef",
      attrs: { characterSlug: "kira", variantSlug: null, usageMode: null, role: null },
    })
  })
})
