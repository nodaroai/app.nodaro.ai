import { describe, expect, it, vi } from "vitest"

import { isPrerendering, whenActivated } from "../prerender"

/** A document stand-in: `prerendering` + the `prerenderingchange` event. */
function fakeDocument(prerendering: boolean) {
  const target = new EventTarget()
  const doc = Object.assign(target, { prerendering })
  const activate = () => {
    doc.prerendering = false
    target.dispatchEvent(new Event("prerenderingchange"))
  }
  return { doc: doc as unknown as Document, activate }
}

describe("prerender awareness", () => {
  it("a normal page is not prerendering, and the action runs at once", () => {
    const { doc } = fakeDocument(false)
    const run = vi.fn()
    expect(isPrerendering(doc)).toBe(false)
    whenActivated(run, doc)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("a prerendered page holds the action until it is shown, then runs it once", () => {
    const { doc, activate } = fakeDocument(true)
    const run = vi.fn()
    expect(isPrerendering(doc)).toBe(true)
    whenActivated(run, doc)
    expect(run).not.toHaveBeenCalled()
    activate()
    activate()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("the returned cleanup cancels a held action (an effect torn down before activation)", () => {
    const { doc, activate } = fakeDocument(true)
    const run = vi.fn()
    const cancel = whenActivated(run, doc)
    cancel()
    activate()
    expect(run).not.toHaveBeenCalled()
  })

  it("defaults to the page's own document (jsdom is never prerendering)", () => {
    const run = vi.fn()
    expect(isPrerendering()).toBe(false)
    whenActivated(run)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
