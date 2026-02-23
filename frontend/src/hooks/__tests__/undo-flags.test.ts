import { describe, it, expect, beforeEach } from "vitest"
import { isSkipUndoCapture, setSkipUndoCapture } from "../undo-flags"

describe("undo-flags", () => {
  beforeEach(() => {
    setSkipUndoCapture(false)
  })

  it("defaults to false", () => {
    expect(isSkipUndoCapture()).toBe(false)
  })

  it("returns true after setting to true", () => {
    setSkipUndoCapture(true)
    expect(isSkipUndoCapture()).toBe(true)
  })

  it("returns false after toggling true then false", () => {
    setSkipUndoCapture(true)
    setSkipUndoCapture(false)
    expect(isSkipUndoCapture()).toBe(false)
  })

  it("remains true after setting to true twice", () => {
    setSkipUndoCapture(true)
    setSkipUndoCapture(true)
    expect(isSkipUndoCapture()).toBe(true)
  })

  it("isolates state between tests via beforeEach reset", () => {
    // Verify the beforeEach reset worked — value should be false
    // even if a prior test left it as true
    expect(isSkipUndoCapture()).toBe(false)
    setSkipUndoCapture(true)
    expect(isSkipUndoCapture()).toBe(true)
  })
})
