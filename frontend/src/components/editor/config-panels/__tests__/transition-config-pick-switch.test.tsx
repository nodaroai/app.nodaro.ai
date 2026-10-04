/**
 * A change of the picked transition on the canvas: a switch INTO a cut from a pick that is not one drops the
 * Duration and the Intensity (the same rule as Studio's tile click), so a Short that timed a dissolve never turns
 * seamless-match / jump-match into a blend nobody chose. Every other change keeps every lever.
 * `@nodaro/prompts` is NOT mocked; the tile grid is a stand-in that sends the value a click would send.
 */
import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type { WorkflowNode } from "@/types/nodes"

vi.mock("@/hooks/use-workflow-store", () => {
  const noop = () => {}
  return {
    useWorkflowStore: Object.assign(
      (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ updateNode: noop, updateNodeData: noop }),
      { getState: () => ({ updateNode: noop, updateNodeData: noop }) },
    ),
  }
})

vi.mock("../locale-header", () => ({ LocaleHeader: () => null }))

// The tile grid sends the new pick through `onValueChange`: one button per value a click could produce.
const NEXT: ReadonlyArray<string | string[]> = ["seamless-match", "jump-match", "match-cut", "whip-pan", ["seamless-match"]]
vi.mock("@/lib/picker-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/picker-ui")>()),
  TransitionPicker: ({ onValueChange }: { onValueChange: (v: string | string[]) => void }) => (
    <div>
      {NEXT.map((v) => (
        <button key={JSON.stringify(v)} type="button" onClick={() => onValueChange(v)}>
          {`pick ${JSON.stringify(v)}`}
        </button>
      ))}
    </div>
  ),
  CharacterFxPicker: () => null,
  CharacterMotionPicker: () => null,
}))

import { TransitionConfig } from "../parameter-configs"
import { ParameterPreviewContext } from "../parameter-preview-context"

function renderTransition(data: Record<string, unknown>) {
  const onUpdate = vi.fn()
  const node = { id: "transition-1", type: "transition", position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
  render(
    <ParameterPreviewContext.Provider value={{ node, nodes: [node], edges: [] }}>
      <TransitionConfig data={data as never} onUpdate={onUpdate} sources={[]} fieldMappings={{}} onMapField={() => {}} nodes={[node]} />
    </ParameterPreviewContext.Provider>,
  )
  return onUpdate
}
const pick = (v: string | string[]) => fireEvent.click(screen.getByText(`pick ${JSON.stringify(v)}`))

describe("canvas Transition: a switch into a cut drops Duration and Intensity", () => {
  it.each(["seamless-match", "jump-match", "match-cut", ["seamless-match"]] as const)("cross-dissolve + Short + Natural -> %j", (next) => {
    const onUpdate = renderTransition({ transition: "cross-dissolve", position: "middle", duration: "short", intensity: "natural" })
    pick(next as string | string[])
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenLastCalledWith({ transition: next, duration: undefined, intensity: undefined })
  })

  it("removing the non-cut from a mixed pick is a switch into a cut", () => {
    const onUpdate = renderTransition({ transition: ["cross-dissolve", "seamless-match"], duration: "short" })
    pick(["seamless-match"])
    expect(onUpdate).toHaveBeenLastCalledWith({ transition: ["seamless-match"], duration: undefined, intensity: undefined })
  })

  it("cut to cut, cut to non-cut and non-cut to non-cut keep every lever", () => {
    for (const [transition, next] of [["match-cut", "seamless-match"], ["seamless-match", "whip-pan"], ["cross-dissolve", "whip-pan"]] as const) {
      document.body.innerHTML = ""
      const onUpdate = renderTransition({ transition, duration: "short", intensity: "natural" })
      pick(next)
      expect(onUpdate, `${transition} -> ${next}`).toHaveBeenLastCalledWith({ transition: next })
    }
  })
})
