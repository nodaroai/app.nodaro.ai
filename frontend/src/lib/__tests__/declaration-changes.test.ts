// The signal every store of content rights boxes unticks on: the declaration
// changed since the page read it.
import { describe, expect, it, vi } from "vitest"
import { declarationChanged, onDeclarationChanged } from "../declaration-changes"

describe("declaration changes", () => {
  it("tells every listener, each time, until it stops listening", () => {
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = onDeclarationChanged(first)
    const stopSecond = onDeclarationChanged(second)
    declarationChanged()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    stopFirst()
    declarationChanged()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
    stopSecond()
  })
})
