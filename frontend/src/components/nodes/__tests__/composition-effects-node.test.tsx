/**
 * `composition-effects` defaults to the neutral `none` entry: the rest of the
 * catalog is heavy subject transforms, so an unconfigured node must inject
 * nothing. `none` is a REAL catalog id with an empty `promptHint` — the same
 * no-op-entry convention `transitions`/`character-fx` use for "auto" — which
 * keeps `defaultValue` a member of the option list every consumer enumerates.
 *
 * These tests pin that default, the legacy empty value that must land on it,
 * and the retired-id case: `3x3-grid-collage` was removed from this catalog as
 * a duplicate of the `framing` entry, so a workflow saved with that value falls
 * back to a title-cased label and injects no hint.
 *
 * `ParameterNodeShell` is mocked to a passthrough — the shell's handle dispatch
 * is covered by `parameter-node-shell.test.tsx`; the unit here is which child
 * content the node chooses.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { getCompositionEffectPromptHint } from "@nodaro/prompts"

vi.mock("../parameter-node-shell", () => ({
  ParameterNodeShell: ({ children, label }: any) => (
    <div data-testid="parameter-node-shell" data-label={label}>
      {children}
    </div>
  ),
}))

import { CompositionEffectsNode } from "../composition-effects-node"

function renderNode(compositionEffect: string | undefined) {
  return render(
    <CompositionEffectsNode
      {...({
        id: "node-1",
        data: { label: "Composition Effects", compositionEffect },
        selected: false,
      } as any)}
    />,
  )
}

describe("CompositionEffectsNode", () => {
  it("renders the neutral entry when the node is left at its default", () => {
    renderNode("none")

    expect(screen.getByText("None")).toBeInTheDocument()
    expect(screen.getByText("No composition effect")).toBeInTheDocument()
    // The label of the retired default must not leak back in as a fallback.
    expect(screen.queryByText("Bursting Through Frame")).not.toBeInTheDocument()
  })

  it("lands an empty or undefined value on the neutral entry", () => {
    renderNode("")
    expect(screen.getByText("None")).toBeInTheDocument()

    renderNode(undefined)
    expect(screen.getAllByText("None")).toHaveLength(2)
  })

  it("renders the label and description once an effect is picked", () => {
    renderNode("bursting-through-frame")

    expect(screen.getByText("Bursting Through Frame")).toBeInTheDocument()
    expect(screen.getByText("3D paper-tear breaking the frame")).toBeInTheDocument()
    expect(screen.queryByText("None")).not.toBeInTheDocument()
  })

  it("falls back to a title-cased label, with no description, for a retired id", () => {
    renderNode("3x3-grid-collage")

    expect(screen.getByText("3x3 Grid Collage")).toBeInTheDocument()
    expect(screen.queryByText("Contact-sheet 9-pose montage")).not.toBeInTheDocument()
  })
})

describe("the neutral entry injects nothing", () => {
  it("resolves `none` to an empty prompt hint", () => {
    expect(getCompositionEffectPromptHint("none")).toBe("")
    expect(getCompositionEffectPromptHint("bursting-through-frame")).not.toBe("")
  })
})
