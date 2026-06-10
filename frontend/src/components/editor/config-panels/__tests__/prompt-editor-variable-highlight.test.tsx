import { describe, it, expect, vi } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { PromptEditor } from "../prompt-editor"
import type { NodeRefItem } from "@/lib/node-refs"

const REFS: NodeRefItem[] = [{ id: "n1", label: "Setting", type: "text-prompt" }]

describe("PromptEditor variable highlighting", () => {
  it("cyan for wired, amber for missing, brace-inclusive", async () => {
    const { container } = render(
      <PromptEditor value="a {Setting} b {Style Guide}" onChange={vi.fn()} nodeRefs={REFS} />,
    )
    await waitFor(() => {
      expect(container.querySelector(".node-ref-highlight")?.textContent).toBe("{Setting}")
      expect(container.querySelector(".ref-unresolved-highlight")?.textContent).toBe("{Style Guide}")
    })
  })

  it("reserved system vars render cyan even with no matching upstream", async () => {
    const { container } = render(
      <PromptEditor value="{userPrompt}" onChange={vi.fn()} nodeRefs={[]} />,
    )
    await waitFor(() => {
      expect(container.querySelector(".node-ref-highlight")?.textContent).toBe("{userPrompt}")
      expect(container.querySelector(".ref-unresolved-highlight")).toBeNull()
    })
  })

  it("suppresses amber entirely when nodeRefs is not provided", async () => {
    const { container } = render(<PromptEditor value="{Anything}" onChange={vi.fn()} />)
    await waitFor(() => {
      expect(container.querySelector(".node-ref-highlight")?.textContent).toBe("{Anything}")
      expect(container.querySelector(".ref-unresolved-highlight")).toBeNull()
    })
  })

  it("flips amber→cyan when the upstream gets wired (no remount)", async () => {
    const { container, rerender } = render(
      <PromptEditor value="x {Style Guide}" onChange={vi.fn()} nodeRefs={REFS} />,
    )
    await waitFor(() =>
      expect(container.querySelector(".ref-unresolved-highlight")?.textContent).toBe("{Style Guide}"),
    )
    rerender(
      <PromptEditor
        value="x {Style Guide}"
        onChange={vi.fn()}
        nodeRefs={[...REFS, { id: "n2", label: "Style Guide", type: "text-prompt" }]}
      />,
    )
    await waitFor(() => {
      expect(container.querySelector(".ref-unresolved-highlight")).toBeNull()
      expect(container.querySelector(".node-ref-highlight")?.textContent).toBe("{Style Guide}")
    })
  })

  it("rendering guard: decoration spans never change the visible text", async () => {
    // No {image:N} here — that token promotes to a pill whose DOM textContent
    // intentionally differs (the literal round-trips via renderText/getText,
    // which the pill's own tests cover). This guard is about variable spans.
    const value = "a {Setting} b {Style Guide} c {person || man}"
    const { container } = render(
      <PromptEditor value={value} onChange={vi.fn()} nodeRefs={REFS} />,
    )
    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")?.textContent).toBe(value)
    })
  })
})
