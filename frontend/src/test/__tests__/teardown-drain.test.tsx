/**
 * The global teardown drain (src/test/teardown-drain.ts, registered by
 * setup.ts): a timer a component schedules while Testing Library's automatic
 * cleanup unmounts it — what Radix's FocusScope does — has fired before the
 * next test starts, and so before the file's jsdom is torn down. The tests
 * run in order: each one checks what the previous test's teardown did.
 */
import { afterAll, describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
import { useEffect } from "react"

const fired: string[] = []

/** Schedules `setTimeout(0)` from its effect cleanup, as Radix's FocusScope does on unmount. */
function SchedulesOnUnmount({ name }: { name: string }) {
  useEffect(
    () => () => {
      setTimeout(() => fired.push(name), 0)
    },
    [name],
  )
  return <div />
}

describe("teardown drain", () => {
  it("mounts a component and ends synchronously", () => {
    render(<SchedulesOnUnmount name="real" />)
    expect(fired).toEqual([])
  })

  it("the timer its unmount scheduled has fired before the next test starts", () => {
    // Synchronous on purpose: an await here would hand the timer a turn.
    expect(fired).toEqual(["real"])
  })

  it("ends with fake timers installed", () => {
    vi.useFakeTimers()
    render(<SchedulesOnUnmount name="fake" />)
  })

  it("the drain did not wait on the fake clock (it would have timed out), and left it alone", () => {
    expect(vi.isFakeTimers()).toBe(true)
    // Scheduled on the fake clock during cleanup: it fires only if advanced.
    expect(fired).toEqual(["real"])
    vi.runOnlyPendingTimers()
    expect(fired).toEqual(["real", "fake"])
    vi.useRealTimers()
  })
})

afterAll(() => {
  vi.useRealTimers()
})
