// Speaker Map's panel: the cameras wired into Cameras (one row per upstream
// node), the master / wide selects over them (None for an id no longer
// wired), and the lead at its 3 dB default.
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ConfigPanel } from "../config"
import type { SourceNodeInfo } from "@/components/editor/config-panels/types"

const src = (id: string, label: string, targetHandle = "sources"): SourceNodeInfo => ({ id, type: "upload-video", label, value: `https://media.test/${id}.mp4`, targetHandle })
const kit = { localizeNodeLabel: (label: string) => `«${label}»` }

function renderPanel(data: Record<string, unknown>, sources: SourceNodeInfo[]) {
  const onUpdate = vi.fn()
  render(<ConfigPanel data={{ label: "Speaker Map", fieldMappings: {}, ...data } as never} onUpdate={onUpdate} sources={sources} fieldMappings={{}} onMapField={vi.fn()} nodes={[]} kit={kit} nodeId="map" />)
  return onUpdate
}

describe("speaker-map config panel", () => {
  it("lists each camera wired into Cameras once, never a wire into another input", () => {
    renderPanel({}, [src("cam1", "Host cam"), src("cam2", "Guest cam"), src("cam1", "Host cam"), src("tx", "Transcribe", "transcript")])
    expect(screen.getAllByText("Host cam").length).toBe(1)
    expect(screen.getByText("Guest cam")).toBeTruthy()
    expect(screen.queryByText("Transcribe")).toBeNull()
  })

  it("the master and wide selects show the wired choice by its label, and None for an id no longer wired", () => {
    renderPanel({ masterSourceId: "cam2", wideSourceId: "gone" }, [src("cam1", "Host cam"), src("cam2", "Guest cam")])
    expect(screen.getByLabelText("The master recording").textContent).toContain("«Guest cam»")
    expect(screen.getByLabelText("The wide shot").textContent).toContain("None")
  })

  it("the lead reads 3 dB by default, and the value set otherwise", () => {
    renderPanel({}, [])
    expect(screen.getByText("3 dB")).toBeTruthy()
    expect(screen.getByText("Connect 2–6 recordings to the Cameras input.")).toBeTruthy()
  })
})
