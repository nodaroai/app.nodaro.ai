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
    // which the pill's own tests cover). This guard is about variable spans —
    // including the sep/fallback sub-decorations (refMap provided: one dormant
    // token, one active token).
    const value = "a {Setting || base} b {Style Guide} c {person || man}"
    const { container } = render(
      <PromptEditor
        value={value}
        onChange={vi.fn()}
        nodeRefs={REFS}
        refMap={new Map([["Setting", "sunset beach"]])}
      />,
    )
    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")?.textContent).toBe(value)
      expect(container.querySelector(".ref-fallback-dormant")).not.toBeNull()
      expect(container.querySelector(".ref-fallback-active")).not.toBeNull()
    })
  })
})

describe("fallback value-aware rendering", () => {
  const VALUE_MAP = new Map([["Setting", "sunset beach"]])

  it("dormant default: grey strikethrough span when a wired value exists", async () => {
    const { container } = render(
      <PromptEditor value="in {Setting || a misty forest}" onChange={vi.fn()} nodeRefs={REFS} refMap={VALUE_MAP} />,
    )
    await waitFor(() => {
      expect(container.querySelector(".ref-fallback-dormant")?.textContent).toBe("a misty forest")
      expect(container.querySelector(".ref-fallback-sep")?.textContent).toBe("||")
      expect(container.querySelector(".ref-fallback-active")).toBeNull()
    })
  })

  it("active default when the label is unwired (amber token, bright default)", async () => {
    const { container } = render(
      <PromptEditor value="{Mood || serene}" onChange={vi.fn()} nodeRefs={REFS} refMap={VALUE_MAP} />,
    )
    await waitFor(() => {
      expect(container.querySelector(".ref-unresolved-highlight")).not.toBeNull()
      expect(container.querySelector(".ref-fallback-active")?.textContent).toBe("serene")
      expect(container.querySelector(".ref-fallback-dormant")).toBeNull()
    })
  })

  it("active default when wired but the upstream value is empty", async () => {
    const { container } = render(
      <PromptEditor value="{Setting || x}" onChange={vi.fn()} nodeRefs={REFS} refMap={new Map()} />,
    )
    await waitFor(() => {
      expect(container.querySelector(".node-ref-highlight")).not.toBeNull()
      expect(container.querySelector(".ref-fallback-active")?.textContent).toBe("x")
    })
  })

  it("no fallback spans at all when refMap is not provided", async () => {
    const { container } = render(
      <PromptEditor value="{Setting || x}" onChange={vi.fn()} nodeRefs={REFS} />,
    )
    await waitFor(() => {
      expect(container.querySelector(".node-ref-highlight")).not.toBeNull()
    })
    expect(container.querySelector(".ref-fallback-active")).toBeNull()
    expect(container.querySelector(".ref-fallback-dormant")).toBeNull()
    expect(container.querySelector(".ref-fallback-sep")).toBeNull()
  })

  it("flips dormant→active when the upstream value empties (no remount)", async () => {
    const { container, rerender } = render(
      <PromptEditor value="{Setting || x}" onChange={vi.fn()} nodeRefs={REFS} refMap={VALUE_MAP} />,
    )
    await waitFor(() =>
      expect(container.querySelector(".ref-fallback-dormant")?.textContent).toBe("x"),
    )
    rerender(
      <PromptEditor value="{Setting || x}" onChange={vi.fn()} nodeRefs={REFS} refMap={new Map()} />,
    )
    await waitFor(() => {
      expect(container.querySelector(".ref-fallback-dormant")).toBeNull()
      expect(container.querySelector(".ref-fallback-active")?.textContent).toBe("x")
    })
  })
})
