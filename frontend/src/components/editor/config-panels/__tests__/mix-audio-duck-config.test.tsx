/**
 * Mix Audio's duck controls: pick the track the others dip under (the voice),
 * set how hard. The node stores the key track by NODE id (so reordering the
 * tracks cannot re-point it) and writes `duckAmount` the moment a track is
 * picked, so the slider always shows the value the run will send.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MixAudioConfig } from "../processing-configs"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { MixAudioData, WorkflowNode } from "@/types/nodes"

// Radix's portal listbox cannot be driven in jsdom: flatten to a native <select>
// (the same pattern as voice-changer-pro-config.test.tsx).
vi.mock("@/components/ui/select", () => {
  const React = require("react")
  return {
    Select: ({ children, value, onValueChange }: any) => {
      const items: any[] = []
      let triggerLabel: string | undefined
      React.Children.forEach(children, (child: any) => {
        if (!child) return
        if (child.type?.displayName === "SelectContent") {
          React.Children.forEach(child.props?.children, (item: any) => { if (item) items.push(item) })
        }
        if (child.type?.displayName === "SelectTrigger") triggerLabel = child.props?.["aria-label"]
      })
      return (
        <select role="combobox" aria-label={triggerLabel} value={value ?? ""} onChange={(e: any) => onValueChange?.(e.target.value)}>
          {items}
        </select>
      )
    },
    SelectContent: Object.assign(({ children }: any) => <>{children}</>, { displayName: "SelectContent" }),
    SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
    SelectTrigger: Object.assign(({ children }: any) => <>{children}</>, { displayName: "SelectTrigger" }),
    SelectValue: () => null,
  }
})

const music = { id: "music", type: "generate-music", position: { x: 0, y: 0 }, data: { label: "Music bed" } } as unknown as WorkflowNode
const voice = { id: "voice", type: "text-to-speech", position: { x: 0, y: 0 }, data: { label: "Narration" } } as unknown as WorkflowNode
const mix = { id: "mix", type: "mix-audio", position: { x: 0, y: 0 }, data: {} } as unknown as WorkflowNode

function setup(over: Partial<MixAudioData> = {}, connected: WorkflowNode[] = [music, voice]) {
  useWorkflowStore.setState({
    selectedNodeId: "mix",
    nodes: [mix, ...connected] as never,
    edges: connected.map((n) => ({ id: `e-${n.id}`, source: n.id, target: "mix" })) as never,
  })
  const data = { label: "Mix Audio", trackCount: connected.length, trackVolumes: {}, fieldMappings: {}, ...over } as MixAudioData
  const onUpdate = vi.fn()
  render(
    <MixAudioConfig data={data} onUpdate={onUpdate} sources={[]} fieldMappings={{}} onMapField={vi.fn()} nodes={[mix, ...connected]} />,
  )
  return { onUpdate }
}

beforeEach(() => {
  useWorkflowStore.setState({ selectedNodeId: null, edges: [], nodes: [] })
})

describe("Mix Audio duck controls", () => {
  it("offers every connected track, and Off", () => {
    setup()
    const select = screen.getByRole("combobox", { name: "Track the other tracks duck under" })
    expect(Array.from(select.querySelectorAll("option")).map((o) => o.textContent)).toEqual(["Off", "Music bed", "Narration"])
    expect(select).toHaveValue("off")
  })

  it("picking the voice stores its node id and writes the default amount alongside it", () => {
    const { onUpdate } = setup()
    fireEvent.change(screen.getByRole("combobox", { name: "Track the other tracks duck under" }), { target: { value: "voice" } })
    expect(onUpdate).toHaveBeenCalledWith({ duckUnder: "voice", duckAmount: 75 })
  })

  it("keeps an amount the user already chose when switching the key track", () => {
    const { onUpdate } = setup({ duckUnder: "voice", duckAmount: 40 })
    fireEvent.change(screen.getByRole("combobox", { name: "Track the other tracks duck under" }), { target: { value: "music" } })
    expect(onUpdate).toHaveBeenCalledWith({ duckUnder: "music", duckAmount: 40 })
  })

  it("Off clears both fields so a plain mix stays byte-identical", () => {
    const { onUpdate } = setup({ duckUnder: "voice", duckAmount: 40 })
    fireEvent.change(screen.getByRole("combobox", { name: "Track the other tracks duck under" }), { target: { value: "off" } })
    expect(onUpdate).toHaveBeenCalledWith({ duckUnder: undefined, duckAmount: undefined })
  })

  it("shows the amount slider only while ducking, and writes the amount", () => {
    const { onUpdate } = setup({ duckUnder: "voice", duckAmount: 40 })
    const slider = screen.getByLabelText("Duck amount")
    expect(slider).toHaveValue("40")
    fireEvent.change(slider, { target: { value: "90" } })
    expect(onUpdate).toHaveBeenCalledWith({ duckAmount: 90 })
  })

  it("hides the amount slider when not ducking", () => {
    setup()
    expect(screen.queryByLabelText("Duck amount")).toBeNull()
  })

  it("offers no duck with fewer than two connected tracks", () => {
    setup({}, [music])
    expect(screen.queryByRole("combobox", { name: "Track the other tracks duck under" })).toBeNull()
  })

  it("a key track that was disconnected reads as Off rather than a blank select", () => {
    setup({ duckUnder: "gone", duckAmount: 60 })
    expect(screen.getByRole("combobox", { name: "Track the other tracks duck under" })).toHaveValue("off")
    expect(screen.queryByLabelText("Duck amount")).toBeNull()
  })
})
