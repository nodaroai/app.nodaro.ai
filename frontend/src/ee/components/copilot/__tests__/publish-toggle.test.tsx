/**
 * The permission to build posting steps, as the user sees it.
 *
 * This feature has now been built one layer short of reachable three times — the
 * deny-list with no thread flag, the thread flag with no route, the route with
 * no schema. These pin the last layer: a box a person can actually tick, that
 * shows the truth when a thread is reopened.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 900 }))

import { CopilotHeader } from "../copilot-header"
import { useCopilotStore } from "@/ee/lib/copilot/turn-store"

const initial = useCopilotStore.getState()

beforeEach(() => {
  useCopilotStore.setState(initial, true)
})

function renderHeader(onChangeSettings = vi.fn()) {
  render(<CopilotHeader onClose={vi.fn()} onChangeSettings={onChangeSettings} />)
  return onChangeSettings
}

const toggle = () => screen.getByRole("switch")
const isOn = () => toggle().getAttribute("aria-checked") === "true"

describe("the publishing permission", () => {
  it("is off until the user says otherwise", () => {
    renderHeader()

    expect(isOn()).toBe(false)
  })

  it("asks the server to turn it on when ticked", () => {
    const onChange = renderHeader()

    fireEvent.click(toggle())

    expect(onChange).toHaveBeenCalledWith({ allowPublishing: true })
  })

  it("asks to turn it OFF again when unticked", () => {
    // A permission you cannot withdraw is not a permission.
    useCopilotStore.setState({ allowPublishing: true })
    const onChange = renderHeader()

    fireEvent.click(toggle())

    expect(onChange).toHaveBeenCalledWith({ allowPublishing: false })
  })

  it("shows the state a reopened thread is actually in", () => {
    // The bug this replaces: three other call sites set the run settings
    // without this field, so a thread with publishing ON opened with the box
    // unticked — and the user would have ticked it to turn it OFF.
    useCopilotStore.setState({ allowPublishing: true })
    renderHeader()

    expect(isOn()).toBe(true)
  })

  it("says what it still cannot do, not only what it can", () => {
    // The second half is what makes the first safe to agree to.
    useCopilotStore.setState({ allowPublishing: true })
    renderHeader()

    expect(screen.getByText(/you still choose the account/i)).toBeTruthy()
  })

  it("does not disturb the run mode", () => {
    const onChange = renderHeader()

    fireEvent.click(toggle())

    expect(onChange.mock.calls[0]![0]).not.toHaveProperty("runMode")
  })
})

describe("a second tab is told when the permission changes", () => {
  // The stale-permission fix has two halves, and each is testable where it
  // lives. `onEvent` is module-private on purpose — exporting it so a test can
  // reach it would widen the engine’s surface for no product reason.

  it("the store adopts a stated permission and keeps an unstated one", () => {
    // This is the rule the event handler relies on: a value the server did not
    // send must leave the current one alone, or an older server would silently
    // switch every thread back to off.
    useCopilotStore.setState({ allowPublishing: true })

    useCopilotStore.getState().setRunSettings("ask", 100, false)
    expect(useCopilotStore.getState().allowPublishing).toBe(false)

    useCopilotStore.getState().setRunSettings("ask", 100, true)
    expect(useCopilotStore.getState().allowPublishing).toBe(true)

    useCopilotStore.getState().setRunSettings("auto", 100)
    expect(useCopilotStore.getState().allowPublishing).toBe(true)
  })

  it("and the turn actually sends it", async () => {
    // The other half: a rule the store honours is worth nothing if the event
    // never carries the field.
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const route = readFileSync(
      join(process.cwd(), "..", "backend", "src", "ee", "routes", "copilot.ts"),
      "utf8",
    )
    // Delimited, not a character count: the first version used a fixed window
    // and cut the field name in half, which reads as "the payload is missing it".
    const start = route.indexOf('type: "metadata"')
    const end = route.indexOf("sendEvent", start + 1)
    const metadata = start === -1 ? "" : route.slice(start, end === -1 ? undefined : end)

    expect(metadata).toContain("runMode")
    expect(metadata, "the metadata event does not carry allowPublishing").toContain("allowPublishing")
  })
})
