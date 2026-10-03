// The Mood node keeps its emoji in a self-hosted edition, shows the rendered
// face when the renders are registered, and falls back to the emoji if the
// render fails to load.
import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render } from "@testing-library/react"
import type { ReactNode } from "react"
import { LOOK_PREVIEW_SETS, registerLookPreviews, resetLookPreviewsForTests } from "@nodaro/picker-ui"
import { MoodNode } from "../mood-node"

vi.mock("../parameter-node-shell", () => ({
  ParameterNodeShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}))

afterEach(() => resetLookPreviewsForTests())

const emojiIn = (el: HTMLElement) => el.querySelector("span[aria-hidden]")?.textContent ?? ""

function renderMood() {
  const props = { id: "m1", data: { mood: "calm", label: "Mood" }, selected: false } as unknown as Parameters<typeof MoodNode>[0]
  return render(<MoodNode {...props} />)
}

describe("MoodNode", () => {
  it("self-hosted: the emoji, no picture", () => {
    const { container } = renderMood()
    expect(container.querySelector("img")).toBeNull()
    expect(emojiIn(container)).not.toBe("")
  })

  it("cloud: the rendered face replaces the emoji", () => {
    registerLookPreviews(LOOK_PREVIEW_SETS)
    const { container } = renderMood()
    expect(container.querySelector("img")?.getAttribute("srcset")).toContain("cdn.nodaro.ai")
  })

  it("cloud: a render that fails to load falls back to the emoji", () => {
    registerLookPreviews(LOOK_PREVIEW_SETS)
    const { container } = renderMood()
    fireEvent.error(container.querySelector("img")!)
    expect(container.querySelector("img")).toBeNull()
    expect(emojiIn(container)).not.toBe("")
  })
})
