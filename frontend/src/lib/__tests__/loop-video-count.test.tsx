import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { loopVideoRunFields } from "@nodaro/render-rules"
import { LoopVideoConfig } from "@/components/editor/config-panels/processing-configs"
import type { LoopVideoData, WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { estimateVideoUtilityBaseCredits } from "../video-utility-estimate"
import { loopVideoRepeatCount } from "../loop-video-count"

/**
 * An older or API-written Loop node may store its copy count as `loops`, with
 * no `repeatCount`. Every run and quote reads it (`loopVideoRunFields`), so the
 * config panel shows it too; an edit writes `repeatCount` and clears `loops`,
 * and `repeatCount` wins wherever both are set.
 */

const UPLOAD = { id: "u", type: "upload-video", position: { x: 0, y: 0 }, data: { url: "https://cdn.example/up10.mp4", generatedResults: [{ url: "https://cdn.example/up10.mp4", duration: 10 }], activeResultIndex: 0 } } as unknown as WorkflowNode
const EDGES = [{ id: "e", source: "u", target: "l", targetHandle: "in" }] as unknown as WorkflowEdge[]
const loopNode = (data: Record<string, unknown>) => ({ id: "l", type: "loop-video", position: { x: 0, y: 0 }, data: { label: "Loop", fieldMappings: {}, ...data } }) as unknown as WorkflowNode
/** The pill's figure, in units of 5 seconds, of a Loop on the 10 s upload. */
const pill = (data: Record<string, unknown>) => estimateVideoUtilityBaseCredits(loopNode(data), [UPLOAD, loopNode(data)], EDGES)
const panel = (data: Record<string, unknown>) => {
  const onUpdate = vi.fn()
  const view = render(<LoopVideoConfig data={{ label: "Loop", fieldMappings: {}, ...data } as unknown as LoopVideoData} onUpdate={onUpdate} sources={[]} fieldMappings={{}} onMapField={() => {}} nodes={[]} />)
  return { onUpdate, slider: () => screen.getByRole("slider") as HTMLInputElement, unmount: view.unmount }
}

describe("a Loop node with the older `loops` count", () => {
  it("shows 5 in its panel, as the pill and the Run read 5", () => {
    const old = { mode: "repeat", loops: 5 }
    const { slider, unmount } = panel(old)
    expect(slider().value).toBe("5")
    unmount()
    expect(loopVideoRepeatCount(old)).toBe(5)
    expect(loopVideoRunFields(old).repeatCount).toBe(5)
    expect(pill(old)).toBe(pill({ mode: "repeat", repeatCount: 5 }))
  })

  it("an edit to 3 writes the current field and clears `loops`; the panel, the pill and the Run then read 3", () => {
    const old = { mode: "repeat", loops: 5 }
    const { onUpdate, slider, unmount } = panel(old)
    fireEvent.change(slider(), { target: { value: "3" } })
    expect(onUpdate).toHaveBeenCalledWith({ repeatCount: 3, loops: undefined })
    unmount()
    const edited = { ...old, ...onUpdate.mock.calls[0]![0] }
    const after = panel(edited)
    expect(after.slider().value).toBe("3")
    after.unmount()
    expect(loopVideoRunFields(edited).repeatCount).toBe(3)
    expect(pill(edited)).toBe(pill({ mode: "repeat", repeatCount: 3 }))
    expect(pill(edited)).not.toBe(pill(old))
  })

  it("the current field wins wherever both are set", () => {
    const both = { mode: "repeat", repeatCount: 3, loops: 5 }
    expect(loopVideoRepeatCount(both)).toBe(3)
    expect(loopVideoRunFields(both).repeatCount).toBe(3)
    expect(pill(both)).toBe(pill({ mode: "repeat", repeatCount: 3 }))
  })
})
